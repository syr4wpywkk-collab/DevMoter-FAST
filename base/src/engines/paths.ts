// Where `npm run build:engines` installs each engine.

import os from 'node:os';
import path from 'node:path';

import type { EngineName } from './types.ts';

/** The architecture name used for build output directories (`uname -m` style). */
export function hostArch(arch: string = os.arch()): string {
  if (arch === 'x64') return 'x86_64';
  if (arch === 'arm64') return 'aarch64';
  return arch;
}

export function defaultEnginesDir(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.DEVMOTER_BASE_ENGINES_DIR) return path.resolve(env.DEVMOTER_BASE_ENGINES_DIR);
  return path.join(path.resolve(env.DEVMOTER_BASE_BUILD_DIR ?? path.join(repoRoot, 'build')), hostArch());
}

export function engineBinary(enginesDir: string, engine: EngineName, program: string): string {
  return path.join(enginesDir, engine, 'install', 'bin', program);
}
