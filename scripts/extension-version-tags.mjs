import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const versionPattern = '(?:0|[1-9]\\d{0,8})(?:\\.(?:0|[1-9]\\d{0,8})){2}';
const releaseTag = new RegExp(`^([0-9a-f]{40})\\s+refs/tags/v(${versionPattern})(\\^\\{\\})?$`);

export function compareVersions(a, b) {
  const right = b.split('.').map(Number);
  for (const [index, left] of a.split('.').map(Number).entries()) {
    if (left !== right[index]) return left - right[index];
  }
  return 0;
}

export function parseReleaseTags(stdout) {
  const tagged = new Map();
  const peeled = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    const match = releaseTag.exec(line);
    if (!match) continue;
    const [, sha, version, annotated] = match;
    (annotated ? peeled : tagged).set(version, sha);
  }
  for (const [version, sha] of peeled) {
    if (tagged.has(version)) tagged.set(version, sha);
  }
  return tagged;
}

export async function readReleaseTags(repository) {
  const { stdout } = await exec('git', ['-c', 'http.followRedirects=false', 'ls-remote', '--tags', repository], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  });
  return stdout;
}
