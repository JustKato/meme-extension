# Meme Keyboard Navigation

A Firefox extension for browsing with one hand on the keyboard. Press `a` on a page to put a small letter label on each visible link and control. Type a label to activate it.

## Install

Download the XPI from the [GitHub releases](https://github.com/JustKato/meme-extension/releases/latest).

- For an XPI ending in `-unsigned.xpi`, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select the downloaded file. It stays active until you restart Firefox.
- When a release includes a Mozilla-signed `.xpi`, open `about:addons`, choose the gear menu, then **Install Add-on From File** for a persistent installation.

Open a regular website to try the keys. Firefox reserves its settings pages, PDF viewer and some Mozilla sites. Desktop Firefox 140 or later is supported. [Firefox compatibility](docs/keyboard.md#firefox-compatibility)

## Controls

| Key | Action |
| --- | --- |
| `q` | Turn navigation off or on for the current tab. New tabs start enabled. |
| `j` / `k` | Scroll down / up one line. Hold to repeat. |
| `f` / `b` | Scroll down / up one page. |
| `g` / `G` | Jump to the top / bottom of the scrolling area. |
| `a` | Show labels for visible links, buttons and other interactive controls. |
| `Esc` | Leave hint mode. |
| `Backspace` | Remove the last letter of a partially typed label. |
| `Enter` | Activate a complete label that is also the start of a longer one. |

Keys are case-sensitive. In text fields, editors and native selects, typing belongs to the page. Shortcuts with Ctrl, Alt or Meta also pass through.

Labels follow page order, starting at `a` and continuing through `z`, `aa`, `ab`, and so on. With 27 controls, press `a` to open the hints. Type `aa` to click the 27th control, or type `a` and press Enter to click the first. A complete, unambiguous label activates immediately. Inside hint mode, `q` is a label letter. Press Esc first to use the toggle.

## Development

Use Node.js 24.22.1 or later in the 24.x line, Firefox, and geckodriver on your PATH.

```sh
npm ci
npm test
```

The test command lints the extension, builds an XPI into `dist/`, then installs that XPI into a fresh headless Firefox profile and exercises the keyboard controls. To try a working copy interactively, load `extension/manifest.json` as a temporary add-on.

- [Keyboard behavior, supported elements and site compatibility](docs/keyboard.md)
- [Local testing, GitHub Actions and release signing](docs/development.md)
