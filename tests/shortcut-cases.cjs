const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Key, error: webdriverErrors } = require("selenium-webdriver");

module.exports = function shortcutCases({ getDriver, load, js, keys, until, getOrigin, popupUrl }) {
  async function closeExtraTabs(driver, previous, original) {
    for (const handle of await driver.getAllWindowHandles()) {
      if (!previous.has(handle)) {
        await driver.switchTo().window(handle);
        await driver.close();
      }
    }
    await driver.switchTo().window(original);
  }

  test("t and x open and close the foreground tab, and h and l follow the visible tab order in this window", async () => {
    const driver = getDriver();
    const original = await driver.getWindowHandle();
    const previous = new Set(await driver.getAllWindowHandles());
    const fixture = "<button autofocus>Action</button>";

    async function tab(name) {
      await driver.switchTo().newWindow("tab");
      await load(fixture, "/tabs/" + name);
      return driver.getWindowHandle();
    }

    async function switchBy(key, from, target) {
      await driver.switchTo().window(from);
      await js("return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      await keys(key);
      // Inspect Firefox's actual selection before WebDriver focuses the target.
      await driver.setContext("chrome");
      try {
        const destination = getOrigin() + "/tabs/" + target;
        await until(async () => await js("return window.gBrowser.selectedBrowser.currentURI.spec") === destination,
          key + " selects the " + target + " tab");
      } finally {
        await driver.setContext("content");
      }
    }

    try {
      await driver.switchTo().newWindow("window");
      await load(fixture, "/tabs/left");
      const left = await driver.getWindowHandle();
      const middle = await tab("middle");
      const right = await tab("right");

      await switchBy("h", right, "middle");
      await switchBy("l", middle, "right");
      await switchBy("l", right, "left");
      await switchBy("h", left, "right");
      await driver.switchTo().window(right);

      const beforeOpen = new Set(await driver.getAllWindowHandles());
      await keys("t");
      const added = await until(async () => (await driver.getAllWindowHandles()).find(handle => !beforeOpen.has(handle)),
        "t opens a new tab");
      await until(() => js("return document.hidden"), "t moves focus to the new tab");

      // The new tab's browser-owned page has no content script. Close a normal
      // fixture with x while the other tabs, including the new one, are open.
      await driver.switchTo().window(middle);
      try {
        await keys("x");
      } catch (error) {
        // Firefox may close the browsing context before WebDriver sends keyup.
        if (!(error instanceof webdriverErrors.NoSuchWindowError)) throw error;
      }
      await until(async () => !(await driver.getAllWindowHandles()).includes(middle), "x closes the middle tab");
      const remaining = await driver.getAllWindowHandles();
      for (const handle of [left, right, added, original]) assert.ok(remaining.includes(handle));
    } finally {
      await closeExtraTabs(driver, previous, original);
    }
  });

  async function withSettings(run) {
    const driver = getDriver();
    const page = await driver.getWindowHandle();
    const previous = new Set(await driver.getAllWindowHandles());
    const send = message => js("return window.browser.runtime.sendMessage(arguments[0])", message);
    const update = (id, patch) => send({ type: "update-shortcut", id, patch });
    const reset = () => send({ type: "reset-shortcuts" });
    let settings;

    try {
      await driver.switchTo().newWindow("tab");
      settings = await driver.getWindowHandle();
      await driver.get(popupUrl);

      await run({ driver, page, settings, update, reset });
    } finally {
      try {
        if (settings && (await driver.getAllWindowHandles()).includes(settings)) {
          await driver.switchTo().window(settings);
          await reset();
        }
      } finally {
        await closeExtraTabs(driver, previous, page);
      }
    }
  }

  async function arrive(driver, url, description) {
    await until(async () => await driver.getCurrentUrl() === url, description);
    await js("return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  }

  test("Ctrl+h and Ctrl+l traverse the focused tab's history", async () => {
    const driver = getDriver();
    const original = await driver.getWindowHandle();
    const previous = new Set(await driver.getAllWindowHandles());
    try {
      // A navigation on keydown can move WebDriver's synthetic Control keyup
      // to the destination. Use a dedicated tab so its cached documents and
      // their virtual input state are discarded before testing bare keys.
      await driver.switchTo().newWindow("tab");
      await load("<button>First</button>", "/chord/first");
      await load("<button>Second</button>", "/chord/second");
      await driver.actions().keyDown(Key.CONTROL).sendKeys("h").keyUp(Key.CONTROL).perform();
      await arrive(driver, getOrigin() + "/chord/first", "Ctrl+h goes back");
      await driver.actions().keyDown(Key.CONTROL).sendKeys("l").keyUp(Key.CONTROL).perform();
      await arrive(driver, getOrigin() + "/chord/second", "Ctrl+l goes forward");
    } finally {
      await closeExtraTabs(driver, previous, original);
    }
  });

  test("history bindings support persistent remapping, disabling, editor passthrough and restoring defaults", () =>
    withSettings(async ({ driver, page, settings, update, reset }) => {
      const defaults = (await reset()).bindings;
      await driver.switchTo().window(page);
      const fixture = '<input id="input"><button>Action</button>';
      const first = getOrigin() + "/history/first";
      const second = getOrigin() + "/history/second";
      await load(fixture, "/history/first");
      await load(fixture, "/history/second");

      await driver.switchTo().window(settings);
      for (const [id, key] of Object.entries({
        newTab: "t", closeTab: "x", previousTab: "h", nextTab: "l", back: "Ctrl+h", forward: "Ctrl+l"
      })) assert.deepEqual(defaults[id], { key, enabled: true });

      assert.equal((await update("back", { key: "u" })).bindings.back.key, "u");
      assert.equal((await update("forward", { key: "i" })).bindings.forward.key, "i");
      assert.ok((await update("forward", { key: "u" })).error, "duplicate active keys report a conflict");

      await driver.switchTo().window(page);
      await driver.navigate().refresh();
      await arrive(driver, second, "reloaded page has new bindings");
      await js("document.querySelector('#input').focus()");
      await keys("u");
      assert.equal(await js("return document.querySelector('#input').value"), "u");
      await js("document.activeElement.blur()");
      await keys("u");
      await arrive(driver, first, "remapped back navigates this tab");

      await driver.switchTo().window(settings);
      await driver.navigate().refresh();
      const disabled = await update("forward", { enabled: false });
      assert.deepEqual(disabled.bindings.forward, { key: "i", enabled: false });
      await driver.switchTo().window(page);
      await js("window.pressed=[]; window.addEventListener('keydown', event => pressed.push(event.key))");
      await keys("i");
      assert.deepEqual(await js("return window.pressed"), ["i"]);
      assert.equal(await driver.getCurrentUrl(), first);

      await driver.switchTo().window(settings);
      assert.equal((await update("forward", { enabled: true })).bindings.forward.key, "i");
      await driver.switchTo().window(page);
      await keys("i");
      await arrive(driver, second, "re-enabled forward navigates");
      await driver.switchTo().window(settings);
      assert.deepEqual((await reset()).bindings, defaults);
      await driver.switchTo().window(page);
      await js("window.lastSiteKey=null; window.addEventListener('keydown', event => window.lastSiteKey=event.key)");
      await keys("u");
      assert.equal(await js("return window.lastSiteKey"), "u");
      assert.equal(await driver.getCurrentUrl(), second);
    })
  );

  test("remapped hint controls confirm or correct a prefix and keep Tab available when cancel is disabled", () =>
    withSettings(async ({ driver, page, settings, update }) => {
      const actions = { confirmHint: "Delete", editHint: "ArrowLeft", cancelHint: "F8" };
      for (const [id, key] of Object.entries(actions)) {
        assert.deepEqual((await update(id, { key })).bindings[id], { key, enabled: true });
      }
      await driver.switchTo().window(page);
      await load(Array.from({ length: 27 }, (_, i) =>
        `<button onclick="document.body.dataset.chosen='${i}'">${i}</button>`).join(" "));
      const hintRoot = 'document.querySelector("[popover]")?.shadowRoot';
      const count = () => js(`return ${hintRoot}?.querySelectorAll(".badge").length || 0`);
      const prompt = () => js(`return ${hintRoot}?.querySelector(".message")?.textContent || ""`);
      await js("window.seen=[]; window.addEventListener('keydown', e=>window.seen.push(e.key))");
      await keys("a", "a");
      assert.equal(await count(), 2);
      assert.match(await prompt(), /Delete/);
      await keys(Key.ENTER);
      assert.equal(await js("return document.body.dataset.chosen || null"), null);
      assert.ok((await js("return window.seen")).includes("Enter"));
      await keys(Key.ARROW_LEFT);
      assert.equal(await count(), 27);
      await keys("a", Key.DELETE);
      assert.equal(await js("return document.body.dataset.chosen"), "0");
      await keys("a", Key.F8);
      assert.equal(await count(), 0);

      // Disabling the cancel/confirm commands leaves native focus traversal available.
      await driver.switchTo().window(settings);
      for (const id of ["cancelHint", "confirmHint"]) {
        assert.equal((await update(id, { enabled: false })).bindings[id].enabled, false);
      }
      await driver.switchTo().window(page);
      await keys("a", "a", Key.F8, Key.DELETE);
      assert.equal(await count(), 2);
      assert.doesNotMatch(await prompt(), /Delete/);
      await keys(Key.TAB);
      assert.equal(await count(), 0);
    })
  );
};
