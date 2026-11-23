import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { enginePaths, parseArgs, resetMovedBuildTree, scriptEnv } from '../../scripts/build/build.ts';
import { parseManifest, type EnginePin } from '../../scripts/upstream/verify.ts';

const KNOWN = ['postgresql', 'sqlite', 'duckdb', 'valkey'];
const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = parseManifest(JSON.parse(readFileSync(new URL('../../engines/manifest.json', import.meta.url), 'utf8'))).manifest;

test('parseArgs defaults to every engine, with smoke tests', () => {
  assert.deepEqual(parseArgs([], KNOWN, 8), { engines: KNOWN, jobs: 8, smoke: true, build: true, clean: false });
  assert.deepEqual(parseArgs(['all'], KNOWN, 8), { engines: KNOWN, jobs: 8, smoke: true, build: true, clean: false });
});

test('parseArgs selects engines and options', () => {
  assert.deepEqual(parseArgs(['sqlite', '--jobs', '2', 'valkey', 'sqlite', '--skip-smoke', '--clean'], KNOWN, 8), {
    engines: ['sqlite', 'valkey'],
    jobs: 2,
    smoke: false,
    build: true,
    clean: true,
  });
  assert.deepEqual(parseArgs(['--smoke-only', 'duckdb'], KNOWN, 4), { engines: ['duckdb'], jobs: 4, smoke: true, build: false, clean: false });
});

test('parseArgs rejects unknown engines, options and contradictions', () => {
  for (const argv of [['mysql'], ['../sqlite'], ['--fast'], ['--jobs'], ['--jobs', '0'], ['--jobs', 'many'], ['--jobs', '1.5'], ['--skip-smoke', '--smoke-only'], ['--clean', '--smoke-only']]) {
    assert.ok('error' in parseArgs(argv, KNOWN, 8), argv.join(' '));
  }
});

test('each engine builds under its own architecture directory, outside engines/', () => {
  const paths = enginePaths('/repo/build', 'aarch64', 'sqlite');
  assert.deepEqual(paths, {
    root: '/repo/build/aarch64/sqlite',
    src: '/repo/build/aarch64/sqlite/src',
    work: '/repo/build/aarch64/sqlite/work',
    prefix: '/repo/build/aarch64/sqlite/install',
    log: '/repo/build/aarch64/sqlite/build.log',
    info: '/repo/build/aarch64/sqlite/BUILD_INFO.json',
  });
});

test('engine scripts get a fixed environment and none of the caller secrets', () => {
  const pin: EnginePin = {
    name: 'sqlite',
    directory: 'engines/sqlite',
    repository: 'https://github.com/sqlite/sqlite',
    branch: 'master',
    commit: 'b'.repeat(40),
    commitDate: '2026-11-23T16:34:55Z',
    tree: 'a'.repeat(40),
    upstreamVersion: '3.55.0',
    licenseFile: 'LICENSE.md',
  };
  const paths = enginePaths('/b', 'x86_64', 'sqlite');
  const env = scriptEnv({ PATH: '/usr/bin', HOME: '/home/u', CC: 'clang', GITHUB_TOKEN: 'ghp_secret', DATABASE_URL: 'postgres://u:p@h/db' }, pin, paths, 3, '/tmp/x');
  assert.deepEqual(env, {
    PATH: '/usr/bin',
    HOME: '/home/u',
    CC: 'clang',
    LC_ALL: 'C',
    TZ: 'UTC',
    SOURCE_DATE_EPOCH: '1795451695',
    GIT_CEILING_DIRECTORIES: '/b/x86_64/sqlite',
    DMB_ENGINE: 'sqlite',
    DMB_COMMIT: 'b'.repeat(40),
    DMB_SRC: '/b/x86_64/sqlite/src',
    DMB_WORK: '/b/x86_64/sqlite/work',
    DMB_PREFIX: '/b/x86_64/sqlite/install',
    DMB_JOBS: '3',
    DMB_TMP: '/tmp/x',
  });
});

test('a build tree made at another path (host vs container) is rebuilt from scratch, a tree made here is kept', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dmb-build-test-'));
  try {
    const paths = enginePaths(dir, 'x86_64', 'duckdb');
    const seed = () => {
      mkdirSync(paths.work, { recursive: true });
      mkdirSync(paths.src, { recursive: true });
      writeFileSync(path.join(paths.work, 'CMakeCache.txt'), 'CMAKE_HOME_DIRECTORY:INTERNAL=/out/x86_64/duckdb/src');
      mkdirSync(path.join(paths.prefix, 'lib'), { recursive: true });
      writeFileSync(path.join(paths.prefix, 'lib', 'libduckdb.dylib'), 'built on another system');
      writeFileSync(path.join(paths.root, 'SOURCE_TREE'), 'tree');
    };
    const remains = () => [paths.work, paths.src, paths.prefix, path.join(paths.root, 'SOURCE_TREE')].map((file) => existsSync(file));

    seed(); // made before the path was recorded: its origin is unknown
    assert.equal(await resetMovedBuildTree(paths), true);
    assert.deepEqual(remains(), [false, false, false, false]);

    seed();
    assert.equal(await resetMovedBuildTree(paths), false);
    assert.deepEqual(remains(), [true, true, true, true]);

    writeFileSync(path.join(paths.root, 'BUILD_PATH'), '/out/x86_64/duckdb');
    assert.equal(await resetMovedBuildTree(paths), true);
    assert.deepEqual(remains(), [false, false, false, false]);
    assert.equal(readFileSync(path.join(paths.root, 'BUILD_PATH'), 'utf8'), paths.root);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every pinned engine has an executable build script with build and smoke commands', () => {
  assert.ok(manifest);
  for (const pin of manifest.engines) {
    const script = `${root}scripts/build/engines/${pin.name}.sh`;
    accessSync(script, constants.X_OK);
    execFileSync('bash', ['-n', script]);
    const source = readFileSync(script, 'utf8');
    assert.match(source, /^set -euo pipefail$/m, pin.name);
    assert.match(source, /^ {2}build\)$/m, pin.name);
    assert.match(source, /^ {2}smoke\)$/m, pin.name);
    assert.doesNotMatch(source, /engines\//, `${pin.name}: build scripts must work on the exported source, not engines/`);
  }
});

test('smoke tests never open a TCP port', () => {
  assert.match(readFileSync(`${root}scripts/build/engines/valkey.sh`, 'utf8'), /--port 0 --unixsocket/);
  assert.match(readFileSync(`${root}scripts/build/engines/postgresql.sh`, 'utf8'), /listen_addresses=''/);
});

test('the build image is pinned by digest and the container runs without network', () => {
  assert.match(readFileSync(`${root}scripts/build/Dockerfile`, 'utf8'), /^FROM node:22-bookworm-slim@sha256:[0-9a-f]{64}$/m);
  const container = readFileSync(`${root}scripts/build/container.sh`, 'utf8');
  assert.match(container, /--network none/);
  assert.match(container, /:\/repo:ro/);
});
