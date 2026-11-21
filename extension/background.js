"use strict";

const tabKey = id => `disabled:${id}`;
let shortcutWrite = Promise.resolve();

async function updateShortcuts(message) {
  if (message.type === "reset-shortcuts") {
    await browser.storage.local.remove("shortcuts");
    return { bindings: Shortcuts.resolve() };
  }
  const bindings = await Shortcuts.read();
  const { id, patch } = message;
  const error = Shortcuts.validate(id, patch, bindings);
  if (error) return { bindings, error };
  const row = bindings[id];
  if (patch.key !== undefined) row.key = Shortcuts.parse(patch.key);
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  await browser.storage.local.set({ shortcuts: bindings });
  return { bindings };
}

async function runTabAction(action, tab) {
  if (!tab.active) return;
  switch (action) {
    case "newTab":
      await browser.tabs.create({ windowId: tab.windowId, active: true });
      break;
    case "closeTab":
      await browser.tabs.remove(tab.id);
      break;
    case "back":
      await browser.tabs.goBack(tab.id);
      break;
    case "forward":
      await browser.tabs.goForward(tab.id);
      break;
    case "previousTab":
    case "nextTab": {
      const tabs = await browser.tabs.query({ windowId: tab.windowId, hidden: false });
      tabs.sort((a, b) => a.index - b.index);
      const current = tabs.findIndex(item => item.id === tab.id && item.active);
      if (current < 0 || tabs.length <= 1) break;
      const offset = action === "nextTab" ? 1 : -1;
      const next = tabs[(current + offset + tabs.length) % tabs.length];
      await browser.tabs.update(next.id, { active: true });
      break;
    }
  }
}

async function setEnabled(id, enabled) {
  const key = tabKey(id);
  if (enabled) await browser.storage.session.remove(key);
  else await browser.storage.session.set({ [key]: true });
  // The tab can finish navigating between the write and the notification.
  await browser.tabs.sendMessage(id, { type: "enabled", enabled }).catch(() => {});
  return enabled;
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "update-shortcut" || message.type === "reset-shortcuts") {
    // Two browser windows can have shortcut editors open simultaneously.
    const result = shortcutWrite.then(() => updateShortcuts(message));
    shortcutWrite = result.catch(() => {});
    return result;
  }
  const tab = sender.tab;
  if (tab?.id == null) return;
  if (message.type === "read-enabled") {
    const key = tabKey(tab.id);
    return browser.storage.session.get(key).then(state => !state[key]);
  }
  if (message.type === "set-enabled" && typeof message.enabled === "boolean") {
    return setEnabled(tab.id, message.enabled);
  }
  if (message.type === "tab-action") {
    // History can be empty, or the source/destination tab can close mid-action.
    return runTabAction(message.action, tab).then(() => true, () => false);
  }
});

browser.tabs.onRemoved.addListener(id => browser.storage.session.remove(tabKey(id)));
