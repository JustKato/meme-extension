const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { Builder, By, Key } = require("selenium-webdriver");
const firefox = require("selenium-webdriver/firefox");
const { Command } = require("selenium-webdriver/lib/command");
const manifest = require("../extension/manifest.json");
const addonId = manifest.browser_specific_settings.gecko.id;
const testUuid = "5899f06c-f848-40f6-ab29-3c8f04372ece";
const popupUrl = `moz-extension://${testUuid}/${manifest.action.default_popup}`;

let driver, server, origin, markup = "";
const child = '<button onclick="this.dataset.clicked=1">Inside frame</button>';
function page(body) {
  return `<!doctype html><meta charset="utf-8"><title>Keyboard fixture</title>
    <style>body { margin:16px; font:16px/20px sans-serif } button { min-height:22px }</style>
    ${body}`;
}

before(async () => {
  server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (req.url === "/strict-css") res.setHeader("Content-Security-Policy", "style-src 'none'");
    res.end(page(req.url.startsWith("/child") ? child : markup));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const options = new firefox.Options().addArguments("-headless")
    .setPreference("extensions.webextensions.uuids", JSON.stringify({ [addonId]: testUuid }))
    .setPreference("general.smoothScroll", false)
    .setPreference("accessibility.typeaheadfind", false);
  if (process.env.FIREFOX_BIN) options.setBinary(process.env.FIREFOX_BIN);
  const service = new firefox.ServiceBuilder(process.env.GECKODRIVER_BIN || "geckodriver")
    .setHostname("127.0.0.1").addArguments("--allow-system-access"); // Native Firefox toolbar UI tests
  driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).setFirefoxService(service).build();
  await driver.manage().window().setRect({ width: 1100, height: 820 });
  // Firefox 140 reads scripts lazily. Keep the XPI on disk for the whole session
  // by passing geckodriver its local path instead of uploading a temporary copy.
  const xpi = path.resolve("dist", `meme-extension-${manifest.version}-unsigned.xpi`);
  await driver.execute(new Command("install addon").setParameter("path", xpi).setParameter("temporary", true));
});

after(async () => {
  try { await driver?.quit(); }
  finally { if (server) await new Promise(resolve => server.close(resolve)); }
});

