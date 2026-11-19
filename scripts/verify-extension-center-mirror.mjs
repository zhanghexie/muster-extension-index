import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { PAGES_ASSET_LIMIT } from './build-extension-center-mirror.mjs';

const [originArg, expectedFile] = process.argv.slice(2);
if (!originArg || !expectedFile) throw new Error('Provide the Pages origin and expected catalog file');
const origin = new URL(originArg);
const expected = await fs.readFile(expectedFile);
const catalogUrl = new URL('/catalog.json', origin);

async function request(url, timeout) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.pathname}`);
  return response;
}

let live;
let failure;
for (let attempt = 0; attempt < 6; attempt++) {
  try {
    // Distinguish the new deployment from a previously cached copy.
    catalogUrl.searchParams.set('revision', `${createHash('sha256').update(expected).digest('hex')}-${attempt}`);
    const response = await request(catalogUrl, 15_000);
    const received = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(received, expected, 'Production catalog differs from the approved output');
    live = JSON.parse(received);
    break;
  } catch (error) {
    failure = error;
    if (attempt < 5) await delay(5_000);
  }
}
if (!live) throw failure;

for (const release of live.releases) {
  const url = new URL(release.packageUrl);
  assert.equal(url.origin, origin.origin, 'Package origin must match the production catalog');
  const digest = createHash('sha256');
  const response = await request(url, 40_000);
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    assert(size <= PAGES_ASSET_LIMIT, 'Package exceeds the Pages file limit');
    digest.update(chunk);
  }
  assert.equal(digest.digest('hex'), release.sha256, release.packageKey);
  console.log(`${release.packageKey}@${release.version} · ${size} bytes · SHA-256 OK`);
}
