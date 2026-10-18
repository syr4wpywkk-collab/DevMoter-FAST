/** Install a context-wide WebSocket deny/record guard. No upstream socket is opened. */
export async function installNavigationWebSocketGuard(context) {
  const records = { connections: [], frames: [] };
  // Defense in depth for any socket creation bypassing the page constructor.
  await context.routeWebSocket('**/*', socket => {
    records.connections.push(socket.url());
    socket.onMessage(data => records.frames.push({ url: socket.url(), data: typeof data === 'string' ? data : '[binary frame]' }));
    socket.close();
  });
  // Install after Playwright routing so its mock cannot overwrite this audit stub.
  // Capture app-level constructor attempts (including ones made before route callback).
  await context.addInitScript(() => {
    const nativeWebSocket = globalThis.WebSocket;
    const attempts = { connections: [], frames: [], pending: [] };
    Object.defineProperty(globalThis, '__navigationWebSocketAttempts', { value: attempts, configurable: false });
    const MAX_BYTES = 4096;
    const frameRecord = (url, data) => {
      if (typeof data === 'string') { attempts.frames.push({ url, data }); return; }
      const bytesRecord = bytes => {
        const n = Math.min(bytes.length, MAX_BYTES);
        const hex = Array.from(bytes.subarray(0, n), b => b.toString(16).padStart(2, '0')).join('');
        return { type: 'bytes', encoding: 'hex', payload: hex, byteLength: bytes.length, truncated: bytes.length > n };
      };
      if (data instanceof Blob) {
        // Register the attempt synchronously, before any navigation or async read.
        const entry = { url, data: { type: 'Blob', byteLength: data.size, pending: true } };
        attempts.frames.push(entry);
        attempts.pending.push(data.slice(0, MAX_BYTES).arrayBuffer().then(buffer => {
          entry.data = { ...bytesRecord(new Uint8Array(buffer)), byteLength: data.size, truncated: data.size > MAX_BYTES };
        }, () => { entry.data = { type: 'Blob', error: 'payload-read-failed' }; }));
      } else if (data instanceof ArrayBuffer) attempts.frames.push({ url, data: bytesRecord(new Uint8Array(data)) });
      else if (ArrayBuffer.isView(data)) attempts.frames.push({ url, data: bytesRecord(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)) });
      else attempts.frames.push({ url, data: { type: Object.prototype.toString.call(data), error: 'unsupported-payload' } });
    };
    class BlockedWebSocket extends EventTarget {
      constructor(url, protocols) {
        super();
        attempts.connections.push(String(url));
        this.url = String(url);
        this.protocol = '';
        this.extensions = '';
        // This stub is already CLOSED; unlike a real open socket, send must throw.
        this.readyState = 3;
        this.bufferedAmount = 0;
        this.binaryType = 'blob';
        queueMicrotask(() => this.dispatchEvent(new Event('error')));
      }
      send(data) {
        frameRecord(this.url, data);
        throw new DOMException('WebSocket is already in CLOSING or CLOSED state.', 'InvalidStateError');
      }
      close() {}
      get [Symbol.toStringTag]() { return 'WebSocket'; }
    }
    BlockedWebSocket.CONNECTING = 0; BlockedWebSocket.OPEN = 1;
    BlockedWebSocket.CLOSING = 2; BlockedWebSocket.CLOSED = 3;
    globalThis.WebSocket = BlockedWebSocket;
    // Keep a reference so tests can verify native constructor was not used.
    void nativeWebSocket;
  });
  return {
    records,
    async collect(page) {
      const attempts = await page.evaluate(async () => {
        const audit = globalThis.__navigationWebSocketAttempts;
        if (!audit) throw new Error('WebSocket audit initialization missing');
        await Promise.all(audit.pending.splice(0));
        return { connections: audit.connections.splice(0), frames: audit.frames.splice(0) };
      });
      records.connections.push(...attempts.connections);
      records.frames.push(...attempts.frames);
      return records;
    },
    assertNoConnections() { if (records.connections.length) throw new Error(`Unexpected WebSocket connections: ${records.connections.join(', ')}`); },
    assertNoFrames() { if (records.frames.length) throw new Error(`Unexpected WebSocket frames: ${JSON.stringify(records.frames)}`); },
    assertHistoryClean() { this.assertNoConnections(); this.assertNoFrames(); }
  };
}

/** Run isolated negative checks in a caller-owned browser; uses this installer. */
export async function selfTestNavigationWebSocketGuard(browser) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const guard = await installNavigationWebSocketGuard(context);
    const page = await context.newPage();
    const testUrl = 'http://127.0.0.1/__navigation-websocket-guard-self-test';
    await context.route(testUrl, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>guard self test</title>' }));
    await page.goto(testUrl);
    await page.evaluate(() => {
      const ws = new WebSocket('ws://127.0.0.1/unexpected-ws');
      for (const payload of ['synthetic-frame', new Blob(['synthetic-blob-frame'])]) try { ws.send(payload); } catch (error) {
        if (error.name !== 'InvalidStateError') throw error;
      }
    });
    const records = await guard.collect(page);
    if (!records.connections.some(url => url.endsWith('/unexpected-ws'))) throw new Error('self-test failed to record synthetic WebSocket connection');
    if (!records.frames.some(frame => frame.data === 'synthetic-frame')) throw new Error('self-test failed to record synthetic frame attempt');
    if (!records.frames.some(frame => frame.data?.payload === Buffer.from('synthetic-blob-frame').toString('hex'))) throw new Error('self-test failed to record Blob frame content');
    let connectionRejected = false, frameRejected = false;
    try { guard.assertNoConnections(); } catch { connectionRejected = true; }
    try { guard.assertNoFrames(); } catch { frameRejected = true; }
    if (!connectionRejected || !frameRejected) throw new Error('self-test audit must reject both connection and frame attempts');
    return { connections: records.connections, frames: records.frames };
  } finally { await context.close(); }
}
