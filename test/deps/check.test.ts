import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  auditFindings,
  checkLockfile,
  checkManifest,
  licenseAllowed,
  type PackageJson,
  type PackageLock,
} from '../../scripts/deps/check.ts';

const integrity = `sha512-${'A'.repeat(86)}==`;
const goodPkg: PackageJson = { dependencies: { pg: '8.23.1' }, devDependencies: { typescript: '5.9.3' } };
const goodLock = (): PackageLock => ({
  lockfileVersion: 3,
  packages: {
    '': { dependencies: { pg: '8.23.1' }, devDependencies: { typescript: '5.9.3' } },
    'node_modules/pg': { version: '8.23.1', resolved: 'https://registry.npmjs.org/pg/-/pg-8.23.1.tgz', integrity, license: 'MIT' },
    'node_modules/typescript': { version: '5.9.3', resolved: 'https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz', integrity, license: 'Apache-2.0' },
  },
});
const rules = (findings: { rule: string }[]) => findings.map((finding) => finding.rule);

test('a pinned manifest and a clean lockfile produce no findings', () => {
  assert.deepEqual(checkManifest(goodPkg), []);
  assert.deepEqual(checkLockfile(goodPkg, goodLock()), []);
});

test('version ranges, tags and URLs in package.json are rejected', () => {
  const findings = checkManifest({
    dependencies: { a: '^1.0.0', b: '~1.2.3', c: 'latest', d: 'github:someone/d', e: '1.2.3' },
    devDependencies: { f: '>=2' },
  });
  assert.deepEqual(findings.map((finding) => finding.package), ['a', 'b', 'c', 'd', 'f']);
  assert.ok(rules(findings).every((rule) => rule === 'exact-version'));
});

test('lockfile out of sync with package.json is reported', () => {
  const findings = checkLockfile({ dependencies: { pg: '8.23.0' } }, goodLock());
  assert.ok(rules(findings).includes('lockfile-sync'));
});

test('a declared dependency missing from the lockfile packages is reported', () => {
  const lock = goodLock();
  delete lock.packages!['node_modules/pg'];
  const findings = checkLockfile(goodPkg, lock);
  assert.deepEqual(findings.map((finding) => [finding.rule, finding.package]), [['lockfile-sync', 'pg']]);
});

test('a locked version that differs from the pinned one is reported', () => {
  const lock = goodLock();
  lock.packages!['node_modules/pg']!.version = '8.23.2';
  assert.deepEqual(rules(checkLockfile(goodPkg, lock)), ['lockfile-sync']);
});

test('transitive dependencies must resolve inside the lockfile', () => {
  const lock = goodLock();
  lock.packages!['node_modules/pg']!.dependencies = { 'pg-pool': '^3.0.0' };
  assert.deepEqual(checkLockfile(goodPkg, lock).map((finding) => [finding.rule, finding.package]), [['lockfile-sync', 'pg']]);

  const pool = { version: '3.13.0', resolved: 'https://registry.npmjs.org/pg-pool/-/pg-pool-3.13.0.tgz', integrity, license: 'MIT' };
  lock.packages!['node_modules/pg-pool'] = pool;
  assert.deepEqual(checkLockfile(goodPkg, lock), []);

  delete lock.packages!['node_modules/pg-pool'];
  lock.packages!['node_modules/pg/node_modules/pg-pool'] = pool;
  assert.deepEqual(checkLockfile(goodPkg, lock), []);

  lock.packages!['node_modules/typescript']!.dependencies = { 'pg-pool': '^3.0.0' };
  assert.deepEqual(checkLockfile(goodPkg, lock).map((finding) => finding.package), ['typescript']);
});

test('packages from another registry or without integrity are reported', () => {
  const lock = goodLock();
  lock.packages!['node_modules/pg'] = { version: '8.23.1', resolved: 'https://evil.example/pg.tgz', license: 'MIT' };
  assert.deepEqual(rules(checkLockfile(goodPkg, lock)).sort(), ['integrity', 'registry']);
});

