// Dependency inspection for the DevMoter Base integration layer (npm side).
//
//   node scripts/deps/check.ts [--offline] [--json]
//
// Checks package.json / package-lock.json policy, then asks the npm registry
// for known vulnerabilities (skipped with --offline).

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Finding {
  rule: string;
  package: string;
  message: string;
}

export interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface LockPackage {
  version?: string;
  resolved?: string;
  integrity?: string;
  license?: string;
  link?: boolean;
  hasInstallScript?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface PackageLock {
  lockfileVersion?: number;
  packages?: Record<string, LockPackage>;
}

export interface Policy {
  allowedLicenses: readonly string[];
  /** Packages allowed to run install scripts, by name. */
  allowedInstallScripts: readonly string[];
  registry: string;
}

export const DEFAULT_POLICY: Policy = {
  allowedLicenses: ['0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'BlueOak-1.0.0', 'CC0-1.0', 'ISC', 'MIT', 'Unlicense'],
  allowedInstallScripts: [],
  registry: 'https://registry.npmjs.org/',
};

const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

function packageName(lockPath: string): string {
  const marker = 'node_modules/';
  const index = lockPath.lastIndexOf(marker);
  return index === -1 ? lockPath : lockPath.slice(index + marker.length);
}

/**
 * Evaluates an SPDX license expression against the allowlist: `OR` passes when
 * either side does, `AND` needs both, parentheses group. Anything that does not
 * parse, and any `WITH` exception, is rejected.
 */
export function licenseAllowed(expression: string | undefined, allowed: readonly string[]): boolean {
  if (!expression) return false;
  const tokens = expression.match(/[()]|[^\s()]+/g) ?? [];
  let position = 0;

  const parseOr = (): boolean | undefined => {
    let result = parseAnd();
    while (result !== undefined && tokens[position]?.toUpperCase() === 'OR') {
      position += 1;
      const right = parseAnd();
      result = right === undefined ? undefined : result || right;
    }
    return result;
  };
  const parseAnd = (): boolean | undefined => {
    let result = parseTerm();
    while (result !== undefined && tokens[position]?.toUpperCase() === 'AND') {
      position += 1;
      const right = parseTerm();
      result = right === undefined ? undefined : result && right;
    }
    return result;
  };
  const parseTerm = (): boolean | undefined => {
    const token = tokens[position];
    if (token === undefined || token === ')' || /^(OR|AND|WITH)$/i.test(token)) return undefined;
    position += 1;
    if (token !== '(') return allowed.includes(token);
    const inner = parseOr();
    if (inner === undefined || tokens[position] !== ')') return undefined;
    position += 1;
    return inner;
  };

  const result = parseOr();
  return result === true && position === tokens.length;
}

/** Semver build metadata (`1.2.3+build.1`) does not identify a version; npm drops it in the lockfile. */
function withoutBuildMetadata(version: string | undefined): string | undefined {
  return version?.split('+')[0];
}

/** Node's lookup: the nearest `node_modules/<name>` at or above the requiring package. */
function resolvesFrom(packages: Record<string, LockPackage>, fromPath: string, name: string): boolean {
  let base = fromPath;
  for (;;) {
    if (packages[`${base}/node_modules/${name}`]) return true;
    const index = base.lastIndexOf('/node_modules/');
    if (index === -1) return packages[`node_modules/${name}`] !== undefined;
    base = base.slice(0, index);
  }
}

export function checkManifest(pkg: PackageJson): Finding[] {
  const findings: Finding[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!EXACT_VERSION.test(spec)) {
        findings.push({
          rule: 'exact-version',
          package: name,
          message: `${field}: "${spec}" is not an exact version; pin it so builds are reproducible`,
        });
      }
    }
  }
  return findings;
}

