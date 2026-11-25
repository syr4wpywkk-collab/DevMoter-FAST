// Verifies that each vendored engine is exactly the upstream commit pinned in
// engines/manifest.json.
//
//   node scripts/upstream/verify.ts [--online] [--json]
//
// Offline: the git tree of each engine directory at HEAD must equal the pinned
// tree, and the directory must have no uncommitted changes. Git trees are
// content-addressed, so equal tree ids mean byte-identical files, names and modes.
// --online additionally asks GitHub that the pinned commit exists upstream,
// has that tree, and is contained in the pinned branch.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface EnginePin {
  name: string;
  directory: string;
  repository: string;
  branch: string;
  commit: string;
  commitDate: string;
  tree: string;
  upstreamVersion: string;
  licenseFile: string;
}

export interface Manifest {
  schemaVersion: 1;
  engines: EnginePin[];
}

export interface Finding {
  rule: string;
  engine: string;
  message: string;
}

/** Runs git in the repository and returns trimmed stdout; rejects on a non-zero exit. */
export type Git = (args: string[]) => Promise<string>;
/** Fetches a GitHub API path such as `/repos/o/r/git/commits/<sha>` and returns the parsed JSON. */
export type GitHubApi = (apiPath: string) => Promise<unknown>;

const SHA1 = /^[0-9a-f]{40}$/;
const NAME = /^[a-z][a-z0-9-]*$/;
const REPOSITORY = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const BRANCH = /^[A-Za-z0-9._/-]+$/;
const STRING_FIELDS = ['name', 'directory', 'repository', 'branch', 'commit', 'commitDate', 'tree', 'upstreamVersion', 'licenseFile'] as const;

export function parseManifest(value: unknown): { manifest?: Manifest; findings: Finding[] } {
  const findings: Finding[] = [];
  const fail = (engine: string, message: string) => findings.push({ rule: 'manifest', engine, message });
  const root = value as { schemaVersion?: unknown; engines?: unknown } | null;
  if (typeof root !== 'object' || root === null || root.schemaVersion !== 1 || !Array.isArray(root.engines)) {
    fail('(manifest)', 'expected { "schemaVersion": 1, "engines": [...] }');
    return { findings };
  }
  const seenNames = new Set<string>();
  const seenDirectories = new Set<string>();
  for (const [index, raw] of root.engines.entries()) {
    const entry = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const label = typeof entry.name === 'string' ? entry.name : `engines[${index}]`;
    const missing = STRING_FIELDS.filter((field) => typeof entry[field] !== 'string' || entry[field] === '');
    if (missing.length > 0) {
      fail(label, `missing or empty: ${missing.join(', ')}`);
      continue;
    }
    const pin = entry as unknown as EnginePin;
    if (!NAME.test(pin.name)) fail(label, `name "${pin.name}" must be lowercase letters, digits and dashes`);
    if (pin.directory !== `engines/${pin.name}`) fail(label, `directory must be engines/${pin.name}`);
    if (!REPOSITORY.test(pin.repository)) fail(label, 'repository must be https://github.com/<owner>/<repo>');
    if (!BRANCH.test(pin.branch)) fail(label, 'branch has unexpected characters');
    if (!SHA1.test(pin.commit)) fail(label, 'commit must be a full 40-character SHA');
    if (!SHA1.test(pin.tree)) fail(label, 'tree must be a full 40-character SHA');
    if (Number.isNaN(Date.parse(pin.commitDate))) fail(label, 'commitDate is not a date');
    if (pin.licenseFile.startsWith('/') || pin.licenseFile.split('/').includes('..')) fail(label, 'licenseFile must be a path inside the engine directory');
    if (seenNames.has(pin.name)) fail(label, 'duplicate name');
    if (seenDirectories.has(pin.directory)) fail(label, 'duplicate directory');
    seenNames.add(pin.name);
    seenDirectories.add(pin.directory);
  }
  if (findings.length > 0) return { findings };
  return { manifest: root as Manifest, findings };
}

