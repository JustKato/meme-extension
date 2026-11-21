"use strict";

const PageHints = (() => {
  let session = null;
  let notice = null;
  let noticeTimer;
  const css = `
    :host {
      all: initial !important; position: fixed !important; inset: 0 !important;
      display: block !important; margin: 0 !important; padding: 0 !important;
      width: auto !important; height: auto !important; max-width: none !important;
      max-height: none !important; border: 0 !important; background: transparent !important;
      pointer-events: none !important; overflow: clip !important; z-index: 2147483647 !important;
      color-scheme: light !important; direction: ltr !important;
    }
    :host::backdrop { background: transparent !important; pointer-events: none !important; }
    .badge, .message { position: absolute; box-sizing: border-box; pointer-events: none;
      font: bold 12px/16px ui-monospace, monospace; white-space: nowrap; }
    .badge { height: 18px; border: 1px solid #382a09; border-radius: 3px; padding: 0 3px;
      background: #ffdf79; color: #241a05; text-align: center; box-shadow: 0 1px 2px #0008; }
    .message { bottom: 12px; right: 12px; padding: 4px 8px; border-radius: 4px;
      background: #241f18; color: #fff8e5; }
    .message:empty { display: none; }
  `;

  function layer() {
    const host = document.createElement("div");
    host.setAttribute("popover", "manual");
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = css;
    const badges = document.createElement("div");
    badges.setAttribute("aria-hidden", "true");
    const message = document.createElement("div");
    message.className = "message";
    message.setAttribute("role", "status");
    shadow.append(style, badges, message);
    (document.fullscreenElement || document.documentElement).append(host);
    host.showPopover();
    return { host, badges, message };
  }

  function clearNotice() {
    clearTimeout(noticeTimer);
    notice?.host.remove();
    notice = null;
  }

  function notify(text) {
    clearNotice();
    notice = layer();
    notice.message.textContent = text;
    noticeTimer = setTimeout(clearNotice, 1200);
  }

  function labelFor(index) {
    let result = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      result = String.fromCharCode(97 + (n - 1) % 26) + result;
    }
    return result;
  }

  // Try nearby positions for adjacent controls before allowing labels to overlap.
  function position(entry, width, occupied) {
    const { x, y } = entry.at;
    const offsets = [[0, 0], [0, -18], [0, 18], [-width, 0], [width, 0], [0, -36], [0, 36]];
    let first;
    for (const [dx, dy] of offsets) {
      const left = Math.max(0, Math.min(Math.round(x + dx), innerWidth - width));
      const top = Math.max(0, Math.min(Math.round(y + dy), innerHeight - 18));
      const box = { left, top, right: left + width, bottom: top + 18 };
      first ??= box;
      if (occupied.every(b => box.right <= b.left || b.right <= left || box.bottom <= b.top || b.bottom <= top)) {
        return box;
      }
    }
    return first;
  }

  function render(message = "") {
    const { ui, entries, prefix } = session;
    const fragment = document.createDocumentFragment();
    const occupied = [];
    for (const entry of entries) {
      if (!entry.label.startsWith(prefix)) continue;
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = entry.label;
      const width = 10 + entry.label.length * 8;
      const box = position(entry, width, occupied);
      occupied.push(box);
      badge.style.left = box.left + "px";
      badge.style.top = box.top + "px";
      badge.style.width = width + "px";
      fragment.append(badge);
    }
    ui.badges.replaceChildren(fragment);
    const exact = prefix && entries.some(e => e.label === prefix);
    const confirm = session.confirmKey;
    const prompt = confirm ? `${confirm} selects "${prefix}"` : "Short label confirmation is off";
    ui.message.textContent = message || (exact ? prompt : prefix);
  }

  function schedule() {
    if (!session || session.raf) return;
    session.raf = requestAnimationFrame(() => {
      if (!session) return;
      session.raf = 0;
      refresh();
    });
  }

  function watch(roots) {
    const current = session.roots;
    if (roots.length === current.length && roots.every((r, i) => r === current[i])) return;
    session.observer.disconnect();
    session.listeners?.abort();
    session.listeners = new AbortController();
    const options = { capture: true, passive: true, signal: session.listeners.signal };
    for (const root of roots) {
      session.observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
      for (const name of ["scroll", "load", "toggle", "transitionend", "animationend"]) {
        root.addEventListener(name, schedule, options);
      }
      root.defaultView?.addEventListener("resize", schedule, options);
    }
    session.roots = roots;
  }

  function refresh() {
    const { targets, roots } = HintTargets.collect(document, session.ui.host);
    for (const entry of targets) {
      let label = session.labels.get(entry.el);
      if (!label) {
        label = labelFor(session.next++);
        session.labels.set(entry.el, label);
      }
      entry.label = label;
    }
    session.entries = targets;
    if (!targets.some(e => e.label.startsWith(session.prefix))) session.prefix = "";
    watch(roots);
    render(targets.length ? "" : "No visible links or controls");
  }

  function open(confirmKey) {
    clearNotice();
    session = { ui: layer(), confirmKey, labels: new WeakMap(), next: 0, prefix: "", entries: [], roots: [],
      observer: new MutationObserver(schedule), listeners: null, raf: 0 };
    refresh();
    if (!session.entries.length) {
      close();
      notify("No visible links or controls");
    }
  }

  function close() {
    if (!session) return;
    session.observer.disconnect();
    session.listeners?.abort();
    cancelAnimationFrame(session.raf);
    session.ui.host.remove();
    session = null;
  }

  function select(entry) {
    // Page scripts may have replaced, covered or moved the element since the last paint.
    const { targets } = HintTargets.collect(document, session.ui.host);
    const current = targets.find(t => t.el === entry.el);
    if (!current) {
      session.prefix = "";
      refresh();
      return;
    }
    close();
    HintTargets.activate(current);
  }

  function setConfirmKey(key) {
    if (!session || session.confirmKey === key) return;
    session.confirmKey = key;
    render();
  }

  function handle(action, key) {
    if (action === "cancelHint") {
      close();
    } else if (action === "editHint") {
      session.prefix = session.prefix.slice(0, -1);
      render();
    } else if (action === "confirmHint") {
      const exact = session.entries.find(e => e.label === session.prefix);
      if (exact) select(exact);
    } else if (/^[a-z]$/.test(key)) {
      const prefix = session.prefix + key;
      const matches = session.entries.filter(e => e.label.startsWith(prefix));
      if (matches.length === 1 && matches[0].label === prefix) {
        select(matches[0]);
      } else if (matches.length) {
        session.prefix = prefix;
        render();
      } else {
        render(`No match for "${prefix}"`);
      }
    }
  }

  return { open, close, handle, notify, clearNotice, setConfirmKey, get active() { return session !== null; } };
})();
