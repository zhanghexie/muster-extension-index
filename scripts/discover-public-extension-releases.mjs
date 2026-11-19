import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { githubReleaseUrl, readPinnedGithubAsset } from './build-extension-center-mirror.mjs';
import { compareVersions, parseReleaseTags, readReleaseTags } from './extension-version-tags.mjs';

function readManifest(bytes, entry, version) {
  const artifact = JSON.parse(bytes.toString('utf8'));
  if (artifact.schemaVersion !== 1 || artifact.extensionId !== entry.extensionId ||
      !/^package-extension:[a-f0-9]{64}$/.test(artifact.fingerprint) || !Array.isArray(artifact.directories) || !Array.isArray(artifact.files)) {
    throw new Error('Invalid extension package output');
  }
  const manifests = artifact.files.filter(file => file?.path === 'extension.json');
  if (manifests.length !== 1 || typeof manifests[0].bytesBase64 !== 'string') throw new Error('Missing or duplicate extension.json');
  const manifest = JSON.parse(Buffer.from(manifests[0].bytesBase64, 'base64').toString('utf8'));
  if (!manifest || manifest.id !== entry.extensionId || manifest.scope !== 'global' || manifest.version !== version ||
      typeof manifest.name !== 'string' || !manifest.name) throw new Error('Package manifest does not match its approved extension ID and tag');
  return { manifest, fingerprint: artifact.fingerprint, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function reviewFields(manifest) {
  return { permissions: Array.isArray(manifest.permissions) ? manifest.permissions.filter(value => typeof value === 'string') : [],
    surface: manifest.surface?.entry, domain: manifest.domain?.entry, commands: manifest.commandEntry,
    mcpCount: Array.isArray(manifest.agent?.mcp) ? manifest.agent.mcp.length : 0 };
}

export async function proposeCommunityExtension({ repositoryUrl, catalog, community, readTags = readReleaseTags, fetchImpl = fetch }) {
  const match = /^https:\/\/github\.com\/([a-zA-Z0-9][a-zA-Z0-9-]{0,38})\/([a-zA-Z0-9_.-]{1,100})\/?$/.exec(repositoryUrl.trim());
  if (!match || ['.', '..'].includes(match[2])) throw new Error('Provide a public GitHub repository URL');
  const publisherId = match[1].toLowerCase();
  const repository = `${publisherId}/${match[2]}`;
  const homepage = `https://github.com/${repository}`;
  const tags = parseReleaseTags(await readTags(`${homepage}.git`));
  const version = [...tags.keys()].sort(compareVersions).at(-1);
  if (!version) throw new Error('The repository has no stable vX.Y.Z tag');
  const sourceCommit = tags.get(version);
  const packageUrl = new URL(`https://api.github.com/repos/${repository}/contents/releases/${version}.json`);
  packageUrl.searchParams.set('ref', sourceCommit);
  const bytes = await readPinnedGithubAsset(packageUrl, fetchImpl);
  const { extensionId } = JSON.parse(bytes.toString('utf8'));
  const { manifest, sha256, fingerprint } = readManifest(bytes, { extensionId }, version);
  const packageKey = `${publisherId}/${extensionId}`;
  const entry = { packageKey, publisherId, extensionId, version, name: manifest.name, repositoryUrl: homepage,
    ...(typeof manifest.description === 'string' && manifest.description ? { description: manifest.description } : {}),
    packageUrl: packageUrl.href, sha256, fingerprint };
  githubReleaseUrl(entry, true);
  if ([...catalog.releases, ...community.releases].some(release => release.extensionId === extensionId)) {
    throw new Error(`Extension ID ${extensionId} is already registered`);
  }
  return { catalog, community: { schemaVersion: 1, releases: [...community.releases, entry] },
    candidates: [{ packageKey, version, sourceCommit, after: reviewFields(manifest) }], errors: [] };
}

export async function discoverPublicExtensionReleases({ catalog, community, readTags = readReleaseTags, fetchImpl = fetch, token }) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.releases) || !catalog.releases.length ||
      community?.schemaVersion !== 1 || !Array.isArray(community.releases)) throw new Error('Invalid approved extension catalogs');

  const candidates = [];
  const errors = [];
  const discover = async (entry, fromCommunity) => {
    const published = githubReleaseUrl(entry, fromCommunity);
    const repository = published.pathname.split('/').slice(2, 4).join('/');
    try {
      const tags = parseReleaseTags(await readTags(`https://github.com/${repository}.git`));
      if (tags.get(entry.version) !== published.searchParams.get('ref')) throw new Error(`Published tag v${entry.version} moved or disappeared`);
      const version = [...tags.keys()].filter(version => compareVersions(version, entry.version) > 0).sort(compareVersions).at(-1);
      if (!version) return entry;

      const sourceCommit = tags.get(version);
      const url = new URL(`/repos/${repository}/contents/releases/${version}.json`, published.origin);
      url.searchParams.set('ref', sourceCommit);
      const [before, after] = await Promise.all([
        readPinnedGithubAsset(published, fetchImpl, fromCommunity ? undefined : token).then(bytes => readManifest(bytes, entry, entry.version)),
        readPinnedGithubAsset(url, fetchImpl, fromCommunity ? undefined : token).then(bytes => readManifest(bytes, entry, version)),
      ]);
      if (before.sha256 !== entry.sha256 || before.fingerprint !== entry.fingerprint) throw new Error('Previously approved package does not match its checksums');
      candidates.push({ packageKey: entry.packageKey, version, sourceCommit, before: reviewFields(before.manifest), after: reviewFields(after.manifest) });
      const { updatedAt, releaseNotes, ...release } = entry;
      return { ...release, version, name: after.manifest.name,
        ...(typeof after.manifest.description === 'string' && after.manifest.description ? { description: after.manifest.description } : {}),
        packageUrl: url.href, fingerprint: after.fingerprint, sha256: after.sha256,
        previousFingerprints: [...new Set([entry.fingerprint, ...(entry.previousFingerprints ?? [])])].slice(0, 100) };
    } catch (error) {
      errors.push({ packageKey: entry.packageKey, error: error.message });
      return entry;
    }
  };

  const rescan = async (input, fromCommunity) => {
    const releases = [];
    for (const entry of input.releases) releases.push(await discover(entry, fromCommunity));
    return { schemaVersion: 1, releases };
  };
  return { catalog: await rescan(catalog, false), community: await rescan(community, true), candidates, errors };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { values } = parseArgs({ options: { catalog: { type: 'string' }, community: { type: 'string' }, output: { type: 'string' }, repository: { type: 'string' } } });
  if (!values.catalog || !values.community || !values.output) throw new Error('Provide --catalog, --community and --output');
  const input = {
    catalog: JSON.parse(await fs.readFile(values.catalog, 'utf8')),
    community: JSON.parse(await fs.readFile(values.community, 'utf8')),
  };
  const result = values.repository ? await proposeCommunityExtension({ ...input, repositoryUrl: values.repository })
    : await discoverPublicExtensionReleases({ ...input, token: process.env.GITHUB_TOKEN });
  await fs.mkdir(values.output);
  for (const [name, data] of [['catalog.json', result.catalog], ['community-catalog.json', result.community], ['review.json', { candidates: result.candidates, errors: result.errors }]]) {
    await fs.writeFile(path.join(values.output, name), `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
  }
  console.log(`${result.candidates.length} candidate versions, ${result.errors.length} source errors`);
  for (const failure of result.errors) console.error(`${failure.packageKey}: ${failure.error}`);
  if (result.errors.length) process.exitCode = 1;
}
