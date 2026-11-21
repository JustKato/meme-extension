import { execFileSync } from 'node:child_process';
import { constants, copyFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Client, { JwtApiAuth, signAddon } from 'web-ext/util/submit-addon';

// Use the same AMO client as web-ext sign, with the tested XPI as its input.
const [unsigned, destination, version] = process.argv.slice(2);
const manifest = JSON.parse(execFileSync('unzip', ['-p', unsigned, 'manifest.json'], { encoding: 'utf8' }));
const id = manifest.browser_specific_settings.gecko.id;
if (!id || manifest.version !== version) throw new Error('Release and manifest ID/version check failed.');

const apiKey = process.env.WEB_EXT_API_KEY;
const apiSecret = process.env.WEB_EXT_API_SECRET;
const baseUrl = new URL('https://addons.mozilla.org/api/v5/');
const downloadDir = await mkdtemp(join(tmpdir(), 'signed-firefox-'));
const client = new Client({ apiAuth: new JwtApiAuth({ apiKey, apiSecret }), baseUrl, downloadDir });
const versionUrl = new URL(`addons/addon/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/`, baseUrl);
versionUrl.searchParams.set('filter', 'all_with_unlisted');
const response = await client.fetch(versionUrl);
let downloaded;
if (response.status === 404) {
  const result = await signAddon({
    apiKey, apiSecret, amoBaseUrl: baseUrl, id, xpiPath: unsigned, channel: 'unlisted', downloadDir,
    savedUploadUuidPath: join(downloadDir, 'upload.json'),
  });
  if (result.downloadedFiles?.length !== 1) throw new Error('AMO did not return a signed XPI.');
  downloaded = join(downloadDir, result.downloadedFiles[0]);
} else {
  if (!response.ok) throw new Error(`Could not read AMO submission status (HTTP ${response.status}).`);
  const existing = await response.json();
  if (existing.channel !== 'unlisted' || existing.version !== version || existing.is_disabled) {
    throw new Error('This AMO version already exists in another channel or is disabled. Check the AMO Developer Hub.');
  }
  if (existing.file?.status !== 'public') {
    throw new Error(`AMO has already received ${version} (status: ${existing.file?.status}). Rerun Release on main after approval.`);
  }
  const fileUrl = new URL(existing.file.url);
  if (![baseUrl.origin, 'https://addons.cdn.mozilla.net'].includes(fileUrl.origin)) {
    throw new Error('Unexpected AMO download origin.');
  }
  console.log(`Retrieving the previously approved unlisted version ${version}.`);
  const file = fileUrl.origin === baseUrl.origin ? await client.fetch(fileUrl) : await fetch(fileUrl);
  if (!file.ok || !file.body) throw new Error(`Could not download the signed XPI (HTTP ${file.status}).`);
  downloaded = join(downloadDir, 'approved.xpi');
  await client.saveToFile(file.body, downloaded);
}
await copyFile(downloaded, destination, constants.COPYFILE_EXCL);
