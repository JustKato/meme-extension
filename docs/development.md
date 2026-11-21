# Development and releases

## Run locally

Install Node.js 24.22.1 or newer in the 24.x line, desktop Firefox 140 or later and geckodriver. Use the versions in `package-lock.json` with `npm ci`.

| Command | Result |
| --- | --- |
| `npm run lint` | Validate the manifest and packaged scripts with Mozilla's add-on linter. Warnings fail the run. |
| `npm run build` | Write `dist/meme-extension-<version>-unsigned.xpi` with the manifest at the archive root. |
| `npm test` | Lint, build, temporarily install the archive and send WebDriver keystrokes to local HTTP fixtures in Firefox. |

The tests use a disposable Firefox profile and bind their fixture server to the loopback interface. Set `FIREFOX_BIN` or `GECKODRIVER_BIN` to an absolute executable path when using a custom installation. For interactive debugging, use **This Firefox** in `about:debugging`, load `extension/manifest.json`, and click **Reload** after editing. Refresh the page being tested.

## Source layout

| File | Responsibility |
| --- | --- |
| `extension/keys.js` | Case-sensitive shortcuts, editable contexts, scroll targeting and key repeat. |
| `extension/targets.js` | Composed document order, frame geometry, visibility checks and DOM activation. |
| `extension/hints.js` | Label assignment, prefix matching, overlay placement and live page updates. |
| `extension/background.js` | Tab-scoped enable flags and synchronization across frames. |
| `tests/firefox.test.cjs` | End-to-end tests of the packaged extension in Firefox. |

## GitHub Actions

Pull requests and branch pushes run the test workflow against stable Firefox and Firefox 140.0 ESR. On `main` and `v*` tags, the release workflow calls the same tests and downloads the exact XPI tested on stable Firefox. A failed test prevents publication.

The version in `extension/manifest.json` is the release version. Use three numeric components, `MAJOR.MINOR.PATCH`. Merging a new version into `main` creates the matching `vMAJOR.MINOR.PATCH` tag and GitHub release. Pushing a matching tag also supports a tag-driven release. An existing published version is skipped. **Actions > Release > Run workflow** can retry a release after an infrastructure failure. Select the intended commit's branch or tag.

The release includes the XPI and `SHA256SUMS`. After downloading both, run `sha256sum -c SHA256SUMS` in the download directory. When both signed and unsigned packages are published, download both to verify the complete checksum file.

## Mozilla signing

Without signing credentials, GitHub publishes the tested `-unsigned.xpi` for temporary loading. Standard Firefox requires a Mozilla signature for permanent installation. [Mozilla signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)

To attach a signed XPI to future releases, create an AMO API key for the add-on owner and set both repository Actions secrets before releasing.

| GitHub Actions secret | AMO API credential |
| --- | --- |
| `AMO_JWT_ISSUER` | JWT issuer |
| `AMO_JWT_SECRET` | JWT secret |

The release job requests unlisted signing with `web-ext sign` and attaches the returned signed XPI alongside the tested unsigned build. The unlisted channel supports distribution on GitHub. Partial credentials or a signing error fail the publish job. [Mozilla web-ext signing reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign)
