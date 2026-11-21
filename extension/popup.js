"use strict";

const toggle = document.getElementById("tab-toggle");
const statusText = document.getElementById("tab-status");
let tabId;
let revision = 0;

function showState(enabled) {
  toggle.disabled = typeof enabled !== "boolean";
  toggle.setAttribute("aria-checked", String(enabled === true));
  if (toggle.disabled) statusText.textContent = "Unavailable on this page";
  else statusText.textContent = enabled ? "On for this tab" : "Off for this tab";
}

async function update(requestedState) {
  const request = ++revision;
  const previousTab = tabId;
  toggle.setAttribute("aria-busy", "true");
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (request !== revision) return;
    tabId = tab?.id;
    if (tabId == null) {
      showState(null);
      return;
    }
    // Only change the tab whose state the person saw before pressing the switch.
    const write = typeof requestedState === "boolean" && tabId === previousTab;
    const message = write ? { type: "popup-set", enabled: requestedState } : { type: "popup-read" };
    const enabled = await browser.tabs.sendMessage(tabId, message, { frameId: 0 });
    if (request === revision) showState(enabled);
  } catch {
    // Firefox withholds the content script on protected pages and denied sites.
    if (request === revision) showState(null);
  } finally {
    if (request === revision) toggle.removeAttribute("aria-busy");
  }
}

toggle.addEventListener("click", () => {
  if (!toggle.hasAttribute("aria-busy")) update(toggle.getAttribute("aria-checked") !== "true");
});
browser.tabs.onActivated.addListener(() => update());
browser.tabs.onUpdated.addListener((id, change) => {
  if (id === tabId && change.status === "complete") update();
});
update();

const get = id => document.getElementById(id);
const bindingList = get("binding-list");
const editorStatus = get("editor-status");
const definitions = new Map(Shortcuts.definitions.map(definition => [definition.id, definition]));
const rows = new Map();
let bindings;
let bindingRead = 0;
let recording;
let saving = false;

function report(text, error = false) {
  editorStatus.dataset.error = String(error);
  editorStatus.textContent = text;
}

function buildList() {
  const groups = new Map();
  for (const { id, title, group } of definitions.values()) {
    if (!groups.has(group)) {
      const section = document.createElement("section");
      section.className = "binding-group";
      const heading = document.createElement("h3");
      heading.textContent = group;
      section.append(heading);
      bindingList.append(section);
      groups.set(group, section);
    }
    const row = get("binding-row").content.firstElementChild.cloneNode(true);
    row.dataset.command = id;
    row.querySelector(".binding-name").textContent = title;
    const record = row.querySelector("[data-record]");
    const enabled = row.querySelector("[data-enabled]");
    enabled.setAttribute("aria-label", `Enable ${title}`);
    rows.set(id, { record, enabled });
    groups.get(group).append(row);
  }
}

function paintBindings(values) {
  bindings = values;
  for (const [id, { record, enabled }] of rows) {
    const binding = bindings[id];
    record.textContent = binding.key;
    record.setAttribute("aria-label", `Change shortcut for ${definitions.get(id).title}, currently ${binding.key}`);
    enabled.checked = binding.enabled;
  }
  for (const keycap of document.querySelectorAll("[data-key]")) {
    const binding = bindings[keycap.dataset.key];
    keycap.textContent = binding.key;
    keycap.classList.toggle("disabled", !binding.enabled);
    keycap.setAttribute("aria-label", binding.enabled ? binding.key : `${binding.key}, disabled`);
    keycap.title = binding.enabled ? "" : "Disabled";
  }
}

async function readBindings() {
  const request = ++bindingRead;
  try {
    const values = await Shortcuts.read();
    if (request === bindingRead) paintBindings(values);
  } catch {
    if (request === bindingRead) report("Shortcut settings could not be loaded.", true);
  }
}

async function persist(message, success) {
  if (saving) return false;
  saving = true;
  try {
    const result = await browser.runtime.sendMessage(message);
    if (result.bindings) {
      bindingRead++;
      paintBindings(result.bindings);
    }
    if (result.error) {
      report(result.error, true);
      return false;
    }
    report(success);
    return true;
  } catch {
    report("Could not save these shortcuts. Try again.", true);
    return false;
  } finally {
    saving = false;
  }
}

function showReset(visible) {
  get("reset-panel").hidden = !visible;
  get("reset-shortcuts").hidden = visible;
}

function endRecording() {
  const id = recording;
  recording = null;
  get("recorder").hidden = true;
  get("binding-view").hidden = false;
  if (id && !get("editor").hidden) rows.get(id).record.focus();
}

function startRecording(id) {
  if (saving || !bindings) return;
  recording = id;
  report("");
  showReset(false);
  get("binding-view").hidden = true;
  get("recorder").hidden = false;
  get("record-title").textContent = definitions.get(id).title;
  get("capture-tip").textContent = `Current shortcut is ${bindings[id].key}. Press Tab for manual entry.`;
  get("manual-shortcut").value = "";
  get("capture-shortcut").focus();
}

async function assign(key) {
  const id = recording;
  if (!id || saving) return;
  if (!key) {
    report("Enter a shortcut such as Ctrl+l.", true);
    return;
  }
  const saved = await persist({ type: "update-shortcut", id, patch: { key } },
    `${definitions.get(id).title} now uses ${key}.`);
  if (saved && recording === id) endRecording();
}

get("open-shortcuts").addEventListener("click", () => {
  get("menu").hidden = true;
  get("editor").hidden = false;
  report("");
  readBindings();
  get("close-shortcuts").focus();
});
get("close-shortcuts").addEventListener("click", () => {
  get("editor").hidden = true;
  endRecording();
  showReset(false);
  get("menu").hidden = false;
  get("open-shortcuts").focus();
});
bindingList.addEventListener("click", event => {
  const button = event.target.closest("[data-record]");
  if (button) startRecording(button.closest("[data-command]").dataset.command);
});
bindingList.addEventListener("change", event => {
  if (!event.target.matches("[data-enabled]") || !bindings) return;
  const id = event.target.closest("[data-command]").dataset.command;
  const enabled = event.target.checked;
  event.target.checked = bindings[id].enabled;
  persist({ type: "update-shortcut", id, patch: { enabled } },
    `${definitions.get(id).title} ${enabled ? "enabled" : "disabled"}.`);
});

get("capture-shortcut").addEventListener("keydown", event => {
  // Tab reaches the manual text field and Cancel. It can still be entered by name.
  if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) return;
  if (event.isComposing || event.key === "Process") return;
  event.preventDefault();
  event.stopPropagation();
  const key = Shortcuts.fromEvent(event);
  if (key && !event.repeat) assign(key);
});
get("manual-form").addEventListener("submit", event => {
  event.preventDefault();
  assign(Shortcuts.parse(get("manual-shortcut").value));
});
get("cancel-recording").addEventListener("click", () => {
  report("");
  endRecording();
});
get("reset-shortcuts").addEventListener("click", () => {
  report("");
  showReset(true);
  get("cancel-reset").focus();
});
get("cancel-reset").addEventListener("click", () => {
  showReset(false);
  get("reset-shortcuts").focus();
});
get("confirm-reset").addEventListener("click", async () => {
  if (await persist({ type: "reset-shortcuts" }, "Default shortcuts restored.")) {
    showReset(false);
    if (!get("editor").hidden) get("reset-shortcuts").focus();
  }
});

buildList();
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.shortcuts) readBindings();
});
readBindings();
