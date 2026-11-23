import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { withFileLock } from '../src/file-lock.ts';

const moduleUrl = pathToFileURL(path.join(import.meta.dirname, '..', 'src', 'file-lock.ts')).href;
const owner = (pid: number, host = os.hostname()) => JSON.stringify({ devmoterBaseLock: 1, pid, host, instance: 'an-earlier-run' });
const longAgo = new Date(Date.now() - 3_600_000);

function inTempDir(run: (file: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dmb-lock-test-'));
  return run(path.join(dir, 'data.json')).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('one task at a time holds the lock, and it is gone afterwards', () =>
  inTempDir(async (file) => {
    let inside = 0;
    let most = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        withFileLock(file, async () => {
          most = Math.max(most, (inside += 1));
          await new Promise((resolve) => setTimeout(resolve, 2));
          inside -= 1;
        }),
      ),
    );
    assert.equal(most, 1);
    assert.throws(() => statSync(`${file}.lock`));
    await assert.rejects(withFileLock(file, () => Promise.reject(new Error('task failed'))), /task failed/);
    assert.throws(() => statSync(`${file}.lock`));
  }));

test('a lock left by a writer that no longer exists is taken over', () =>
  inTempDir(async (file) => {
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    writeFileSync(`${file}.lock`, owner(dead));
    assert.equal(await withFileLock(file, async () => 'ran', 500), 'ran');
    // The same process ID in an earlier run of the program (a restarted container).
    writeFileSync(`${file}.lock`, owner(process.pid));
    assert.equal(await withFileLock(file, async () => 'ran', 500), 'ran');
  }));

test('a lock whose writer may be alive is waited for, then reported, never removed', () =>
  inTempDir(async (file) => {
    const lock = `${file}.lock`;
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    for (const content of [owner(process.ppid), owner(dead, 'another-host'), '', 'not a lock: {"event":"api.request"}\n', '{"pid":1}']) {
      writeFileSync(lock, content);
      // However old the file is.
      utimesSync(lock, longAgo, longAgo);
      const started = Date.now();
      await assert.rejects(withFileLock(file, async () => 'ran', 100), /is locked by another writer/, content);
      assert.ok(Date.now() - started < 3000, 'gives up at the deadline');
      assert.equal(readFileSync(lock, 'utf8'), content);
    }
  }));

test('something else at the lock path is left alone and does not hang the caller', () =>
  inTempDir(async (file) => {
    const lock = `${file}.lock`;
    mkdirSync(lock);
    utimesSync(lock, longAgo, longAgo);
    const started = Date.now();
    await assert.rejects(withFileLock(file, async () => 'ran', 100), /is locked by another writer/);
    assert.ok(Date.now() - started < 3000);
    assert.equal(statSync(lock).isDirectory(), true);
  }));

test('a named pipe at the lock path does not hold the caller', { skip: process.platform === 'win32' }, () =>
  inTempDir(async (file) => {
    const lock = `${file}.lock`;
    assert.equal(spawnSync('mkfifo', [lock]).status, 0);
    const started = Date.now();
    await assert.rejects(withFileLock(file, async () => 'ran', 100), /is locked by another writer/);
    assert.ok(Date.now() - started < 3000);
    assert.equal(statSync(lock).isFIFO(), true);
  }));

test('processes that find the same abandoned lock still run one at a time', { timeout: 120_000 }, () =>
  inTempDir(async (file) => {
    const workers = 8;
    const rounds = 15;
    writeFileSync(file, '0');
    writeFileSync(`${file}.lock`, owner(spawnSync(process.execPath, ['-e', '']).pid));
    const script = `
      import { readFile, writeFile } from 'node:fs/promises';
      const { withFileLock } = await import(${JSON.stringify(moduleUrl)});
      const file = ${JSON.stringify(file)};
      // All of them reach the abandoned lock at the same moment.
      await new Promise((resolve) => setTimeout(resolve, ${Date.now() + 2000} - Date.now()));
      for (let round = 0; round < ${rounds}; round += 1) {
        await withFileLock(file, async () => {
          const count = Number(await readFile(file, 'utf8'));
          await new Promise((resolve) => setTimeout(resolve, 1));
          await writeFile(file, String(count + 1));
        }, 60_000);
      }`;
    const codes = await Promise.all(
      Array.from(
        { length: workers },
        () =>
          new Promise<number | null>((resolve) => {
            const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'inherit'] });
            child.on('close', resolve);
          }),
      ),
    );
    assert.deepEqual(codes, new Array(workers).fill(0));
    assert.equal(readFileSync(file, 'utf8'), String(workers * rounds));
    assert.throws(() => statSync(`${file}.lock`));
  }));
