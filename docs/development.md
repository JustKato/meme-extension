# Development and releases

## Run locally

Install Node.js 24.22.1 or newer in the 24.x line, desktop Firefox 140 or later and a geckodriver that supports `--allow-system-access` for the toolbar tests. CI uses geckodriver 0.37.1. Use the versions in `package-lock.json` with `npm ci`.

| Command | Result |
| --- | --- |
| `npm run lint` | Validate the manifest and packaged scripts with Mozilla's add-on linter. Warnings fail the run. |
| `npm run build` | Write `dist/meme-extension-<version>-unsigned.xpi` with the manifest at the archive root. |
| `npm test` | Lint, build, temporarily install the archive and send WebDriver keystrokes to local HTTP fixtures in Firefox. |

The tests use a disposable Firefox profile and bind their fixture server to the loopback interface. Set `FIREFOX_BIN` or `GECKODRIVER_BIN` to an absolute executable path when using a custom installation. For interactive debugging, use **This Firefox** in `about:debugging`, load `extension/manifest.json`, and click **Reload** after editing. Refresh the page being tested and reopen the toolbar popup to reload its HTML and scripts.

## Source layout

| File | Responsibility |
| --- | --- |
| `extension/keys.js` | Case-sensitive shortcuts, editable contexts, scroll targeting and key repeat. |
| `extension/targets.js` | Composed document order, frame geometry, visibility checks and DOM activation. |
| `extension/hints.js` | Label assignment, prefix matching, overlay placement and live page updates. |
| `extension/background.js` | Per-tab navigation state, tab operations and history navigation. |
| `extension/shortcuts.js` | Default bindings and shared shortcut handling. |
| `extension/popup.html`, `popup.js`, `popup.css` | Firefox toolbar popup, tab switch and shortcut editor. |
| `extension/icons/` | Pixel-art keycap at toolbar and Add-ons Manager sizes. The alternate PNGs live in [the logo gallery](logos/README.md). |
| `tests/firefox.test.cjs` | Firefox fixtures, toolbar popup tests and page interaction tests. |
| `tests/shortcut-cases.cjs` | Tab and history navigation, persistent remapping, disabling and restoring shortcuts. |

## GitHub Actions

Pull requests and branch pushes run the test workflow against stable Firefox and Firefox 140.0 ESR. On `main` and `v*` tags, the release workflow calls the same tests and downloads the exact XPI tested on stable Firefox. A failed test prevents publication.

The version in `extension/manifest.json` is the release version. Use three numeric components, `MAJOR.MINOR.PATCH`. Merging a new version into `main` creates the matching `vMAJOR.MINOR.PATCH` tag and GitHub release. Pushing a matching tag also supports a tag-driven release. To sign the current published version or retry an interrupted submission, open **Actions > Release > Run workflow** and select `main`. [Release workflow](https://github.com/JustKato/meme-extension/actions/workflows/release.yml)

The release includes the XPI and `SHA256SUMS`. Download the files named in the checksum list and run `sha256sum -c SHA256SUMS` in the download directory. A signed XPI added after publication has its own `.xpi.sha256` file. Download that pair and run `sha256sum -c meme-extension-<version>.xpi.sha256`.

## Mozilla signing

Without signing credentials, GitHub publishes the tested `-unsigned.xpi` for temporary loading. Standard Firefox requires a Mozilla signature for permanent installation. [Mozilla signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)

1. Sign in to Mozilla Add-ons (AMO) with the account that owns the extension. For a first submission, use the account that should own future updates. Enable two-factor authentication and accept the Firefox Add-on Distribution Agreement if prompted. [AMO API credentials](https://addons.mozilla.org/en-US/developers/addon/api/key/)
2. Use your existing JWT credentials or generate a pair. Complete Mozilla's email confirmation if prompted. Store the two values under **New repository secret** in the repository's Actions settings. [GitHub Actions secrets](https://github.com/JustKato/meme-extension/settings/secrets/actions)

| GitHub Actions secret | AMO API credential |
| --- | --- |
| `AMO_JWT_ISSUER` | JWT issuer |
| `AMO_JWT_SECRET` | JWT secret |

Run the Release workflow on `main` after saving the secrets. It requests **unlisted** signing so users can install the signed XPI directly from GitHub. To add a signature to an existing release, the workflow uses that release's unsigned XPI and checks its contents against the tag. The signed download is named `meme-extension-<version>.xpi`. Future releases use the same credentials. [Mozilla signing reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign)
