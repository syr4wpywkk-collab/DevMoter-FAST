import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defaultEnginesDir, engineBinary } from '../../src/engines/paths.ts';
import type { EngineName } from '../../src/engines/types.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Finds a built engine program. Tests that need one are skipped when the engine
 * has not been built, unless DEVMOTER_BASE_REQUIRE_ENGINES=1 (set where the
 * engines are built, so a missing binary fails there instead of passing silently).
 */
export function builtEngine(engine: EngineName, program: string): { binary: string; skip: string | false } {
  const binary = engineBinary(defaultEnginesDir(repoRoot), engine, program);
  if (existsSync(binary)) return { binary, skip: false };
  if (process.env.DEVMOTER_BASE_REQUIRE_ENGINES === '1') throw new Error(`${binary} is missing; run "npm run build:engines -- ${engine}"`);
  return { binary, skip: `${engine} is not built (npm run build:engines -- ${engine})` };
}
