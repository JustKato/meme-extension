"use strict";

(() => {
  if (!(document instanceof HTMLDocument)) return;
  let enabled = null;
  let bindings = null;
  let bindingRevision = 0;
  const held = new Map();
  const scrollActions = new Set(["scrollDown", "scrollUp", "pageDown", "pageUp", "top", "bottom"]);
  const editor = "textarea,select,[role~=textbox i],[role~=searchbox i],[role~=combobox i],[role~=spinbutton i]," +
    "[role~=slider i],input:not([type=button i],[type=submit i],[type=reset i],[type=image i],[type=checkbox i],[type=radio i])";

  function confirmationKey() {
    const row = bindings.confirmHint;
    return row.enabled ? row.key : null;
  }

  function applyBindings(next) {
    bindings = next;
    if (!bindings.hints.enabled) PageHints.close();
    else PageHints.setConfirmKey(confirmationKey());
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.shortcuts) return;
    bindingRevision++;
    applyBindings(Shortcuts.resolve(changes.shortcuts.newValue));
  });

  function readState() {
    const revision = ++bindingRevision;
    enabled = null;
    Shortcuts.read().then(next => {
      if (revision === bindingRevision) applyBindings(next);
    });
    browser.runtime.sendMessage({ type: "read-enabled" }).then(value => {
      if (enabled === null) enabled = value;
    });
  }

  browser.runtime.onMessage.addListener(message => {
    if (message.type === "popup-read") return browser.runtime.sendMessage({ type: "read-enabled" });
    if (message.type === "popup-set" && typeof message.enabled === "boolean") {
      return browser.runtime.sendMessage({ type: "set-enabled", enabled: message.enabled });
    }
    if (message.type === "enabled") {
      enabled = message.enabled;
      if (!enabled) PageHints.close();
    }
  });

  function typing(event) {
    if (document.designMode === "on") return true;
    return event.composedPath().some(el =>
      el.nodeType === Node.ELEMENT_NODE && (el.isContentEditable || el.matches(editor)));
  }

  function scroller(start) {
    for (let el = start; el && el !== document.scrollingElement; el = HintTargets.parent(el)) {
      if (el.scrollHeight > el.clientHeight + 1 && /^(auto|scroll|overlay)$/.test(getComputedStyle(el).overflowY)) {
        return el;
      }
    }
    return null;
  }

  function scroll(action, event) {
    const root = document.scrollingElement;
    if (!root) return;
    let pane = scroller(event.composedPath().find(el => el.nodeType === Node.ELEMENT_NODE));
    if (!pane && root.scrollHeight <= root.clientHeight + 1) {
      pane = scroller(HintTargets.hitAt(document, innerWidth / 2, innerHeight / 2));
    }
    const target = pane || window;
    if (action === "top" || action === "bottom") {
      target.scrollTo({ top: action === "top" ? 0 : (pane || root).scrollHeight, behavior: "instant" });
      return;
    }
    const direction = action === "scrollDown" || action === "pageDown" ? 1 : -1;
    const page = action === "pageDown" || action === "pageUp";
    if (!pane) {
      if (page) window.scrollByPages(direction);
      else window.scrollByLines(direction);
      return;
    }
    const style = getComputedStyle(pane);
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const distance = page ? Math.max(line, pane.clientHeight - line) : line;
    pane.scrollBy({ top: direction * distance, behavior: "instant" });
  }

  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  window.addEventListener("keydown", event => {
    if (!event.isTrusted || event.isComposing || event.keyCode === 229) return;
    const code = event.code || event.key;
    if (event.repeat && held.get(code) === "once") return consume(event);
    if (enabled === null || !bindings || typing(event)) return;
    const key = Shortcuts.fromEvent(event);
    if (!key) return;

    const inHints = PageHints.active;
    const action = Shortcuts.match(bindings, key, inHints ? "hints" : "page");
    if (inHints) {
      if (key === "Tab" || key === "Shift+Tab") {
        PageHints.close();
        return;
      }
      if (!action && !/^[a-z]$/.test(key)) return;
    } else if (!action || (!enabled && action !== "toggle")) {
      return;
    }

    const scrolling = scrollActions.has(action);
    // Cancel the browser default before any asynchronous tab/history operation.
    consume(event);
    held.set(code, scrolling ? "scroll" : "once");
    // A held close/switch key can repeat in a different tab after the first action.
    if (event.repeat && !scrolling) return;
    if (inHints) {
      PageHints.handle(action, key);
    } else if (action === "toggle") {
      enabled = !enabled;
      browser.runtime.sendMessage({ type: "set-enabled", enabled });
      PageHints.notify(enabled ? "Keyboard navigation on" : "Keyboard navigation off");
    } else if (scrolling) {
      scroll(action, event);
    } else if (action === "hints") {
      PageHints.open(confirmationKey());
    } else {
      browser.runtime.sendMessage({ type: "tab-action", action }).catch(() => {});
    }
  }, true);

  window.addEventListener("keyup", event => {
    if (event.isTrusted && held.delete(event.code || event.key)) consume(event);
  }, true);

  function reset() {
    held.clear();
    PageHints.close();
    PageHints.clearNotice();
  }
  window.addEventListener("blur", reset);
  window.addEventListener("pagehide", reset);
  window.addEventListener("pageshow", event => { if (event.persisted) readState(); });
  readState();
})();
