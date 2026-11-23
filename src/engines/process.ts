// Runs an engine's command-line program once: no shell, a minimal environment,
// a time limit and an output limit.

import { spawn } from 'node:child_process';

import { EngineError } from './types.ts';

export interface RunOptions {
  command: string;
  args: readonly string[];
  /** Written to the engine's standard input. Unlike `args`, other users of the machine cannot see it in the process list. */
  input?: string | undefined;
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal | undefined;
  /** Named in error messages, e.g. "sqlite". */
  label: string;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const MAX_STDERR_BYTES = 64 * 1024;

export function runEngineProcess(options: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new EngineError('cancelled', 'the request was cancelled'));
      return;
    }
    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    // An engine that exits before reading all its input closes the pipe; its exit code and output say why.
    child.stdin.on('error', () => {});
    child.stdin.end(options.input ?? '');
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: EngineError | undefined;

    const stop = (error: EngineError) => {
      failure ??= error;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => stop(new EngineError('timeout', `the query did not finish within ${options.timeoutMs} ms`)), options.timeoutMs);
    const onAbort = () => stop(new EngineError('cancelled', 'the request was cancelled'));
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > options.maxOutputBytes) {
        stop(new EngineError('result_too_large', `the result is larger than ${options.maxOutputBytes} bytes; narrow the query or add a LIMIT`));
      } else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes < MAX_STDERR_BYTES) stderr.push(chunk.subarray(0, MAX_STDERR_BYTES - stderrBytes));
      stderrBytes += chunk.length;
    });

    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };
    child.on('error', (error: NodeJS.ErrnoException) => {
      cleanup();
      const missing = error.code === 'ENOENT' || error.code === 'EACCES';
      reject(
        new EngineError(
          'engine_unavailable',
          missing ? `the ${options.label} engine is not built; run "npm run build:engines -- ${options.label}"` : `could not start the ${options.label} engine`,
          { cause: error },
        ),
      );
    });
    child.on('close', (code, signal) => {
      cleanup();
      if (failure) reject(failure);
      else if (code === null) reject(new EngineError('query_failed', `the ${options.label} engine was terminated by ${signal ?? 'a signal'}`));
      else resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
}