async function load(html, pathname = "/") {
  markup = html;
  await driver.get(origin + pathname);
  // Send the first key after the fixture has actually reached the screen.
  await js("return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}
const js = (script, ...args) => driver.executeScript(script, ...args);
const keys = (...list) => driver.actions().sendKeys(...list).perform();
const until = (predicate, message) => driver.wait(predicate, 3500, message, 40);

function labels() {
  return js(`return [...document.querySelectorAll('[popover="manual"]')]
    .flatMap(host => [...(host.shadowRoot?.querySelectorAll(".badge") || [])].map(b => b.textContent))`);
}
async function expectLabels(expected) {
  await until(async () => JSON.stringify(await labels()) === JSON.stringify(expected),
    "Expected visible labels " + JSON.stringify(expected));
}

test("line, page and edge movement respects case, modifiers and a focused scrolling panel", async () => {
  await load('<div style="height:5000px"><div id="pane" tabindex="0" style="height:130px;overflow:auto"><div style="height:900px"></div></div></div>');
  await keys("j");
  await until(() => js("return scrollY > 0"), "Firefox line scroll");
  const line = await js("return scrollY");
  assert.ok(line > 0 && line < 100, `line moved ${line}px`);
  await keys("k");
  await until(() => js("return scrollY === 0"), "Firefox reverse line scroll");
  await keys("f");
  await until(() => js("return scrollY > 200"), "Firefox page scroll");
  const step = await js("return scrollY");
  assert.ok(step > 200 && step <= await js("return innerHeight"));
  await keys("b");
  await until(() => js("return scrollY === 0"), "Firefox reverse page scroll");
  await keys("G");
  assert.equal(await js("return scrollY"), await js("return document.documentElement.scrollHeight - innerHeight"));
  await keys("g", "J", "F");
  await driver.actions().keyDown(Key.ALT).sendKeys("j").keyUp(Key.ALT).perform();
  assert.equal(await js("return scrollY"), 0);
  await js("document.querySelector('#pane').focus()");
  await keys("j", "f");
  assert.ok(await js("return pane.scrollTop > 110 && scrollY === 0"));
  await keys("G");
  assert.ok(await js("return pane.scrollTop === pane.scrollHeight - pane.clientHeight"));
  await keys("g");
  assert.equal(await js("return pane.scrollTop"), 0);
});

test("visible targets get document-order labels and a single standard button activation", async () => {
  await load(`<button hidden>hidden</button><button disabled>disabled</button>
    <div style="opacity:0"><a href="#wrong">transparent</a></div>
    <div inert><button>inert</button></div><button aria-disabled="true">disabled ARIA</button>
    <div style="position:relative;width:110px;height:25px"><button>covered</button>
      <i style="position:absolute;inset:0;background:white"></i></div>
    <button id="target"><span>click me</span></button>
    <a href="#landed">link</a><input type="checkbox" id="check">
    <button style="position:absolute;top:220vh">offscreen</button>
    <script>window.seen=[]; for (const type of ["pointerdown","mousedown","pointerup","mouseup","click"])
      target.addEventListener(type, e => seen.push([e.type, e.button, e.clientX]));</script>`);
  await keys("a");
  await expectLabels(["a", "b", "c"]);
  await keys("a");
  const events = await js("return window.seen");
  assert.deepEqual(events.map(e => e[0]), ["pointerdown","mousedown","pointerup","mouseup","click"]);
  assert.ok(events.every(e => e[1] === 0 && e[2] > 0));
  assert.equal(await js("return document.activeElement.id"), "target");
  await keys("a", "b");
  assert.equal(await js("return location.hash"), "#landed");
  await keys("a", "c");
  assert.equal(await js("return check.checked"), true);
});

test("alphabetic labels reach aa, prefix confirmation is explicit, and q can select a hint", async () => {
  await load(Array.from({ length: 29 }, (_, i) =>
    `<button onclick="document.body.dataset.chosen='${i}'">${i}</button>`).join(" "));
  const expected = [..."abcdefghijklmnopqrstuvwxyz", "aa", "ab", "ac"];
  await keys("a");
  await expectLabels(expected);
  await keys("a");
  await expectLabels(["a", "aa", "ab", "ac"]);
  assert.equal(await js("return document.body.dataset.chosen || null"), null);
  await keys(Key.BACK_SPACE);
  await expectLabels(expected);
  await keys("a", Key.ENTER);
  assert.equal(await js("return document.body.dataset.chosen"), "0");
  await keys("a", "a", "b");
  assert.equal(await js("return document.body.dataset.chosen"), "27");
  await keys("a", "q");
  assert.equal(await js("return document.body.dataset.chosen"), "16");
  await keys("a", "a", Key.ESCAPE);
  await expectLabels([]);
  assert.equal(await js("return document.body.dataset.chosen"), "16");
});

test("q toggles one tab, survives navigation, and leaves page handlers active while off", async () => {
  await load('<button>button</button><div style="height:300vh"></div>');
  const original = await driver.getWindowHandle();
  try {
    await keys("Q", "j");
    await until(() => js("return scrollY > 0"), "uppercase Q leaves navigation active");
    await keys("g", "q");
    await driver.navigate().refresh();
    await js("window.seen=[]; window.addEventListener('keydown', e => seen.push(e.key))");
    await keys("a", "j", "G");
    assert.equal(await js("return scrollY"), 0);
    assert.deepEqual(await js("return window.seen"), ["a", "j", "G"]);
    await driver.switchTo().newWindow("tab");
    await driver.get(origin + "/");
    await keys("a");
    await expectLabels(["a"]);
    await driver.close();
    await driver.switchTo().window(original);
  } finally {
    await driver.switchTo().window(original);
    await keys("q");
  }
  await keys("a");
  await expectLabels(["a"]);
});

test("editing, native selects, and composition keep their normal keyboard input", async () => {
  await load('<input id="field"><div contenteditable id="edit"></div><select id="menu"><option>one</option><option>j</option></select><button>outside</button>');
  await keys("a", "a", "qjkfbgGa");
  assert.equal(await js("return field.value"), "qjkfbgGa");
  await js("edit.focus()");
  await keys("faqG");
  assert.equal(await js("return edit.textContent"), "faqG");
  await js("menu.focus()");
  await keys("j");
  assert.equal(await js("return menu.selectedIndex"), 1);
  await js("menu.blur(); window.dispatchEvent(new KeyboardEvent('keydown', {key:'a', isComposing:true, bubbles:true}))");
  await expectLabels([]);
  await keys("a");
  await expectLabels(["a", "b", "c", "d"]);
  await keys(Key.ESCAPE);
});

test("open shadow roots, slotted content and same-origin frames follow rendered document order", async () => {
  await load(`<button>first</button><section id="host"><button slot="action" id="slotted">slotted</button></section>
    <iframe src="/child"></iframe><a href="#last">last</a>
    <script>host.attachShadow({mode:"open"}).innerHTML='<button id="inside">shadow</button><slot name="action"></slot>';
      slotted.onclick=()=>document.body.dataset.chosen="slot";</script>`);
  await keys("a");
  await expectLabels(["a", "b", "c", "d", "e"]);
  await keys("c");
  assert.equal(await js("return document.body.dataset.chosen"), "slot");
  await keys("a", "d");
  assert.equal(await js("return document.querySelector('iframe').contentDocument.querySelector('button').dataset.clicked"), "1");
});

test("a separate-origin frame can be entered and navigated with only the keyboard", async () => {
  await load(`<iframe src="${origin.replace("127.0.0.1", "localhost")}/child"></iframe><button>outside</button>`);
  await keys("a");
  await expectLabels(["a", "b"]);
  await keys("a");
  assert.equal(await js("return document.activeElement.localName"), "iframe");
  // WebDriver directs action sequences to its selected browsing context.
  await driver.switchTo().frame(0);
  assert.ok(await js("return document.hasFocus()"));
  await keys("a", "a");
  assert.equal(await js("return document.querySelector('button').dataset.clicked"), "1");
  await driver.switchTo().defaultContent();
});

test("live visibility keeps existing labels stable and handles clipping, insertion and removal", async () => {
  await load(`<div id="clip" style="overflow:hidden;width:150px;height:12px">
    <button id="partial" style="height:80px">sliver</button><button>clipped</button></div>
    <button id="stay">stay</button><button id="gone">remove</button>`);
  await keys("a");
  await expectLabels(["a", "b", "c"]);
  await js("gone.remove(); const el=document.createElement('button'); el.textContent='new'; document.body.prepend(el)");
  await expectLabels(["d", "a", "b"]);
  await js("partial.style.visibility='hidden'");
  await expectLabels(["d", "b"]);
  await keys(Key.ESCAPE);
  await keys("a");
  await expectLabels(["a", "b"]);
});

test("three-letter labels remain reachable past zz", async () => {
  await load(`<style>main{display:grid;grid-template-columns:repeat(40,16px)}
    main button{width:16px;height:16px;min-height:0;padding:0}</style>
    <main>${Array.from({length:703}, (_, i) => `<button data-n="${i}"></button>`).join("")}</main>
    <script>document.querySelector("main").onclick=e=>document.body.dataset.chosen=e.target.dataset.n;</script>`);
  await keys("a");
  const all = await labels();
  assert.equal(all.length, 703);
  assert.deepEqual(all.slice(-3), ["zy", "zz", "aaa"]);
  await keys("a", "a", "a");
  assert.equal(await js("return document.body.dataset.chosen"), "702");
});

test("clicks respect new-tab links, form submission and canceled site handlers", async () => {
  await load(`<a href="/destination" target="_blank">New tab</a>
    <form action="/submit"><button name="from" value="hint">Submit</button></form>
    <a href="/ignored" onclick="event.preventDefault();this.dataset.stayed='yes'">Canceled</a>`);
  const initial = await driver.getWindowHandle();
  const previous = new Set(await driver.getAllWindowHandles());
  await keys("a");
  await expectLabels(["a", "b", "c"]);
  await keys("a");
  const other = await until(async () =>
    (await driver.getAllWindowHandles()).find(handle => !previous.has(handle)), "link opens a new tab");
  await driver.switchTo().window(other);
  await until(async () => await driver.getCurrentUrl() === origin + "/destination", "new tab loads destination");
  await driver.close();
  await driver.switchTo().window(initial);
  await keys("a", "c");
  assert.equal(await js("return document.querySelector('[href=\"/ignored\"]').dataset.stayed"), "yes");
  assert.equal(await driver.getCurrentUrl(), origin + "/");
  await keys("a", "b");
  await until(async () => await driver.getCurrentUrl() === origin + "/submit?from=hint", "native form submits");
});

test("hint styling and hit testing work on a page with a strict style policy", async () => {
  await load('<button>Start</button><a href="#finish">Finish</a>', "/strict-css");
  await keys("a");
  await expectLabels(["a", "b"]);
  const styles = await js(`const host=document.querySelector("[popover]");
    const badge=host.shadowRoot.querySelector(".badge");
    return [getComputedStyle(host).pointerEvents,getComputedStyle(badge).position,badge.offsetHeight]`);
  assert.deepEqual(styles, ["none", "absolute", 18]);
  await keys("b");
  assert.equal(await js("return location.hash"), "#finish");
});


require("./shortcut-cases.cjs")({ getDriver: () => driver, load, js, keys, until, getOrigin: () => origin, popupUrl });

// Marionette drives the native toolbar button. An extension tab observes the
// resulting popup using Firefox's getViews API while the fixture stays active.
function inPopup(script, ...args) {
  return js(`const view = browser.extension.getViews({ type: "popup" })[0];
    if (!view) return null;
    const doc = view.document;
    ${script}`, ...args);
}

async function pressToolbarButton() {
  await driver.setContext(firefox.Context.CHROME);
  try {
    const selector = `toolbarbutton.webextension-browser-action[data-extensionid="${addonId}"]`;
    await driver.findElement(By.css(selector)).click();
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
  await until(() => inPopup("return doc.querySelector('#tab-toggle') && !doc.querySelector('#tab-toggle').disabled"),
    "Firefox opened the toolbar popup on the fixture");
}

async function withToolbar(check) {
  const site = await driver.getWindowHandle();
  const siteUrl = await driver.getCurrentUrl();
  await driver.switchTo().newWindow("tab");
  const observer = await driver.getWindowHandle();
  try {
    await driver.get(popupUrl);
    await until(() => js("return document.querySelector('#tab-status').textContent === 'Unavailable on this page'"),
      "the popup disables its tab switch on an extension page");
    assert.ok(await js("return document.querySelector('#tab-toggle').disabled"));
    await js(async function (url) {
      const tabs = await browser.tabs.query({ currentWindow: true });
      const fixture = tabs.find(tab => tab.url === url);
      await browser.tabs.update(fixture.id, { active: true });
    }, siteUrl);
    await pressToolbarButton();
    await check();
  } finally {
    await driver.switchTo().window(observer);
    await driver.close();
    await driver.switchTo().window(site);
  }
}

test("the native Firefox toolbar icon opens the menu and its switch controls the current page", async () => {
  await load("<button>Visible action</button>", "/toolbar");
  await keys("q");
  await withToolbar(async () => {
    assert.equal(await inPopup("return doc.querySelector('#tab-toggle').getAttribute('aria-checked')"), "false");
    assert.equal(await inPopup("return doc.querySelector('#tab-status').textContent"), "Off for this tab");
    const icons = await js(async function () {
      const manifest = browser.runtime.getManifest();
      const registered = new Map([...Object.entries(manifest.icons), ...Object.entries(manifest.action.default_icon)]);
      return Promise.all([...registered].map(async ([size, file]) => {
        const image = new Image();
        image.src = browser.runtime.getURL(file);
        await image.decode();
        return [Number(size), image.naturalWidth, image.naturalHeight];
      }));
    });
    assert.ok(icons.some(([size]) => size === 16));
    assert.ok(icons.some(([size]) => size >= 64));
    for (const [size, width, height] of icons) assert.deepEqual([width, height], [size, size]);
    await inPopup("doc.querySelector('#tab-toggle').click()");
    await until(() => inPopup("return doc.querySelector('#tab-toggle').getAttribute('aria-checked') === 'true'"),
      "menu reflects the enabled tab");
  });
  await keys("a");
  await expectLabels(["a"]);
  await keys(Key.ESCAPE);
});

test("the toolbar shortcut editor records, disables, persists and restores a binding", async () => {
  await load('<div style="height:400vh">Scrollable page</div>', "/shortcut-editor");
  const record = '[data-command="scrollDown"] [data-record]';
  const enabled = '[data-command="scrollDown"] [data-enabled]';
  const click = selector => inPopup("doc.querySelector(arguments[0]).click()", selector);
  const keyLabel = () => inPopup("return doc.querySelector(arguments[0])?.textContent.trim()", record);
  async function openEditor() {
    await click("#open-shortcuts");
    await until(() => inPopup("return Boolean(doc.querySelector(arguments[0])?.getClientRects().length)", record),
      "shortcut editor displays the binding");
  }
  async function reopen() {
    await inPopup("view.close()");
    await until(() => js("return !browser.extension.getViews({type:'popup'}).length"), "previous popup closed");
    await pressToolbarButton();
    await openEditor();
  }

  await withToolbar(async () => {
    await openEditor();
    assert.equal(await keyLabel(), "j");
    await click(record);
    await until(() => inPopup("return doc.activeElement.id === 'capture-shortcut'"), "the recorder takes focus");
    await inPopup(`const input = doc.querySelector('#capture-shortcut');
      input.dispatchEvent(new view.KeyboardEvent('keydown',
        { key: 'z', code: 'KeyZ', bubbles: true, cancelable: true }));`);
    await until(async () => await keyLabel() === "z", "recorder shows the new binding");
    await click(enabled);
    await reopen();
    assert.equal(await keyLabel(), "z");
    assert.equal(await inPopup("return doc.querySelector(arguments[0]).checked", enabled), false);
    await click(enabled);
    await reopen();
    assert.equal(await inPopup("return doc.querySelector(arguments[0]).checked", enabled), true);
    await click("#reset-shortcuts");
    await click("#confirm-reset");
    await until(async () => await keyLabel() === "j", "confirmed reset restores the original binding");
  });
  await keys("z");
  assert.equal(await js("return scrollY"), 0);
  await keys("j");
  await until(() => js("return scrollY > 0"), "restored binding scrolls the website");
});
