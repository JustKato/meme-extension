"use strict";

(() => {
  if (!(document instanceof HTMLDocument)) return;
  let enabled = null;
  const held = new Map();
  const scrollKeys = new Set(["j", "k", "f", "b", "g", "G"]);
  const editor = "textarea,select,[role~=textbox i],[role~=searchbox i],[role~=combobox i],[role~=spinbutton i]," +
    "[role~=slider i],input:not([type=button i],[type=submit i],[type=reset i],[type=image i],[type=checkbox i],[type=radio i])";

  function readState() {
    enabled = null;
    browser.runtime.sendMessage({ type: "read-enabled" }).then(value => {
      if (enabled === null) enabled = value;
    });
  }

  browser.runtime.onMessage.addListener(message => {
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

  function scroll(key, event) {
    const root = document.scrollingElement;
    if (!root) return;
    let pane = scroller(event.composedPath().find(el => el.nodeType === Node.ELEMENT_NODE));
    if (!pane && root.scrollHeight <= root.clientHeight + 1) {
      pane = scroller(HintTargets.hitAt(document, innerWidth / 2, innerHeight / 2));
    }
    const target = pane || window;
    if (key === "g" || key === "G") {
      target.scrollTo({ top: key === "g" ? 0 : (pane || root).scrollHeight, behavior: "instant" });
      return;
    }
    const direction = key === "j" || key === "f" ? 1 : -1;
    const page = key === "f" || key === "b";
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
    if (!event.isTrusted || event.isComposing || event.keyCode === 229 ||
        event.ctrlKey || event.altKey || event.metaKey) return;
    const key = event.key;
    const code = event.code || key;
    if (event.repeat && held.get(code) === "once") return consume(event);
    if (enabled === null || typing(event)) return;
    const inHints = PageHints.active;
    const scrolling = !inHints && enabled && scrollKeys.has(key);
    if (inHints) {
      if (!PageHints.handle(key)) return;
    } else if (key === "q") {
      enabled = !enabled;
      browser.runtime.sendMessage({ type: "set-enabled", enabled });
      PageHints.notify(enabled ? "Keyboard navigation on" : "Keyboard navigation off");
    } else if (scrolling) {
      scroll(key, event);
    } else if (enabled && key === "a") {
      PageHints.open();
    } else {
      return;
    }
    held.set(code, scrolling ? "scroll" : "once");
    consume(event);
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
