import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const PAGES_ASSET_LIMIT = 25 * 1024 * 1024;
const GITHUB_API = 'https://api.github.com';
const numericVersion = /^(?:0|[1-9]\d{0,8})(?:\.(?:0|[1-9]\d{0,8})){2}$/;
const extensionId = /^[a-z0-9][a-z0-9-]{0,63}$/;
const githubRepository = /^https:\/\/github\.com\/([a-z0-9][a-z0-9-]{0,38})\/([a-zA-Z0-9_.-]{1,100})$/;
const commitSha = /^[0-9a-f]{40}$/;
const sha256 = /^[0-9a-f]{64}$/;
const packageFingerprint = /^package-extension:[0-9a-f]{64}$/;

export function githubReleaseUrl(entry, community = false) {
  if (!entry || typeof entry.extensionId !== 'string' || !extensionId.test(entry.extensionId) ||
      entry.packageKey !== `${entry.publisherId}/${entry.extensionId}` || !numericVersion.test(entry.version) ||
      !sha256.test(entry.sha256) || !packageFingerprint.test(entry.fingerprint)) {
    throw new Error('Invalid extension release');
  }
  const repository = community ? githubRepository.exec(entry.repositoryUrl) : null;
  if (community ? !repository || ['.', '..'].includes(repository[2]) || repository[1] !== entry.publisherId || entry.publisherId === 'muster' : entry.publisherId !== 'muster') {
    throw new Error(`Invalid release publisher: ${entry.packageKey}`);
  }
  const sourceRepository = repository ? `${repository[1]}/${repository[2]}` : `zhanghexie/muster-extension-${entry.extensionId}`;
  const url = new URL(entry.packageUrl);
  const pinned = new URL(`/repos/${sourceRepository}/contents/releases/${entry.version}.json`, GITHUB_API);
  const commit = url.searchParams.get('ref');
  if (url.origin !== pinned.origin || url.pathname !== pinned.pathname || url.username || url.password || url.hash ||
      url.searchParams.size !== 1 || !commitSha.test(commit ?? '')) {
    throw new Error(`Package must be pinned to its GitHub release: ${entry.packageKey}`);
  }
  return url;
}

export async function readPinnedGithubAsset(url, fetchImpl = fetch, token) {
  if (url.origin !== GITHUB_API || url.username || url.password || url.hash || !commitSha.test(url.searchParams.get('ref') ?? '')) {
    throw new Error('Expected a GitHub asset pinned to a commit');
  }
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/vnd.github.raw+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`${url.pathname}: HTTP ${response.status}`);
  if (!response.body) throw new Error(`${url.pathname}: empty response`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > PAGES_ASSET_LIMIT) throw new Error(`${url.pathname}: exceeds the Pages 25 MiB asset limit`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function writeAsset(destination, name, bytes) {
  const file = path.join(destination, ...name.split('/'));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes, { flag: 'wx' });
}

export async function buildExtensionCenterMirror({ catalog, communityCatalog, destination, baseUrl, fetchImpl = fetch, token }) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.href !== `${base.origin}/`) throw new Error('Mirror base URL must be an HTTPS origin');
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.releases) || !catalog.releases.length) {
    throw new Error('Invalid or empty GitHub extension catalog');
  }
  if (communityCatalog && (communityCatalog.schemaVersion !== 1 || !Array.isArray(communityCatalog.releases))) {
    throw new Error('Invalid community extension catalog');
  }

  const seen = new Set();
  const identify = (release, community) => {
    const sourceUrl = githubReleaseUrl(release, community);
    if (seen.has(release.extensionId)) throw new Error(`Duplicate extension ID: ${release.extensionId}`);
    seen.add(release.extensionId);
    if (release.screenshots?.length) throw new Error(`Mirror the screenshots before publishing ${release.packageKey}`);
    return { release, sourceUrl, community };
  };
  const sources = [...catalog.releases.map(release => identify(release, false)),
    ...(communityCatalog?.releases ?? []).map(release => identify(release, true))];

  const output = path.resolve(destination);
  await fs.mkdir(path.dirname(output), { recursive: true });
  const stage = await fs.mkdtemp(`${output}.staging-`);
  try {
    const releases = [];
    for (const { release, sourceUrl, community } of sources) {
      const bytes = await readPinnedGithubAsset(sourceUrl, fetchImpl, community ? undefined : token);
      if (createHash('sha256').update(bytes).digest('hex') !== release.sha256) {
        throw new Error(`SHA-256 mismatch: ${release.packageKey}@${release.version}`);
      }
      const name = `packages/${release.publisherId}/${release.extensionId}/${release.version}/${release.sha256}.json`;
      await writeAsset(stage, name, bytes);
      releases.push({ ...release, packageUrl: new URL(name, base).href });
    }
    await writeAsset(stage, 'catalog.json', `${JSON.stringify({ schemaVersion: 1, releases }, null, 2)}\n`);
    await writeAsset(stage, '_headers', '/catalog.json\n  Cache-Control: public, max-age=60\n/packages/*\n  Cache-Control: public, max-age=31536000, immutable\n/*\n  X-Content-Type-Options: nosniff\n');
    await fs.rename(stage, output);
    return releases;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { values } = parseArgs({ options: { catalog: { type: 'string' }, community: { type: 'string' }, output: { type: 'string' }, origin: { type: 'string' } } });
  if (!values.catalog || !values.output || !values.origin) throw new Error('Provide --catalog, --output and --origin');
  const releases = await buildExtensionCenterMirror({
    catalog: JSON.parse(await fs.readFile(values.catalog, 'utf8')),
    communityCatalog: values.community ? JSON.parse(await fs.readFile(values.community, 'utf8')) : undefined,
    destination: values.output,
    baseUrl: values.origin,
    token: process.env.GITHUB_TOKEN,
  });
  console.log(`Prepared a static mirror of ${releases.length} pinned extension packages`);
}