export function checkLockfile(pkg: PackageJson, lock: PackageLock, policy: Policy = DEFAULT_POLICY): Finding[] {
  const findings: Finding[] = [];
  if (lock.lockfileVersion !== 3) {
    findings.push({ rule: 'lockfile-version', package: '(root)', message: `lockfileVersion is ${String(lock.lockfileVersion)}, expected 3` });
  }
  const packages = lock.packages ?? {};
  const root = packages[''];
  if (!root) {
    findings.push({ rule: 'lockfile-root', package: '(root)', message: 'package-lock.json has no root entry' });
  } else {
    for (const field of DEPENDENCY_FIELDS) {
      const wanted = JSON.stringify(Object.entries(pkg[field] ?? {}).sort());
      const locked = JSON.stringify(Object.entries(root[field] ?? {}).sort());
      if (wanted !== locked) {
        findings.push({ rule: 'lockfile-sync', package: '(root)', message: `${field} in package-lock.json differ from package.json; run npm install` });
      }
    }
  }
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      const entry = packages[`node_modules/${name}`];
      if (!entry) {
        findings.push({ rule: 'lockfile-sync', package: name, message: `declared in ${field} but has no entry in package-lock.json; run npm install` });
      } else if (!entry.link && withoutBuildMetadata(entry.version) !== withoutBuildMetadata(spec)) {
        findings.push({ rule: 'lockfile-sync', package: name, message: `package-lock.json has ${entry.version ?? '(no version)'}, package.json wants ${spec}; run npm install` });
      }
    }
  }
  for (const [lockPath, entry] of Object.entries(packages)) {
    if (lockPath === '') continue;
    for (const dependency of Object.keys(entry.dependencies ?? {})) {
      if (!resolvesFrom(packages, lockPath, dependency)) {
        findings.push({ rule: 'lockfile-sync', package: packageName(lockPath), message: `requires ${dependency}, which has no entry in package-lock.json; run npm install` });
      }
    }
    if (entry.link) continue;
    const name = packageName(lockPath);
    const label = `${name}@${entry.version ?? '?'}`;
    if (!entry.resolved?.startsWith(policy.registry)) {
      findings.push({ rule: 'registry', package: label, message: `resolved from ${entry.resolved ?? '(nothing)'}, expected ${policy.registry}` });
    }
    if (!entry.integrity?.startsWith('sha512-')) {
      findings.push({ rule: 'integrity', package: label, message: 'missing sha512 integrity hash' });
    }
    if (!licenseAllowed(entry.license, policy.allowedLicenses)) {
      findings.push({ rule: 'license', package: label, message: `license "${entry.license ?? '(none)'}" is not on the allowlist` });
    }
    if (entry.hasInstallScript && !policy.allowedInstallScripts.includes(name)) {
      findings.push({ rule: 'install-script', package: label, message: 'runs an install script and is not on the allowlist' });
    }
  }
  return findings;
}

interface AuditReport {
  vulnerabilities?: Record<string, { severity?: string; via?: unknown[]; range?: string }>;
  error?: { summary?: string; code?: string };
}

export function auditFindings(report: AuditReport, minimum: 'high' | 'critical' = 'high'): Finding[] {
  if (report.error) {
    return [{ rule: 'audit-error', package: '(registry)', message: `npm audit failed: ${report.error.summary ?? report.error.code ?? 'unknown error'}` }];
  }
  const blocking = minimum === 'critical' ? ['critical'] : ['high', 'critical'];
  return Object.entries(report.vulnerabilities ?? {})
    .filter(([, item]) => blocking.includes(item.severity ?? ''))
    .map(([name, item]) => {
      const titles = (item.via ?? [])
        .map((via) => (typeof via === 'string' ? via : (via as { title?: string }).title))
        .filter(Boolean);
      return { rule: 'vulnerability', package: name, message: `${item.severity} severity (${item.range ?? 'unknown range'}): ${titles.join('; ') || 'see npm audit'}` };
    });
}

function runNpmAudit(cwd: string): Promise<AuditReport> {
  return new Promise((resolve) => {
    // npm exits non-zero when vulnerabilities exist; the JSON report is still on stdout.
    execFile('npm', ['audit', '--json'], { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      try {
        resolve(JSON.parse(stdout) as AuditReport);
      } catch {
        resolve({ error: { summary: error?.message ?? 'npm audit produced no JSON output' } });
      }
    });
  });
}

async function main(argv: string[]): Promise<number> {
  const offline = argv.includes('--offline');
  const asJson = argv.includes('--json');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as PackageJson;
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8')) as PackageLock;

  const findings = [...checkManifest(pkg), ...checkLockfile(pkg, lock)];
  if (!offline) findings.push(...auditFindings(await runNpmAudit(root)));

  const packageCount = Object.keys(lock.packages ?? {}).filter((key) => key !== '').length;
  if (asJson) {
    console.log(JSON.stringify({ ok: findings.length === 0, packages: packageCount, vulnerabilityScan: !offline, findings }, null, 2));
  } else {
    console.log(`Dependency check: ${packageCount} locked packages, vulnerability scan ${offline ? 'skipped (--offline)' : 'done'}`);
    for (const finding of findings) console.log(`  FAIL [${finding.rule}] ${finding.package}: ${finding.message}`);
    console.log(findings.length === 0 ? 'OK: no findings' : `${findings.length} finding(s)`);
  }
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
