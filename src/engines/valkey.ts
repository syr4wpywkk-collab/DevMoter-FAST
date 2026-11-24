// Valkey adapter: connects to a running Valkey server and runs one command per request.
//
// Like PostgreSQL, Valkey is a server: the adapter connects to one that is
// already running, over a Unix socket or a loopback TCP port, with a new
// connection for each request.
//
// Which commands may run is decided from what the server itself reports about
// each command (COMMAND INFO), not from a list kept here, so commands added by
// newer versions or by modules are classified too. Until per-user permissions
// exist (features #22, #28), administrative, dangerous, scripting, pub/sub,
// transaction and connection-state commands are refused.

import net from 'node:net';

import { RespDecoder, RespError, RespProtocolError, encodeCommand, type RespValue } from './resp.ts';
import { EngineError, HEALTH_TIMEOUT_MS, resolveTimeout, type CommandArg, type CommandResult, type EngineHealth, type KeyValueAdapter, type QueryOptions } from './types.ts';

export const MAX_ARGS = 4096;
export const MAX_COMMAND_BYTES = 1024 * 1024;
export const MAX_REPLY_BYTES = 32 * 1024 * 1024;

export interface ValkeyAdapterOptions {
  /** Absolute path of the server's Unix socket. Takes precedence over host and port. */
  socketPath?: string;
  host?: string;
  port?: number;
  /** Logical database number (default 0). */
  db?: number;
  username?: string;
  password?: string;
  /** Only commands the server flags as read-only are allowed. */
  readOnly?: boolean;
}

const REFUSED_CATEGORIES: Record<string, string> = {
  '@admin': 'administrative commands are not available through the API',
  '@dangerous': 'commands the server classifies as dangerous are not available through the API',
  '@scripting': 'scripting commands are not available through the API',
  '@pubsub': 'pub/sub commands are not available through the API',
  '@transaction': 'transactions are not available: each request uses its own connection',
  '@connection': 'connection commands are not available: each request uses its own connection',
};
/** Harmless members of @connection. */
const ALWAYS_ALLOWED = new Set(['ping', 'echo']);

export interface CommandInfo {
  flags: string[];
  categories: string[];
  subcommands: Map<string, CommandInfo>;
}

/** Reads one entry of a COMMAND INFO reply. */
export function parseCommandInfo(entry: RespValue): CommandInfo | undefined {
  if (!Array.isArray(entry)) return undefined;
  const strings = (value: RespValue | undefined): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  const subcommands = new Map<string, CommandInfo>();
  for (const sub of Array.isArray(entry[9]) ? entry[9] : []) {
    const info = parseCommandInfo(sub);
    const name = Array.isArray(sub) && typeof sub[0] === 'string' ? sub[0].split('|')[1] : undefined;
    if (info && name !== undefined) subcommands.set(name.toLowerCase(), info);
  }
  return { flags: strings(entry[2]), categories: strings(entry[6]), subcommands };
}

/** Decides whether a command may run. Returns the error when it may not. */
export function refusal(name: string, subcommand: string | undefined, info: CommandInfo | undefined, readOnly: boolean): EngineError | undefined {
  if (!info) return new EngineError('query_failed', `unknown command "${name}"`);
  let effective = info;
  let label = name;
  if (info.subcommands.size > 0) {
    const sub = subcommand === undefined ? undefined : info.subcommands.get(subcommand.toLowerCase());
    if (!sub) return new EngineError('query_failed', `unknown subcommand for "${name}"`);
    effective = sub;
    label = `${name} ${subcommand}`;
  }
  if (ALWAYS_ALLOWED.has(name.toLowerCase())) return undefined;
  const refuse = (reason: string) => new EngineError('command_not_allowed', `"${label}" is not allowed: ${reason}`);
  for (const category of effective.categories) {
    const reason = REFUSED_CATEGORIES[category];
    if (reason !== undefined) return refuse(reason);
  }
  if (effective.flags.includes('admin')) return refuse(REFUSED_CATEGORIES['@admin'] as string);
  if (effective.flags.includes('pubsub')) return refuse(REFUSED_CATEGORIES['@pubsub'] as string);
  if (readOnly && !effective.flags.includes('readonly')) return refuse('this database is read-only');
  return undefined;
}

/**
 * Whether a command names a logical database other than the connection's own: MOVE, and COPY with its DB option.
 * The other commands that do (SELECT, SWAPDB, MIGRATE, FLUSHALL) are refused by their categories.
 */
