import test from 'node:test';
import assert from 'node:assert/strict';
import { installNavigationWebSocketGuard } from '../scripts/lib/navigation-websocket-guard.mjs';

function makeContext() {
  let init, routePattern, routeHandler;
  const context = {
    async addInitScript(script) { init = script; },
    async routeWebSocket(pattern, handler) { routePattern = pattern; routeHandler = handler; },
    async connectToServer() { throw new Error('upstream connection must not be used'); }
  };
  return { context, getInit: () => init, getRoutePattern: () => routePattern, getRouteHandler: () => routeHandler };
}

test('WebSocket guard registers route, records route-level attempts and exposes history assertions', async () => {
  const fake = makeContext();
  const guard = await installNavigationWebSocketGuard(fake.context);
  assert.equal(typeof fake.getInit(), 'function');
  assert.equal(fake.getRoutePattern(), '**/*');
  const socket = {
    url: () => 'ws://127.0.0.1/unexpected-ws',
    onMessage(fn) { this.message = fn; },
    close() { this.closed = true; }
  };
  fake.getRouteHandler()(socket);
  socket.message('synthetic-frame');
  assert.deepEqual(guard.records.connections, ['ws://127.0.0.1/unexpected-ws']);
  assert.deepEqual(guard.records.frames, [{ url: 'ws://127.0.0.1/unexpected-ws', data: 'synthetic-frame' }]);
  assert.throws(() => guard.assertHistoryClean(), /Unexpected WebSocket connections/);
  guard.records.connections.length = 0;
  assert.throws(() => guard.assertHistoryClean(), /Unexpected WebSocket frames/);
  assert.equal(socket.closed, true);
});

test('init stub records sends then throws InvalidStateError and audits binary payload contents', async () => {
  const fake = makeContext();
  await installNavigationWebSocketGuard(fake.context);
  const vm = await import('node:vm');
  const sandbox = {
    EventTarget, Event, DOMException, queueMicrotask, Symbol,
    WebSocket: class NativeWebSocket {},
    ArrayBuffer, Uint8Array, Int16Array, Blob
  };
  vm.runInNewContext(`(${fake.getInit().toString()})()`, sandbox);
  const result = await vm.runInNewContext(`(async () => {
    const ws = new WebSocket('ws://127.0.0.1/unexpected-ws');
    let errorName;
    try { ws.send('synthetic-frame'); } catch (e) { errorName = e.name; }
    try { ws.send(new Uint8Array([0, 15, 255])); } catch (e) { if (e.name !== 'InvalidStateError') throw e; }
    try { ws.send(new Int16Array([258])); } catch (e) { if (e.name !== 'InvalidStateError') throw e; }
    try { ws.send(new Uint8Array([1, 2]).buffer); } catch (e) { if (e.name !== 'InvalidStateError') throw e; }
    try { ws.send(new Blob(['synthetic-blob'])); } catch (e) { if (e.name !== 'InvalidStateError') throw e; }
    await Promise.all(__navigationWebSocketAttempts.pending);
    return { attempts: { connections: [...__navigationWebSocketAttempts.connections], frames: [...__navigationWebSocketAttempts.frames] }, errorName };
  })()`, sandbox);
  assert.deepEqual(Array.from(result.attempts.connections), ['ws://127.0.0.1/unexpected-ws']);
  assert.equal(result.errorName, 'InvalidStateError');
  assert.equal(result.attempts.frames.some(frame => frame.data?.payload === Buffer.from('synthetic-blob').toString('hex')), true);
  assert.equal(result.attempts.frames.some(frame => frame.data === 'synthetic-frame'), true);
  assert.equal(result.attempts.frames.some(frame => frame.data?.payload === '000fff' && frame.data.byteLength === 3), true);
  assert.equal(result.attempts.frames.some(frame => frame.data?.payload === '0201'), true);
  assert.equal(result.attempts.frames.some(frame => frame.data?.payload === '0102'), true);
  assert.equal(result.attempts.frames.every(frame => frame.url === 'ws://127.0.0.1/unexpected-ws'), true);
});

test('collection consumes snapshots once and clean assertion passes for an empty separate context', async () => {
  const fake = makeContext();
  const guard = await installNavigationWebSocketGuard(fake.context);
  let current = { connections: ['ws://synthetic/once'], frames: [{ url: 'ws://synthetic/once', data: 'only-once' }] };
  const page = { async evaluate(fn) {
    const result = structuredClone(current);
    current = { connections: [], frames: [] };
    return result;
  } };
  await guard.collect(page);
  await guard.collect(page);
  assert.deepEqual(guard.records.connections, ['ws://synthetic/once']);
  assert.equal(guard.records.frames.length, 1);

  const cleanFake = makeContext();
  const cleanGuard = await installNavigationWebSocketGuard(cleanFake.context);
  const emptyPage = { async evaluate(fn) {
    return { connections: [], frames: [] };
  } };
  await cleanGuard.collect(emptyPage);
  assert.doesNotThrow(() => cleanGuard.assertHistoryClean());
});

test('missing WebSocket init audit fails closed rather than reporting no attempts', async () => {
  const fake = makeContext();
  const guard = await installNavigationWebSocketGuard(fake.context);
  await assert.rejects(guard.collect({ evaluate: fn => fn() }), /audit initialization missing/);
});
