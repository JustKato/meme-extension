"use strict";

const Shortcuts = (() => {
  const definitions = [
    ["toggle", "Toggle this tab", "Navigation", "q"],
    ["scrollDown", "Scroll down", "Navigation", "j"],
    ["scrollUp", "Scroll up", "Navigation", "k"],
    ["pageDown", "Page down", "Navigation", "f"],
    ["pageUp", "Page up", "Navigation", "b"],
    ["top", "Jump to top", "Navigation", "g"],
    ["bottom", "Jump to bottom", "Navigation", "G"],
    ["newTab", "New tab", "Tabs", "t"],
    ["closeTab", "Close current tab", "Tabs", "x"],
    ["previousTab", "Previous tab", "Tabs", "h"],
    ["nextTab", "Next tab", "Tabs", "l"],
    ["back", "Go back", "History", "Ctrl+h"],
    ["forward", "Go forward", "History", "Ctrl+l"],
    ["hints", "Show link hints", "Hints", "a"],
    ["cancelHint", "Cancel hints", "Hints", "Escape", "hints"],
    ["editHint", "Delete last letter", "Hints", "Backspace", "hints"],
    ["confirmHint", "Confirm short label", "Hints", "Enter", "hints"]
  ].map(([id, title, group, key, scope = "page"]) => ({ id, title, group, scope, key }));

  const namedKeys = [
    "Space", "Enter", "Escape", "Tab", "Backspace", "Delete", "Insert", "Home", "End",
    "PageUp", "PageDown", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
    ...Array.from({ length: 24 }, (_, i) => "F" + (i + 1))
  ];
  const names = new Map(namedKeys.map(key => [key.toLowerCase(), key]));
  for (const [alias, key] of Object.entries({
    esc: "Escape", return: "Enter", spacebar: "Space", del: "Delete",
    left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown",
    pgup: "PageUp", pgdn: "PageDown"
  })) names.set(alias, key);

  const modifierNames = new Map([
    ["ctrl", "Ctrl"], ["control", "Ctrl"], ["alt", "Alt"], ["option", "Alt"],
    ["meta", "Meta"], ["cmd", "Meta"], ["command", "Meta"], ["shift", "Shift"]
  ]);
  const modifierOrder = ["Ctrl", "Alt", "Meta", "Shift"];

  function canonical(key, modifiers) {
    if (key === " ") key = "Space";
    const printable = Array.from(key).length === 1 && !/\s|\p{C}/u.test(key);
    if (!printable) {
      key = names.get(key.toLowerCase());
      if (!key) return null;
    }
    const chord = modifiers.has("Ctrl") || modifiers.has("Alt") || modifiers.has("Meta");
    if (printable && chord) key = key.toLowerCase();
    if (printable && !chord && modifiers.has("Shift")) {
      // Users can write Shift+g or G. Symbols use the character printed by their layout.
      if (key.toUpperCase() === key.toLowerCase()) return null;
      key = key.toUpperCase();
      if (Array.from(key).length !== 1) return null;
      modifiers.delete("Shift");
    }
    return [...modifierOrder.filter(name => modifiers.has(name)), key].join("+");
  }

  function parse(text) {
    if (typeof text !== "string") return null;
    let key = text === " " ? "Space" : text.trim();
    const modifiers = new Set();
    while (key.indexOf("+") > 0) {
      const split = key.indexOf("+");
      const modifier = modifierNames.get(key.slice(0, split).trim().toLowerCase());
      if (!modifier || modifiers.has(modifier)) return null;
      modifiers.add(modifier);
      key = key.slice(split + 1).trim();
    }
    return canonical(key, modifiers);
  }

  function fromEvent(event) {
    if (event.isComposing || event.keyCode === 229 || event.getModifierState?.("AltGraph")) return null;
    const modifiers = new Set();
    if (event.ctrlKey) modifiers.add("Ctrl");
    if (event.altKey) modifiers.add("Alt");
    if (event.metaKey) modifiers.add("Meta");
    // For bare printable characters event.key already reflects Shift and Caps Lock.
    if (event.shiftKey && (modifiers.size || event.key === " " || Array.from(event.key).length > 1)) {
      modifiers.add("Shift");
    }
    return canonical(event.key, modifiers);
  }

  function resolve(stored) {
    const bindings = {};
    for (const { id, key } of definitions) {
      const row = stored?.[id];
      bindings[id] = { key: parse(row?.key) || key, enabled: row?.enabled !== false };
    }
    return bindings;
  }

  async function read() {
    const { shortcuts } = await browser.storage.local.get("shortcuts");
    return resolve(shortcuts);
  }

  function validate(id, patch, bindings) {
    const def = definitions.find(row => row.id === id);
    if (!def || !patch || typeof patch !== "object") return "Unknown shortcut.";
    if (patch.enabled !== undefined && typeof patch.enabled !== "boolean") return "Invalid shortcut setting.";
    const current = bindings[id];
    const key = patch.key === undefined ? current.key : parse(patch.key);
    if (!key) return "Choose a key or a shortcut with modifiers.";
    if (def.scope === "hints") {
      if (/^[a-z]$/.test(key)) return "Lowercase letters type hint labels. Try a modifier or a different key.";
      if (key === "Tab" || key === "Shift+Tab") return "Tab and Shift+Tab move focus out of hint mode.";
    }
    if (patch.enabled ?? current.enabled) {
      const other = definitions.find(row => row.id !== id && row.scope === def.scope &&
        bindings[row.id].enabled && bindings[row.id].key === key);
      if (other) return `${key} is already assigned to "${other.title}".`;
    }
    return null;
  }

  function match(bindings, key, scope) {
    return definitions.find(row => row.scope === scope && bindings[row.id].enabled &&
      bindings[row.id].key === key)?.id;
  }

  return { definitions, parse, fromEvent, resolve, read, validate, match };
})();
