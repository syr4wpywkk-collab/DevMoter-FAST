// Builds the vendored engines from their pinned source and smoke-tests the result.
//
//   node scripts/build/build.ts [engine ...] [--jobs N] [--skip-smoke] [--smoke-only] [--clean]
//
// With no engine names, all engines in engines/manifest.json are built.
// For each engine the pinned git tree is exported to build/<arch>/<engine>/src,
// so the build never writes into engines/ and always compiles exactly the
// pinned commit. Output:
//
//   build/<arch>/<engine>/src       exported source (Valkey builds in here)
//   build/<arch>/<engine>/work      out-of-tree build directory
//   build/<arch>/<engine>/install   installed binaries, libraries, headers
//   build/<arch>/<engine>/build.log full build output
//   build/<arch>/<engine>/BUILD_INFO.json  what was built, from which commit, with which compiler
//   build/<arch>/<engine>/BUILD_PATH  where the build tree was made (a tree made elsewhere is rebuilt)
//
// DEVMOTER_BASE_BUILD_DIR overrides the build/ location.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseManifest, type EnginePin } from '../upstream/verify.ts';

export interface Options {
  engines: string[];
  jobs: number;
  smoke: boolean;
  build: boolean;
  clean: boolean;
}

export function parseArgs(argv: string[], known: readonly string[], defaultJobs: number): Options | { error: string } {
  const options: Options = { engines: [], jobs: defaultJobs, smoke: true, build: true, clean: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--jobs') {
      const value = Number(argv[(index += 1)]);
      if (!Number.isInteger(value) || value < 1 || value > 256) return { error: '--jobs needs a whole number between 1 and 256' };
      options.jobs = value;
    } else if (arg === '--skip-smoke') options.smoke = false;
    else if (arg === '--smoke-only') options.build = false;
    else if (arg === '--clean') options.clean = true;
    else if (arg === 'all') options.engines.push(...known);
    else if (arg.startsWith('-')) return { error: `unknown option ${arg}` };
    else if (!known.includes(arg)) return { error: `unknown engine "${arg}"; known engines: ${known.join(', ')}` };
    else options.engines.push(arg);
  }
  if (!options.smoke && !options.build) return { error: '--skip-smoke and --smoke-only cannot be combined' };
  if (options.clean && !options.build) return { error: '--clean and --smoke-only cannot be combined' };
  if (options.engines.length === 0) options.engines.push(...known);
  options.engines = [...new Set(options.engines)];
  return options;
}

export interface EnginePaths {
  root: string;
  src: string;
  work: string;
  prefix: string;
  log: string;
  info: string;
}

export function enginePaths(buildRoot: string, arch: string, engine: string): EnginePaths {
  const root = path.join(buildRoot, arch, engine);
  return {
    root,
    src: path.join(root, 'src'),
    work: path.join(root, 'work'),
    prefix: path.join(root, 'install'),
    log: path.join(root, 'build.log'),
    info: path.join(root, 'BUILD_INFO.json'),
  };
}

/** Environment for an engine script: a fixed locale and timestamp, and no way to reach the enclosing git repository. */
export function scriptEnv(base: NodeJS.ProcessEnv, pin: EnginePin, paths: EnginePaths, jobs: number, tmp: string): NodeJS.ProcessEnv {
  return {
    PATH: base.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: base.HOME ?? tmp,
    ...(base.CC ? { CC: base.CC } : {}),
    ...(base.CXX ? { CXX: base.CXX } : {}),
    LC_ALL: 'C',
    TZ: 'UTC',
    SOURCE_DATE_EPOCH: String(Math.floor(Date.parse(pin.commitDate) / 1000)),
    GIT_CEILING_DIRECTORIES: paths.root,
    DMB_ENGINE: pin.name,
    DMB_COMMIT: pin.commit,
    DMB_SRC: paths.src,
    DMB_WORK: paths.work,
    DMB_PREFIX: paths.prefix,
    DMB_JOBS: String(jobs),
    DMB_TMP: tmp,
  };
}

interface RunResult {
  code: number;
  output: string;
}

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; logFile?: string; input?: NodeJS.ReadableStream } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const log = options.logFile ? createWriteStream(options.logFile, { flags: 'a' }) : undefined;
    const tail: string[] = [];
    const collect = (chunk: Buffer) => {
      log?.write(chunk);
      tail.push(chunk.toString('utf8'));
      while (tail.length > 400) tail.shift();
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    if (options.input && child.stdin) options.input.pipe(child.stdin);
    child.on('error', reject);
    child.on('close', (code) => {
      const finish = () => resolve({ code: code ?? 1, output: tail.join('') });
      if (log) log.end(finish);
      else finish();
    });
  });
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

/**
 * Build trees record absolute paths (CMake cache, configure output), and the same build
 * directory has another path on the host than in the container (`/out`). A tree made at
 * another path cannot be reused, so it is removed and the engine builds from scratch.
 */
export async function resetMovedBuildTree(paths: EnginePaths): Promise<boolean> {
  const stamp = path.join(paths.root, 'BUILD_PATH');
  const previous = await readFile(stamp, 'utf8').catch(() => undefined);
  const moved = previous === undefined ? await exists(paths.work) : previous !== paths.root;
  if (moved) {
    // Valkey builds inside the exported source, so that goes too.
    for (const stale of [paths.work, paths.src, path.join(paths.root, 'SOURCE_TREE')]) await rm(stale, { recursive: true, force: true });
  }
  await writeFile(stamp, paths.root);
  return moved;
}

