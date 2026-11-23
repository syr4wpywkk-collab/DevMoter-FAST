// RESP3, the wire protocol of Valkey: an encoder for commands and an
// incremental decoder for replies.

/** A reply value, already mapped to what JSON can hold (see `RespDecoder`). */
export type RespValue = null | boolean | number | string | { $base64: string } | RespError | RespValue[] | { [key: string]: RespValue };

/** An error reply. At the top level it fails the command; inside an aggregate it stays a value. */
export class RespError {
  readonly error: string;

  constructor(message: string) {
    this.error = message;
  }
}

export class RespProtocolError extends Error {}

/** Encodes one command as an array of bulk strings. */
export function encodeCommand(args: readonly (string | Buffer)[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const arg of args) {
    const bytes = typeof arg === 'string' ? Buffer.from(arg, 'utf8') : arg;
    parts.push(Buffer.from(`$${bytes.length}\r\n`), bytes, Buffer.from('\r\n'));
  }
  return Buffer.concat(parts);
}

// ignoreBOM: a leading U+FEFF is part of the value, not a marker to drop.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Text when the bytes are valid UTF-8, otherwise `{ "$base64": "..." }`: bulk strings may hold any bytes. */
function text(bytes: Buffer): string | { $base64: string } {
  try {
    return decoder.decode(bytes);
  } catch {
    return { $base64: bytes.toString('base64') };
  }
}

function integer(source: string): number | string {
  if (!/^[+-]?\d+$/.test(source)) throw new RespProtocolError('malformed integer in reply');
  const value = Number(source);
  return Number.isSafeInteger(value) ? value : source.replace(/^\+/, '');
}

function double(source: string): number | string {
  if (source === 'inf' || source === '+inf') return 'Infinity';
  if (source === '-inf') return '-Infinity';
  if (source === 'nan' || source === '-nan') return 'NaN';
  const value = Number(source);
  if (source === '' || Number.isNaN(value)) throw new RespProtocolError('malformed double in reply');
  return value;
}

interface Frame {
  kind: 'array' | 'map' | 'attribute';
  remaining: number;
  items: RespValue[];
}

function build(frame: Frame): RespValue {
  if (frame.kind === 'array') return frame.items;
  const pairs: [RespValue, RespValue][] = [];
  for (let index = 0; index < frame.items.length; index += 2) pairs.push([frame.items[index] as RespValue, frame.items[index + 1] as RespValue]);
  // A map becomes an object when every key is text, otherwise a list of [key, value] pairs.
  if (pairs.every(([key]) => typeof key === 'string')) return Object.fromEntries(pairs as [string, RespValue][]);
  return pairs;
}

const MAX_DEPTH = 64;

/**
 * Decodes replies as bytes arrive.
 *
 * Reply types map to JSON as follows: strings are text (or `{"$base64"}` when
 * not valid UTF-8); integers and doubles are numbers (integers beyond ±2^53
 * and big numbers are text, non-finite doubles are "Infinity", "-Infinity",
 * "NaN"); arrays, sets and pushes are arrays; maps are objects.
 */
export class RespDecoder {
  #pending: Buffer[] = [];
  #pendingBytes = 0;
  /** Bytes needed before the next token can be complete: avoids re-scanning a large bulk string on every chunk. */
  #need = 1;
  #stack: Frame[] = [];

  /** Adds received bytes and returns the replies that are now complete. */
  push(chunk: Buffer): RespValue[] {
    this.#pending.push(chunk);
    this.#pendingBytes += chunk.length;
    if (this.#pendingBytes < this.#need) return [];
    const buffer = this.#pending.length === 1 ? chunk : Buffer.concat(this.#pending);
    const done: RespValue[] = [];
    let offset = 0;

    const deliver = (value: RespValue): void => {
      let current = value;
      for (;;) {
        const frame = this.#stack.at(-1);
        if (!frame) {
          done.push(current);
          return;
        }
        frame.items.push(current);
        frame.remaining -= 1;
        if (frame.remaining > 0) return;
        this.#stack.pop();
        // An attribute is metadata about the reply that follows it; it is dropped.
        if (frame.kind === 'attribute') return;
        current = build(frame);
      }
    };

    for (;;) {
      const lineEnd = buffer.indexOf('\r\n', offset);
      if (lineEnd === -1) {
        this.#need = buffer.length - offset + 1;
        break;
      }
      const type = String.fromCharCode(buffer[offset] as number);
      const line = buffer.toString('latin1', offset + 1, lineEnd);
      const next = lineEnd + 2;

      if (type === '$' || type === '!' || type === '=') {
        if (type === '$' && line === '-1') {
          offset = next;
          deliver(null);
          continue;
        }
        const length = Number(line);
        if (!/^\d+$/.test(line)) throw new RespProtocolError('malformed bulk length in reply');
        if (buffer.length < next + length + 2) {
          this.#need = next + length + 2 - offset;
          break;
        }
        const bytes = buffer.subarray(next, next + length);
        offset = next + length + 2;
        if (type === '!') deliver(new RespError(bytes.toString('utf8')));
        // A verbatim string starts with a three-letter format and a colon ("txt:").
        else deliver(text(type === '=' ? bytes.subarray(4) : bytes));
        continue;
      }

      offset = next;
      if (type === '*' || type === '~' || type === '>' || type === '%' || type === '|') {
        if (type === '*' && line === '-1') {
          deliver(null);
          continue;
        }
        if (!/^\d+$/.test(line)) throw new RespProtocolError('malformed aggregate length in reply');
        const pairs = type === '%' || type === '|';
        const count = Number(line) * (pairs ? 2 : 1);
        const kind = type === '%' ? 'map' : type === '|' ? 'attribute' : 'array';
        if (count === 0) {
          if (kind !== 'attribute') deliver(build({ kind, remaining: 0, items: [] }));
          continue;
        }
        if (this.#stack.length >= MAX_DEPTH) throw new RespProtocolError('reply is nested too deeply');
        this.#stack.push({ kind, remaining: count, items: [] });
        continue;
      }
      switch (type) {
        case '+':
          deliver(text(buffer.subarray(lineEnd - line.length, lineEnd)));
          break;
        case '-':
          deliver(new RespError(buffer.toString('utf8', lineEnd - line.length, lineEnd)));
          break;
        case ':':
          deliver(integer(line));
          break;
        case '(':
          if (!/^[+-]?\d+$/.test(line)) throw new RespProtocolError('malformed big number in reply');
          deliver(line.replace(/^\+/, ''));
          break;
        case ',':
          deliver(double(line));
          break;
        case '#':
          if (line !== 't' && line !== 'f') throw new RespProtocolError('malformed boolean in reply');
          deliver(line === 't');
          break;
        case '_':
          deliver(null);
          break;
        default:
          throw new RespProtocolError('unknown reply type');
      }
    }

    const rest = buffer.subarray(offset);
    this.#pending = rest.length > 0 ? [rest] : [];
    this.#pendingBytes = rest.length;
    if (rest.length === 0) this.#need = 1;
    return done;
  }
}