test('licenses outside the allowlist are reported', () => {
  const lock = goodLock();
  lock.packages!['node_modules/pg']!.license = 'GPL-3.0-only';
  delete lock.packages!['node_modules/typescript']!.license;
  assert.deepEqual(rules(checkLockfile(goodPkg, lock)), ['license', 'license']);
});

test('install scripts need an explicit allowlist entry', () => {
  const lock = goodLock();
  lock.packages!['node_modules/pg']!.hasInstallScript = true;
  assert.deepEqual(rules(checkLockfile(goodPkg, lock)), ['install-script']);
  const policy = { allowedLicenses: ['MIT', 'Apache-2.0'], allowedInstallScripts: ['pg'], registry: 'https://registry.npmjs.org/' };
  assert.deepEqual(checkLockfile(goodPkg, lock, policy), []);
});

test('old lockfile formats are reported', () => {
  const lock = goodLock();
  lock.lockfileVersion = 1;
  assert.ok(rules(checkLockfile(goodPkg, lock)).includes('lockfile-version'));
});

test('licenseAllowed understands OR and AND expressions', () => {
  const allowed = ['MIT', 'Apache-2.0'];
  assert.equal(licenseAllowed('MIT', allowed), true);
  assert.equal(licenseAllowed('(MIT OR GPL-3.0-only)', allowed), true);
  assert.equal(licenseAllowed('(MIT AND GPL-3.0-only)', allowed), false);
  assert.equal(licenseAllowed('MIT AND Apache-2.0', allowed), true);
  assert.equal(licenseAllowed('GPL-3.0-only', allowed), false);
  assert.equal(licenseAllowed(undefined, allowed), false);
  assert.equal(licenseAllowed('', allowed), false);
});

test('licenseAllowed honours parentheses instead of flattening them', () => {
  const allowed = ['MIT', 'Apache-2.0'];
  assert.equal(licenseAllowed('(MIT OR Apache-2.0) AND GPL-3.0-only', allowed), false);
  assert.equal(licenseAllowed('GPL-3.0-only AND (MIT OR Apache-2.0)', allowed), false);
  assert.equal(licenseAllowed('MIT AND (GPL-3.0-only OR Apache-2.0)', allowed), true);
  assert.equal(licenseAllowed('MIT OR (GPL-3.0-only AND Apache-2.0)', allowed), true);
  assert.equal(licenseAllowed('((MIT))', allowed), true);
  assert.equal(licenseAllowed('mit or GPL-3.0-only', ['mit']), true);
});

test('licenseAllowed rejects WITH exceptions and malformed expressions', () => {
  const allowed = ['MIT', 'Apache-2.0'];
  for (const expression of ['Apache-2.0 WITH LLVM-exception', '(MIT', 'MIT)', 'MIT OR', 'AND MIT', 'MIT Apache-2.0', '()', 'SEE LICENSE IN LICENSE']) {
    assert.equal(licenseAllowed(expression, allowed), false, expression);
  }
});

test('npm audit reports block on high and critical only', () => {
  const report = {
    vulnerabilities: {
      low: { severity: 'low', via: [{ title: 'meh' }] },
      mod: { severity: 'moderate', via: ['other'] },
      bad: { severity: 'high', range: '<1.2.3', via: [{ title: 'Prototype pollution' }] },
      worse: { severity: 'critical', via: ['bad'] },
    },
  };
  const findings = auditFindings(report);
  assert.deepEqual(findings.map((finding) => finding.package), ['bad', 'worse']);
  assert.match(findings[0]!.message, /high severity \(<1\.2\.3\): Prototype pollution/);
  assert.deepEqual(auditFindings(report, 'critical').map((finding) => finding.package), ['worse']);
});

test('a failed npm audit is a finding, not a pass', () => {
  assert.deepEqual(rules(auditFindings({ error: { code: 'ENOTFOUND', summary: 'registry unreachable' } })), ['audit-error']);
});

test("this repository's own manifest and lockfile pass", async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as PackageJson;
  const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8')) as PackageLock;
  assert.deepEqual([...checkManifest(pkg), ...checkLockfile(pkg, lock)], []);
});
