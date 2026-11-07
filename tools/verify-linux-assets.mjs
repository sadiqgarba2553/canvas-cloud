import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';

const [repository, tag, directory, mode] = process.argv.slice(2);
if (!repository || !tag || !directory) throw new Error('Expected repository, tag, asset directory and optional public mode');
const lookup = spawnSync('gh', ['release', 'view', tag, '--repo', repository, '--json', 'databaseId'], { encoding: 'utf8' });
if (lookup.status !== 0) throw new Error('Could not find the Linux release');
const releaseId = JSON.parse(lookup.stdout).databaseId;
const response = spawnSync('gh', ['api', `repos/${repository}/releases/${releaseId}`], { encoding: 'utf8' });
if (response.status !== 0) throw new Error('Could not inspect the release');
const release = JSON.parse(response.stdout);
const files = await readdir(directory);
for (const name of files) {
  const file = `${directory}/${name}`;
  const info = await stat(file);
  if (!info.isFile()) throw new Error('Unexpected directory in release assets');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const expected = hash.digest('hex');
  const asset = release.assets.find(asset => asset.name === name);
  if (!asset || asset.state !== 'uploaded' || asset.size !== info.size || asset.digest !== `sha256:${expected}`) {
    throw new Error(`Uploaded asset failed integrity verification: ${name}`);
  }
  if (mode === 'public') {
    const download = await fetch(asset.browser_download_url);
    if (!download.ok || !download.body) throw new Error(`Public download failed: ${name}`);
    const publicHash = createHash('sha256');
    let size = 0;
    for await (const chunk of download.body) { publicHash.update(chunk); size += chunk.length; }
    if (size !== info.size || publicHash.digest('hex') !== expected) throw new Error(`Public download mismatch: ${name}`);
  }
  console.log(`Verified ${mode === 'public' ? 'public download' : 'uploaded asset'}: ${name}`);
}
