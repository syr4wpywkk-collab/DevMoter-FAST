import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  findUnpinnedEngines,
  parseManifest,
  verifyUpstream,
  verifyVendoredTrees,
  type EnginePin,
  type Git,
  type Manifest,
} from '../../scripts/upstream/verify.ts';

const TREE = 'a'.repeat(40);
const COMMIT = 'b'.repeat(40);
const pin = (overrides: Partial<EnginePin> = {}): EnginePin => ({
  name: 'sqlite',
  directory: 'engines/sqlite',
  repository: 'https://github.com/sqlite/sqlite',
  branch: 'master',
  commit: COMMIT,
  commitDate: '2026-11-23T16:34:55Z',
  tree: TREE,
  upstreamVersion: '3.55.0',
  licenseFile: 'LICENSE.md',
  ...overrides,
});
const manifest = (...engines: EnginePin[]): Manifest => ({ schemaVersion: 1, engines });
const rules = (findings: { rule: string }[]) => findings.map((finding) => finding.rule);

/** A fake repository: object ids by `HEAD:<path>`, plus `git status` and `git ls-tree` output. */
function fakeGit(objects: Record<string, string>, status = '', directories: string[] = []): Git {
  return async (args) => {
    if (args[0] === 'rev-parse') {
      const id = objects[(args.at(-1) ?? '').replace(':./', ':')];
      if (!id) throw new Error('fatal: path does not exist');
      return id;
    }
    if (args[0] === 'status') return status;
    if (args[0] === 'ls-tree') return directories.join('\n');
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}

test('parseManifest accepts a well-formed manifest', () => {
  const { manifest: parsed, findings } = parseManifest(manifest(pin()));
  assert.deepEqual(findings, []);
  assert.equal(parsed?.engines[0]?.commit, COMMIT);
});

test('parseManifest rejects malformed pins', () => {
  const bad: [string, unknown][] = [
    ['not an object', null],
    ['wrong schema', { schemaVersion: 2, engines: [] }],
    ['short commit', manifest(pin({ commit: 'abc1234' }))],
    ['branch name instead of a tree id', manifest(pin({ tree: 'master' }))],
    ['uppercase sha', manifest(pin({ commit: 'B'.repeat(40) }))],
    ['directory outside engines/', manifest(pin({ directory: 'src' }))],
    ['non-GitHub repository', manifest(pin({ repository: 'https://example.com/sqlite/sqlite' }))],
    ['repository with extra path', manifest(pin({ repository: 'https://github.com/sqlite/sqlite/tree/master' }))],
    ['license path escaping the engine', manifest(pin({ licenseFile: '../LICENSE' }))],
    ['bad date', manifest(pin({ commitDate: 'yesterday' }))],
    ['missing field', { schemaVersion: 1, engines: [{ name: 'sqlite' }] }],
    ['duplicate engine', manifest(pin(), pin())],
  ];
  for (const [label, value] of bad) {
    const result = parseManifest(value);
    assert.ok(result.findings.length > 0, label);
    assert.equal(result.manifest, undefined, label);
  }
});

test('a vendored tree equal to the pinned tree passes', async () => {
  const git = fakeGit({ 'HEAD:engines/sqlite': TREE, 'HEAD:engines/sqlite/LICENSE.md': 'c'.repeat(40) });
  assert.deepEqual(await verifyVendoredTrees(manifest(pin()), git), []);
});

test('a modified, missing or dirty vendored tree is reported', async () => {
  const license = { 'HEAD:engines/sqlite/LICENSE.md': 'c'.repeat(40) };
  const changed = await verifyVendoredTrees(manifest(pin()), fakeGit({ 'HEAD:engines/sqlite': 'd'.repeat(40), ...license }));
  assert.deepEqual(rules(changed), ['vendored-tree']);
  assert.match(changed[0]?.message ?? '', /no longer matches upstream/);

  assert.deepEqual(rules(await verifyVendoredTrees(manifest(pin()), fakeGit({}))), ['vendored-tree']);

  const noLicense = await verifyVendoredTrees(manifest(pin()), fakeGit({ 'HEAD:engines/sqlite': TREE }));
  assert.deepEqual(rules(noLicense), ['license-file']);

  const dirty = await verifyVendoredTrees(manifest(pin()), fakeGit({ 'HEAD:engines/sqlite': TREE, ...license }, ' M engines/sqlite/src/main.c\n?? engines/sqlite/x'));
  assert.deepEqual(rules(dirty), ['uncommitted-changes']);
  assert.match(dirty[0]?.message ?? '', /^2 uncommitted/);
});

test('an engine directory without a pin is reported', async () => {
  const git = fakeGit({}, '', ['engines/sqlite', 'engines/mystery']);
  const findings = await findUnpinnedEngines(manifest(pin()), git);
  assert.deepEqual(findings.map((finding) => [finding.rule, finding.engine]), [['unpinned-engine', 'engines/mystery']]);
});

test('verifyUpstream checks the commit tree and branch membership', async () => {
  const calls: string[] = [];
  const api = (tree: string, status: string) => async (apiPath: string) => {
    calls.push(apiPath);
    return apiPath.includes('/git/commits/') ? { tree: { sha: tree } } : { status };
  };
  assert.deepEqual(await verifyUpstream(manifest(pin()), api(TREE, 'ahead')), []);
  assert.deepEqual(calls, [`/repos/sqlite/sqlite/git/commits/${COMMIT}`, `/repos/sqlite/sqlite/compare/${COMMIT}...master`]);
  assert.deepEqual(await verifyUpstream(manifest(pin()), api(TREE, 'identical')), []);
  assert.deepEqual(rules(await verifyUpstream(manifest(pin()), api('e'.repeat(40), 'ahead'))), ['upstream-tree']);
  assert.deepEqual(rules(await verifyUpstream(manifest(pin()), api(TREE, 'diverged'))), ['upstream-branch']);
  assert.deepEqual(rules(await verifyUpstream(manifest(pin()), api(TREE, 'behind'))), ['upstream-branch']);
});

test('verifyUpstream reports an unreachable upstream instead of passing', async () => {
  const findings = await verifyUpstream(manifest(pin()), async () => {
    throw new Error('GitHub API returned 404');
  });
  assert.deepEqual(rules(findings), ['upstream-unreachable']);
});

test("this repository's engines match engines/manifest.json", async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const parsed = parseManifest(JSON.parse(await readFile(new URL('../../engines/manifest.json', import.meta.url), 'utf8')));
  assert.deepEqual(parsed.findings, []);
  assert.ok(parsed.manifest);
  assert.deepEqual(parsed.manifest.engines.map((engine) => engine.name).sort(), ['duckdb', 'postgresql', 'sqlite', 'valkey']);
  const git: Git = async (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trimEnd();
  const findings = [...(await verifyVendoredTrees(parsed.manifest, git)), ...(await findUnpinnedEngines(parsed.manifest, git))];
  assert.deepEqual(findings, []);
});