export async function verifyVendoredTrees(manifest: Manifest, git: Git): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const pin of manifest.engines) {
    let tree: string;
    try {
      tree = await git(['rev-parse', '--verify', `HEAD:./${pin.directory}`]);
    } catch {
      findings.push({ rule: 'vendored-tree', engine: pin.name, message: `${pin.directory} does not exist at HEAD` });
      continue;
    }
    if (tree !== pin.tree) {
      findings.push({
        rule: 'vendored-tree',
        engine: pin.name,
        message: `${pin.directory} has tree ${tree}, but the manifest pins ${pin.tree} (${pin.repository} @ ${pin.commit}); the vendored source no longer matches upstream`,
      });
    }
    try {
      await git(['rev-parse', '--verify', `HEAD:./${pin.directory}/${pin.licenseFile}`]);
    } catch {
      findings.push({ rule: 'license-file', engine: pin.name, message: `${pin.directory}/${pin.licenseFile} is missing` });
    }
    const dirty = await git(['status', '--porcelain', '--untracked-files=all', '--', pin.directory]);
    if (dirty !== '') {
      const lines = dirty.split('\n');
      findings.push({
        rule: 'uncommitted-changes',
        engine: pin.name,
        message: `${lines.length} uncommitted change(s) under ${pin.directory}, first: ${lines[0]?.trim() ?? ''}`,
      });
    }
  }
  return findings;
}

/** Top-level directories under engines/ at HEAD must each have a pin. */
export async function findUnpinnedEngines(manifest: Manifest, git: Git): Promise<Finding[]> {
  const listing = await git(['ls-tree', '-d', '--name-only', 'HEAD', 'engines/']);
  const pinned = new Set(manifest.engines.map((pin) => pin.directory));
  return listing
    .split('\n')
    .filter((directory) => directory !== '' && !pinned.has(directory))
    .map((directory) => ({ rule: 'unpinned-engine', engine: directory, message: `${directory} has no entry in engines/manifest.json` }));
}

export async function verifyUpstream(manifest: Manifest, api: GitHubApi): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const pin of manifest.engines) {
    const [, owner, repo] = REPOSITORY.exec(pin.repository) ?? [];
    try {
      const commit = (await api(`/repos/${owner}/${repo}/git/commits/${pin.commit}`)) as { tree?: { sha?: string } };
      if (commit.tree?.sha !== pin.tree) {
        findings.push({ rule: 'upstream-tree', engine: pin.name, message: `upstream commit ${pin.commit} has tree ${commit.tree?.sha ?? '(none)'}, manifest pins ${pin.tree}` });
      }
      const comparison = (await api(`/repos/${owner}/${repo}/compare/${pin.commit}...${encodeURIComponent(pin.branch)}`)) as { status?: string };
      if (comparison.status !== 'ahead' && comparison.status !== 'identical') {
        findings.push({ rule: 'upstream-branch', engine: pin.name, message: `commit ${pin.commit} is not contained in ${pin.repository} branch ${pin.branch} (compare status: ${comparison.status ?? 'unknown'})` });
      }
    } catch (error) {
      findings.push({ rule: 'upstream-unreachable', engine: pin.name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return findings;
}

function gitIn(cwd: string): Git {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.trimEnd());
      });
    });
}

function gitHubApi(token: string | undefined): GitHubApi {
  return async (apiPath) => {
    const response = await fetch(`https://api.github.com${apiPath}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'devmoter-base-upstream-verify',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub API ${apiPath} returned ${response.status}`);
    return response.json();
  };
}

async function main(argv: string[]): Promise<number> {
  const online = argv.includes('--online');
  const asJson = argv.includes('--json');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const parsed = parseManifest(JSON.parse(await readFile(path.join(root, 'engines/manifest.json'), 'utf8')));
  const findings = [...parsed.findings];
  if (parsed.manifest) {
    const git = gitIn(root);
    findings.push(...(await verifyVendoredTrees(parsed.manifest, git)), ...(await findUnpinnedEngines(parsed.manifest, git)));
    if (online) findings.push(...(await verifyUpstream(parsed.manifest, gitHubApi(process.env.GITHUB_TOKEN))));
  }
  const engines = parsed.manifest?.engines.length ?? 0;
  if (asJson) {
    console.log(JSON.stringify({ ok: findings.length === 0, engines, upstreamChecked: online, findings }, null, 2));
  } else {
    console.log(`Upstream verification: ${engines} pinned engines, upstream ${online ? 'checked against GitHub' : 'not contacted (use --online)'}`);
    for (const finding of findings) console.log(`  FAIL [${finding.rule}] ${finding.engine}: ${finding.message}`);
    if (findings.length === 0) console.log('OK: vendored sources match their pinned upstream commits');
  }
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
