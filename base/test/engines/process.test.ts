import assert from 'node:assert/strict';
import os from 'node:os';
import { test } from 'node:test';

import { runEngineProcess, type RunOptions } from '../../src/engines/process.ts';
import { EngineError } from '../../src/engines/types.ts';

const node = (script: string, overrides: Partial<RunOptions> = {}): RunOptions => ({
  command: process.execPath,
  args: ['-e', script],
  cwd: os.tmpdir(),
  env: {},
  timeoutMs: 10_000,
  maxOutputBytes: 1024,
  label: 'test',
  ...overrides,
});

const rejectsWith = (code: string) => (error: unknown) => error instanceof EngineError && error.code === code;

test('returns the exit code and both output streams', async () => {
  const result = await runEngineProcess(node('process.stdout.write("out"); process.stderr.write("err"); process.exit(3)'));
  assert.deepEqual(result, { code: 3, stdout: 'out', stderr: 'err' });
});

test('passes only the given environment to the engine', async () => {
  process.env.DMB_TEST_SECRET = 'do-not-leak';
  try {
    const result = await runEngineProcess(node('process.stdout.write(JSON.stringify([process.env.DMB_TEST_SECRET ?? null, process.env.ONLY]))', { env: { ONLY: 'this' } }));
    assert.equal(result.stdout, '[null,"this"]');
  } finally {
    delete process.env.DMB_TEST_SECRET;
  }
});

test('kills the engine when the time limit passes', async () => {
  const started = Date.now();
  await assert.rejects(runEngineProcess(node('setInterval(() => {}, 1000)', { timeoutMs: 200 })), rejectsWith('timeout'));
  assert.ok(Date.now() - started < 5_000);
});

test('kills the engine when the output limit is exceeded', async () => {
  await assert.rejects(runEngineProcess(node('setInterval(() => process.stdout.write("x".repeat(512)), 1)')), rejectsWith('result_too_large'));
});

test('kills the engine when the caller cancels', async () => {
  const abort = new AbortController();
  const pending = runEngineProcess(node('setInterval(() => {}, 1000)', { signal: abort.signal }));
  setTimeout(() => abort.abort(), 100);
  await assert.rejects(pending, rejectsWith('cancelled'));
  await assert.rejects(runEngineProcess(node('', { signal: abort.signal })), rejectsWith('cancelled'));
});

test('reports a missing engine binary as unavailable, with the command that builds it', async () => {
  await assert.rejects(
    runEngineProcess(node('', { command: '/nonexistent/sqlite3', label: 'sqlite' })),
    (error: unknown) => error instanceof EngineError && error.code === 'engine_unavailable' && error.message.includes('npm run build:engines -- sqlite'),
  );
});

test('reports an engine killed by a signal as a failed query', async () => {
  await assert.rejects(runEngineProcess(node('process.kill(process.pid, "SIGKILL")')), rejectsWith('query_failed'));
});
