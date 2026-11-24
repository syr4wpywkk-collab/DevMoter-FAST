import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
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

export interface TestServer {
  /** Directory that holds the server's Unix socket (PostgreSQL) or the socket path (Valkey). */
  socket: string;
  stop(): Promise<void>;
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // The engine's own lib directory: the build bakes in the prefix it was built at, which is not where a container build ends up on the host.
    const env = { PATH: process.env.PATH ?? '', LC_ALL: 'C', TZ: 'UTC', LD_LIBRARY_PATH: path.resolve(path.dirname(command), '../lib') };
    execFile(command, args, { env }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${path.basename(command)} ${args[0] ?? ''} failed: ${stderr || stdout || error.message}`));
      else resolve();
    });
  });
}

/**
 * Starts a throwaway PostgreSQL server from the built engine. It listens on a
 * Unix socket in a private temporary directory only (no TCP port), with user
 * "devmoter" and database "postgres".
 */
export async function startPostgresql(binDir: string): Promise<TestServer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmb-pg-'));
  const data = path.join(dir, 'data');
  try {
    await run(path.join(binDir, 'initdb'), ['-D', data, '-U', 'devmoter', '--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--locale=C', '--no-sync']);
    const serverOptions = `-c listen_addresses='' -c unix_socket_directories='${dir}' -c unix_socket_permissions=0700 -c fsync=off`;
    await run(path.join(binDir, 'pg_ctl'), ['-D', data, '-l', path.join(dir, 'server.log'), '-w', '-t', '120', '-o', serverOptions, 'start']);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    socket: dir,
    async stop() {
      await run(path.join(binDir, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Starts a throwaway Valkey server from the built engine, on a Unix socket in a private temporary directory only (no TCP port). */
export async function startValkey(binary: string, extraArgs: string[] = []): Promise<TestServer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmb-valkey-'));
  const socket = path.join(dir, 'valkey.sock');
  const child = spawn(binary, ['--port', '0', '--unixsocket', socket, '--unixsocketperm', '700', '--dir', dir, '--save', '', '--appendonly', 'no', '--daemonize', 'no', ...extraArgs], {
    stdio: 'ignore',
    env: { LC_ALL: 'C' },
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const stop = async () => {
    child.kill('SIGKILL');
    await exited;
    await rm(dir, { recursive: true, force: true });
  };
  // The socket file appears before the server accepts connections, so wait until one succeeds.
  const accepts = () =>
    new Promise<boolean>((resolve) => {
      const probe = net.createConnection({ path: socket });
      probe.once('connect', () => {
        probe.destroy();
        resolve(true);
      });
      probe.once('error', () => resolve(false));
    });
  let ready = false;
  for (let attempt = 0; attempt < 600 && !ready && child.exitCode === null; attempt += 1) {
    ready = existsSync(socket) && (await accepts());
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!ready) {
    await stop();
    throw new Error('the Valkey test server did not start');
  }
  return { socket, stop };
}
