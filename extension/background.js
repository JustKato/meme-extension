"use strict";

const tabKey = id => `disabled:${id}`;

browser.runtime.onMessage.addListener((message, sender) => {
  const id = sender.tab?.id;
  if (id == null) return;
  const key = tabKey(id);

  if (message.type === "read-enabled") {
    return browser.storage.session.get(key).then(state => !state[key]);
  }
  if (message.type === "set-enabled" && typeof message.enabled === "boolean") {
    const enabled = message.enabled;
    const write = enabled ? browser.storage.session.remove(key) : browser.storage.session.set({ [key]: true });
    return write.then(() => browser.tabs.sendMessage(id, { type: "enabled", enabled }));
  }
});

browser.tabs.onRemoved.addListener(id => browser.storage.session.remove(tabKey(id)));