export function crossesDatabases(encoded: readonly (string | Buffer)[]): boolean {
  const name = String(encoded[0]).toLowerCase();
  if (name === 'move') return true;
  // COPY source destination [DB destination-db] [REPLACE]
  // The server compares each option as a C string, which ends at the first NUL byte: "db\0x" is DB to it.
  const option = (arg: string | Buffer) => Buffer.from(arg).toString('latin1').split('\0', 1)[0]?.toLowerCase();
  return name === 'copy' && encoded.slice(3).some((arg) => option(arg) === 'db');
}

/** Validates a command and converts its arguments to what goes on the wire. */
export function encodeArguments(args: readonly CommandArg[]): (string | Buffer)[] {
  if (!Array.isArray(args) || args.length === 0) throw new EngineError('invalid_request', 'command must be a non-empty array, for example ["GET", "key"]');
  if (args.length > MAX_ARGS) throw new EngineError('invalid_request', `more than ${MAX_ARGS} arguments`);
  let bytes = 0;
  const encoded = args.map((arg, index): string | Buffer => {
    let value: string | Buffer;
    if (typeof arg === 'string') {
      if (!arg.isWellFormed()) throw new EngineError('invalid_request', `argument ${index + 1} is not valid Unicode`);
      value = arg;
    } else if (typeof arg === 'number') {
      if (!Number.isFinite(arg)) throw new EngineError('invalid_request', `argument ${index + 1} is not a finite number`);
      if (Number.isInteger(arg) && !Number.isSafeInteger(arg)) throw new EngineError('invalid_request', `argument ${index + 1} is an integer too large to be exact as a number; send it as a string`);
      value = Object.is(arg, -0) ? '0' : String(arg);
    } else if (typeof arg === 'object' && arg !== null && !Array.isArray(arg) && Object.keys(arg).length === 1 && typeof arg.$base64 === 'string') {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(arg.$base64)) throw new EngineError('invalid_request', `argument ${index + 1} is not valid base64`);
      value = Buffer.from(arg.$base64, 'base64');
    } else {
      throw new EngineError('invalid_request', `argument ${index + 1} must be a string, a number or {"$base64": "..."}`);
    }
    bytes += typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : value.length;
    return value;
  });
  if (bytes > MAX_COMMAND_BYTES) throw new EngineError('invalid_request', `the command is larger than ${MAX_COMMAND_BYTES} bytes`);
  if (typeof encoded[0] !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(encoded[0])) throw new EngineError('invalid_request', 'the first element of command must be a command name');
  return encoded;
}

/** One connection: sends commands and resolves their replies in order. */
class Connection {
  readonly #socket: net.Socket;
  readonly #decoder = new RespDecoder();
  readonly #waiting: { resolve(value: RespValue): void; reject(error: Error): void }[] = [];
  #failure: Error | undefined;
  #received = 0;