/** Extracts the pinned tree into `paths.src`; skipped when that tree is already there. */
async function exportSource(repo: string, pin: EnginePin, paths: EnginePaths): Promise<void> {
  const stamp = path.join(paths.root, 'SOURCE_TREE');
  if ((await readFile(stamp, 'utf8').catch(() => '')) === pin.tree) return;
  await rm(paths.src, { recursive: true, force: true });
  await mkdir(paths.src, { recursive: true });
  const archive = spawn('git', ['archive', '--format=tar', pin.tree], { cwd: repo, stdio: ['ignore', 'pipe', 'inherit'] });
  const archiveExit = new Promise<number>((resolve) => archive.on('close', (code) => resolve(code ?? 1)));
  const extract = await run('tar', ['-x', '-C', paths.src], { input: archive.stdout });
  if ((await archiveExit) !== 0 || extract.code !== 0) throw new Error(`could not export ${pin.name} tree ${pin.tree}: ${extract.output}`);
  await writeFile(stamp, pin.tree);
}

async function sha256(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function firstLine(command: string, args: string[]): Promise<string | undefined> {
  const result = await run(command, args).catch(() => undefined);
  return result?.code === 0 ? result.output.split('\n')[0]?.trim() : undefined;
}

async function buildEngine(repo: string, buildRoot: string, pin: EnginePin, options: Options): Promise<boolean> {
  const arch = os.arch() === 'x64' ? 'x86_64' : os.arch() === 'arm64' ? 'aarch64' : os.arch();
  const paths = enginePaths(buildRoot, arch, pin.name);
  const script = path.join(repo, 'scripts/build/engines', `${pin.name}.sh`);
  const started = Date.now();
  const say = (message: string) => console.log(`[${pin.name}] ${message}`);

  const vendored = await run('git', ['rev-parse', '--verify', `HEAD:${pin.directory}`], { cwd: repo });
  if (vendored.code !== 0 || vendored.output.trim() !== pin.tree) {
    say(`FAIL ${pin.directory} does not match the pinned tree ${pin.tree}; run npm run upstream:verify`);
    return false;
  }

  if (options.clean) await rm(paths.root, { recursive: true, force: true });
  await mkdir(paths.root, { recursive: true });
  const tmp = await mkdtemp(path.join(os.tmpdir(), `dmb-${pin.name}-`));
  const env = scriptEnv(process.env, pin, paths, options.jobs, tmp);
  try {
    if (options.build) {
      if (await resetMovedBuildTree(paths)) say('the build tree was made at another path (host or container); rebuilding from scratch');
      say(`exporting ${pin.repository} @ ${pin.commit.slice(0, 12)}`);
      await exportSource(repo, pin, paths);
      await mkdir(paths.work, { recursive: true });
      await rm(paths.log, { force: true });
      say(`building for ${arch} with ${options.jobs} job(s); log: ${paths.log}`);
      const built = await run('bash', [script, 'build'], { cwd: paths.root, env, logFile: paths.log });
      if (built.code !== 0) {
        say(`FAIL build exited with ${built.code}; last lines:\n${built.output.split('\n').slice(-40).join('\n')}`);
        return false;
      }
    } else if (!(await exists(paths.prefix))) {
      say(`FAIL nothing is installed at ${paths.prefix}; build first`);
      return false;
    }

    let smoke: string | undefined;
    if (options.smoke) {
      const tested = await run('bash', [script, 'smoke'], { cwd: tmp, env });
      if (tested.code !== 0) {
        say(`FAIL smoke test exited with ${tested.code}:\n${tested.output.split('\n').slice(-40).join('\n')}`);
        return false;
      }
      smoke = tested.output.trim().split('\n').at(-1) ?? '';
      say(`smoke test passed: ${smoke}`);
    }

    if (options.build) {
      const bin = path.join(paths.prefix, 'bin');
      const binaries: Record<string, string> = {};
      for (const name of (await readdir(bin)).sort()) {
        const file = path.join(bin, name);
        if ((await stat(file)).isFile()) binaries[name] = await sha256(file);
      }
      const info = {
        engine: pin.name,
        repository: pin.repository,
        commit: pin.commit,
        tree: pin.tree,
        arch,
        os: `${os.type()} ${os.release()}`,
        cc: await firstLine(env.CC ?? 'cc', ['--version']),
        cxx: await firstLine(env.CXX ?? 'c++', ['--version']),
        jobs: options.jobs,
        builtAt: new Date().toISOString(),
        durationSeconds: Math.round((Date.now() - started) / 1000),
        smokeTest: smoke === undefined ? 'skipped' : `passed: ${smoke}`,
        binaries,
      };
      await writeFile(paths.info, `${JSON.stringify(info, null, 2)}\n`);
      say(`OK in ${info.durationSeconds}s; installed to ${paths.prefix}`);
    }
    return true;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function main(argv: string[]): Promise<number> {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const parsed = parseManifest(JSON.parse(await readFile(path.join(repo, 'engines/manifest.json'), 'utf8')));
  if (!parsed.manifest) {
    console.error('engines/manifest.json is invalid; run npm run upstream:verify');
    return 1;
  }
  const pins = parsed.manifest.engines;
  const options = parseArgs(argv, pins.map((pin) => pin.name), os.availableParallelism());
  if ('error' in options) {
    console.error(`${options.error}\nusage: node scripts/build/build.ts [engine ...] [--jobs N] [--skip-smoke] [--smoke-only] [--clean]`);
    return 2;
  }
  const buildRoot = path.resolve(process.env.DEVMOTER_BASE_BUILD_DIR ?? path.join(repo, 'build'));
  const failed: string[] = [];
  for (const name of options.engines) {
    const pin = pins.find((candidate) => candidate.name === name);
    if (!pin || !(await buildEngine(repo, buildRoot, pin, options))) failed.push(name);
  }
  if (failed.length > 0) console.error(`FAILED: ${failed.join(', ')}`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