  constructor(options: ValkeyAdapterOptions) {
    this.#socket = options.socketPath !== undefined ? net.createConnection({ path: options.socketPath }) : net.createConnection({ host: options.host ?? '127.0.0.1', port: options.port ?? 6379 });
    this.#socket.setNoDelay(true);
    this.#socket.on('data', (chunk: Buffer) => {
      this.#received += chunk.length;
      if (this.#received > MAX_REPLY_BYTES) return this.fail(new EngineError('result_too_large', `the reply is larger than ${MAX_REPLY_BYTES} bytes`));
      try {
        for (const reply of this.#decoder.push(chunk)) {
          // Push messages are not replies to a command; none are expected because pub/sub and tracking are refused.
          this.#waiting.shift()?.resolve(reply);
        }
      } catch (error) {
        this.fail(error instanceof RespProtocolError ? new EngineError('query_failed', 'the server sent a reply that could not be read', { cause: error }) : (error as Error));
      }
    });
    this.#socket.on('error', (error: NodeJS.ErrnoException) => this.fail(new EngineError('engine_unavailable', `cannot reach the Valkey server (${error.code ?? 'connection error'})`, { cause: error })));
    this.#socket.on('close', () => this.fail(new EngineError('engine_unavailable', 'the Valkey server closed the connection')));
  }

  /** Ends the connection; pending and later commands fail with `error`. */
  fail(error: Error): void {
    if (this.#failure) return;
    this.#failure = error;
    this.#socket.destroy();
    for (const waiter of this.#waiting.splice(0)) waiter.reject(error);
  }

  send(args: readonly (string | Buffer)[]): Promise<RespValue> {
    return new Promise((resolve, reject) => {
      if (this.#failure) return reject(this.#failure);
      this.#waiting.push({ resolve, reject });
      this.#socket.write(encodeCommand(args));
    });
  }

  /** Sends a command the adapter itself needs; an error reply means the server cannot be used. */
  async setup(args: readonly string[], what: string): Promise<RespValue> {
    const reply = await this.send(args);
    if (reply instanceof RespError) throw new EngineError('engine_unavailable', `the Valkey server refused ${what}: ${reply.error}`);
    return reply;
  }
}

export function createValkeyAdapter(options: ValkeyAdapterOptions): KeyValueAdapter {
  let closed = false;
  const active = new Set<Connection>();
  const commandInfo = new Map<string, CommandInfo | undefined>();

  /** Connects, switches to RESP3, authenticates and selects the database. Returns the server's description of itself. */
  async function open(connection: Connection): Promise<RespValue> {
    const hello = ['HELLO', '3'];
    if (options.password !== undefined) hello.push('AUTH', options.username ?? 'default', options.password);
    const server = await connection.setup(hello, 'the connection');
    if (options.db !== undefined && options.db !== 0) await connection.setup(['SELECT', String(options.db)], `database ${options.db}`);
    return server;
  }

  async function withConnection<T>(timeoutMs: number, signal: AbortSignal | undefined, work: (connection: Connection) => Promise<T>): Promise<T> {
    if (closed) throw new EngineError('engine_unavailable', 'the database is closed');
    if (signal?.aborted) throw new EngineError('cancelled', 'the command was cancelled');
    const connection = new Connection(options);
    active.add(connection);
    const timer = setTimeout(() => connection.fail(new EngineError('timeout', `the command did not finish within ${timeoutMs} ms`)), timeoutMs);
    const onAbort = () => connection.fail(new EngineError('cancelled', 'the command was cancelled'));
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await work(connection);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      active.delete(connection);
      connection.fail(new EngineError('engine_unavailable', 'the connection is closed'));
    }
  }

  return {
    engine: 'valkey',
    kind: 'keyvalue',

    async command(args: readonly CommandArg[], commandOptions: QueryOptions = {}): Promise<CommandResult> {
      const encoded = encodeArguments(args);
      const timeoutMs = resolveTimeout(commandOptions.timeoutMs);
      const name = (encoded[0] as string).toLowerCase();
      const started = performance.now();
      return withConnection(timeoutMs, commandOptions.signal, async (connection) => {
        await open(connection);
        if (!commandInfo.has(name)) {
          const reply = await connection.setup(['COMMAND', 'INFO', name], 'COMMAND INFO');
          commandInfo.set(name, parseCommandInfo(Array.isArray(reply) ? (reply[0] ?? null) : null));
        }
        const info = commandInfo.get(name);
        // Unknown names are not cached as such for long: a module may be loaded later.
        if (!info) commandInfo.delete(name);
        const subcommand = typeof encoded[1] === 'string' ? encoded[1] : undefined;
        const refused = refusal(encoded[0] as string, subcommand, info, options.readOnly === true);
        if (refused) throw refused;
        if (crossesDatabases(encoded)) throw new EngineError('command_not_allowed', `"${encoded[0] as string}" is not allowed with another logical database: a database entry reaches only the one it is configured for`);
        const reply = await connection.send(encoded);
        if (reply instanceof RespError) throw new EngineError('query_failed', reply.error);
        return { result: reply, durationMs: Math.round(performance.now() - started) };
      });
    },

    async health(): Promise<EngineHealth> {
      const started = performance.now();
      const latency = () => Math.round(performance.now() - started);
      try {
        const server = await withConnection(HEALTH_TIMEOUT_MS, undefined, async (connection) => {
          const description = await open(connection);
          await connection.setup(['PING'], 'PING');
          // Every command is looked up with COMMAND INFO first, so a user who may not run it cannot run anything.
          await connection.setup(['COMMAND', 'INFO', 'ping'], 'COMMAND INFO');
          return description;
        });
        const version = typeof server === 'object' && server !== null && !Array.isArray(server) ? (server as Record<string, RespValue>).version : undefined;
        if (typeof version !== 'string') return { status: 'unavailable', latencyMs: latency(), message: 'the engine did not report its version' };
        return { status: 'ok', version, latencyMs: latency() };
      } catch (error) {
        return { status: 'unavailable', latencyMs: latency(), message: error instanceof EngineError ? error.message : 'the health check failed' };
      }
    },

    async close(): Promise<void> {
      closed = true;
      for (const connection of active) connection.fail(new EngineError('engine_unavailable', 'the database is closed'));
    },
  };
}
