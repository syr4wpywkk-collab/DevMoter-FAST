import "./remote-browser.css";
import { t } from "./i18n";

// Remote browser tab: shows the host Chromium session over the ticketed
// devmoter-browser.v1 WebSocket and sends fixed-schema actions back. CDP never
// reaches the client; every action is checked again by the server.

type Driver = { holder: "user" | "agent" | null; generation: number };
type BrowserSession = {
  id: string;
  active: boolean;
  url: string | null;
  title?: string;
  viewport: { width: number; height: number };
  driver: Driver;
  stopReason?: string | null;
};
type BrowserStatus = {
  capability?: { enabled?: boolean; available?: boolean };
  session: BrowserSession | null;
  otherDeviceSession?: boolean;
};
type BrowserAction =
  | { type: "click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "press"; key: string }
  | { type: "scroll"; dx: number; dy: number; x?: number; y?: number }
  | { type: "back" | "forward" | "reload" };

export type BrowserFrame = { seq: number; width: number; height: number; jpeg: Uint8Array };

const PROTOCOL = "devmoter-browser.v1";
const TAP_SLOP_PX = 8;
const WHEEL_LINE_PX = 16;
const SCROLL_FLUSH_MS = 80;
const MAX_TEXT_CHUNK = 2000;
// Actions sent before their results arrive; below the host's per-session queue
// of 8, so a long paste is never rejected part-way.
const MAX_ACTIONS_IN_FLIGHT = 4;
const MAX_QUEUED_ACTIONS = 256;
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 8000;
const RECONNECT_MAX_ATTEMPTS = 8;
// Socket close codes after which reconnecting cannot succeed.
const FINAL_CLOSE_CODES = new Set([4001, 4003]);
export const PRESS_KEYS = new Set([
  "Enter", "Tab", "Backspace", "Delete", "Escape", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown",
  "Home", "End", "PageUp", "PageDown"
]);

/** Parses a "DMBF" binary frame: magic, uint32 seq, uint16 width, uint16 height, JPEG. */
export function parseFrame(buffer: ArrayBuffer): BrowserFrame | null {
  if (buffer.byteLength <= 12) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0) !== 0x444d4246) return null;
  return {
    seq: view.getUint32(4),
    width: view.getUint16(8),
    height: view.getUint16(10),
    jpeg: new Uint8Array(buffer, 12)
  };
}

/** Maps a point on the displayed canvas to page CSS pixels of the remote viewport. */
export function toViewportPoint(
  clientX: number, clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number }
) {
  if (!rect.width || !rect.height) return null;
  const x = ((clientX - rect.left) / rect.width) * viewport.width;
  const y = ((clientY - rect.top) / rect.height) * viewport.height;
  if (x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

/** Splits text into chunks of at most `size` UTF-16 units without breaking a code point. */
export function splitText(text: string, size = MAX_TEXT_CHUNK) {
  const chunks: string[] = [];
  let chunk = "";
  for (const char of text) {
    if (chunk.length + char.length > size) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function operationId() {
  return "browser-" + (globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2));
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== "GET") {
    headers.set("content-type", "application/json");
    headers.set("x-pocket-operation-id", operationId());
  }
  const response = await fetch(path, { ...init, method, headers, credentials: "same-origin", cache: "no-store" });
  let payload: unknown = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    const body = (payload || {}) as { error?: string; code?: string };
    throw Object.assign(new Error(body.error || "HTTP " + response.status), { code: body.code, status: response.status });
  }
  return payload as T;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error || "");
}

let instance: ReturnType<typeof createRemoteBrowser> | null = null;

export function openRemoteBrowser() {
  instance ||= createRemoteBrowser();
  instance.open();
  return instance;
}

export function closeRemoteBrowser() {
  instance?.close();
}

export function destroyRemoteBrowser() {
  instance?.destroy();
  instance = null;
}

function createRemoteBrowser() {
  const panel = document.createElement("section");
  panel.id = "dmRemoteBrowser";
  panel.className = "rb-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", t("remoteBrowser.title"));
  panel.innerHTML = `
    <header class="rb-bar">
      <div class="rb-nav" role="group" aria-label="${t("remoteBrowser.navigationAria")}">
        <button type="button" data-rb-act="back" aria-label="${t("remoteBrowser.back")}">‹</button>
        <button type="button" data-rb-act="forward" aria-label="${t("remoteBrowser.forward")}">›</button>
        <button type="button" data-rb-act="reload" aria-label="${t("remoteBrowser.reload")}">↻</button>
      </div>
      <output class="rb-url" data-rb-url aria-label="${t("remoteBrowser.urlAria")}"></output>
      <button type="button" class="rb-close" data-rb-close aria-label="${t("common.close")}">×</button>
    </header>
    <div class="rb-driver" data-rb-driver-row hidden>
      <span class="rb-driver-label" data-rb-driver></span>
      <button type="button" class="rb-text-button" data-rb-takeover hidden>${t("remoteBrowser.takeControl")}</button>
      <button type="button" class="rb-text-button" data-rb-release hidden>${t("remoteBrowser.handOver")}</button>
      <span class="rb-spacer"></span>
      <button type="button" class="rb-text-button" data-rb-keyboard aria-pressed="false">${t("remoteBrowser.keyboard")}</button>
      <button type="button" class="rb-text-button" data-rb-stop>${t("remoteBrowser.stop")}</button>
    </div>
    <div class="rb-stage" data-rb-stage>
      <canvas class="rb-canvas" data-rb-canvas hidden aria-label="${t("remoteBrowser.screenAria")}"></canvas>
      <div class="rb-empty" data-rb-empty>
        <p data-rb-empty-text></p>
        <button type="button" class="rb-primary" data-rb-start hidden>${t("remoteBrowser.start")}</button>
        <button type="button" class="rb-text-button" data-rb-retry hidden>${t("remoteBrowser.retry")}</button>
      </div>
    </div>
    <p class="rb-status" role="status" aria-live="polite" data-rb-status></p>
    <textarea class="rb-ime" data-rb-ime rows="1" tabindex="-1" aria-label="${t("remoteBrowser.inputAria")}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go"></textarea>
  `;
  document.body.append(panel);

  const q = <T extends HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
  const urlOutput = q<HTMLOutputElement>("[data-rb-url]");
  const driverRow = q<HTMLElement>("[data-rb-driver-row]");
  const driverLabel = q<HTMLElement>("[data-rb-driver]");
  const takeoverButton = q<HTMLButtonElement>("[data-rb-takeover]");
  const releaseButton = q<HTMLButtonElement>("[data-rb-release]");
  const keyboardButton = q<HTMLButtonElement>("[data-rb-keyboard]");
  const stopButton = q<HTMLButtonElement>("[data-rb-stop]");
  const stage = q<HTMLElement>("[data-rb-stage]");
  const canvas = q<HTMLCanvasElement>("[data-rb-canvas]");
  const empty = q<HTMLElement>("[data-rb-empty]");
  const emptyText = q<HTMLElement>("[data-rb-empty-text]");
  const startButton = q<HTMLButtonElement>("[data-rb-start]");
  const retryButton = q<HTMLButtonElement>("[data-rb-retry]");
  const status = q<HTMLElement>("[data-rb-status]");
  const ime = q<HTMLTextAreaElement>("[data-rb-ime]");
  const navButtons = Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-rb-act]"));

  let isOpen = false;
  let session: BrowserSession | null = null;
  let socket: WebSocket | null = null;
  let socketGeneration = 0;
  let reconnectTimer: number | null = null;
  let reconnectDelay = RECONNECT_MIN_MS;
  let reconnectAttempts = 0;
  let keepStatusOnOpen = false;
  let nextActionId = 1;
  let outbox: BrowserAction[] = [];
  const actionsInFlight = new Set<number>();
  let composing = false;
  let busy = false;
  let drawing: Promise<void> = Promise.resolve();

  const projectId = () => localStorage.getItem("opencode-pocket-project") || "";
  const canDrive = () => Boolean(session?.active && session.driver.holder === "user");
  const setStatus = (text: string) => { status.textContent = text; };

  function render() {
    const active = Boolean(session?.active);
    driverRow.hidden = !active;
    canvas.hidden = !active;
    empty.hidden = active;
    urlOutput.textContent = active ? session?.url || "" : "";
    for (const button of navButtons) button.disabled = !canDrive();
    keyboardButton.disabled = !canDrive();
    if (!active) return;
    const holder = session!.driver.holder;
    driverLabel.dataset.holder = holder || "none";
    driverLabel.textContent = holder === "user" ? t("remoteBrowser.driverYou")
      : holder === "agent" ? t("remoteBrowser.driverAgent")
      : t("remoteBrowser.driverNone");
    takeoverButton.hidden = holder === "user";
    releaseButton.hidden = holder !== "user";
    takeoverButton.textContent = holder === "agent" ? t("remoteBrowser.takeBack") : t("remoteBrowser.takeControl");
    if (!canDrive()) ime.blur();
  }

  function showEmpty(text: string, canStart: boolean, canRetry = false) {
    session = null;
    emptyText.textContent = text;
    startButton.hidden = !canStart;
    retryButton.hidden = !canRetry;
    render();
  }

  async function refresh({ reconnecting = false } = {}) {
    const id = projectId();
    if (!id) {
      showEmpty(t("remoteBrowser.selectProject"), false);
      return;
    }
    try {
      const data = await requestJson<BrowserStatus>("/api/browser?projectId=" + encodeURIComponent(id));
      if (!isOpen) return;
      if (data.session?.active) {
        session = data.session;
        render();
        connect();
      } else if (data.otherDeviceSession) {
        showEmpty(t("remoteBrowser.otherDevice"), false);
      } else if (data.capability && (data.capability.enabled === false || data.capability.available === false)) {
        showEmpty(t("remoteBrowser.unavailable"), false);
      } else {
        showEmpty(t("remoteBrowser.idle"), true);
      }
    } catch (error) {
      if (!isOpen) return;
      // A refresh that fails mid-reconnect (network switch, host restart) keeps
      // retrying with backoff; after the last attempt the user retries by hand.
      if (reconnecting && reconnectAttempts < RECONNECT_MAX_ATTEMPTS) {
        scheduleReconnect(socketGeneration);
        return;
      }
      setStatus("");
      showEmpty(t("remoteBrowser.loadFailed", { error: errorText(error) }), false, true);
    }
  }

  async function start() {
    if (busy) return;
    busy = true;
    startButton.disabled = true;
    setStatus(t("remoteBrowser.starting"));
    try {
      const rect = stage.getBoundingClientRect();
      const width = Math.round(rect.width) || window.innerWidth;
      const height = Math.round(rect.height) || window.innerHeight;
      const data = await requestJson<{ session: BrowserSession }>("/api/browser/sessions", {
        method: "POST",
        body: JSON.stringify({
          projectId: projectId(),
          viewport: { width, height, deviceScaleFactor: Math.min(3, Math.max(1, window.devicePixelRatio || 1)), mobile: width < 768 }
        })
      });
      session = data.session;
      setStatus("");
      render();
      connect();
    } catch (error) {
      setStatus(t("remoteBrowser.startFailed", { error: errorText(error) }));
    } finally {
      busy = false;
      startButton.disabled = false;
    }
  }

  async function stop() {
    if (!session) return;
    const id = session.id;
    disconnect();
    try {
      await requestJson("/api/browser/sessions/" + encodeURIComponent(id), { method: "DELETE" });
    } catch (error) {
      // The browser may still be running on the host, so stay attached to it
      // and say the stop failed instead of showing it as stopped.
      if ((error as { status?: number }).status !== 404) {
        if (session?.id === id) {
          keepStatusOnOpen = true;
          connect();
        }
        setStatus(t("remoteBrowser.stopFailed", { error: errorText(error) }));
        return;
      }
    }
    if (session && session.id !== id) return;
    keepStatusOnOpen = false;
    setStatus("");
    showEmpty(t("remoteBrowser.stopped"), true);
  }

  // Acquiring as the user is an immediate takeover; releasing lets an agent drive.
  async function setDriver(op: "acquire" | "release") {
    if (!session) return;
    const id = session.id;
    try {
      const data = await requestJson<{ driver: Driver }>(
        "/api/browser/sessions/" + encodeURIComponent(id) + "/driver",
        { method: "POST", body: JSON.stringify(op === "acquire" ? { op } : { op, generation: session.driver.generation }) }
      );
      // A takeover pushed over the socket while this request was in flight has
      // a newer generation; the older HTTP answer must not overwrite it.
      if (session?.id !== id || Number(data.driver?.generation) < session.driver.generation) return;
      session.driver = data.driver;
      setStatus("");
      render();
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  function disconnect() {
    socketGeneration += 1;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const current = socket;
    socket = null;
    resetActions();
    if (current && current.readyState < WebSocket.CLOSING) current.close(1000, "client_detached");
  }

  function scheduleReconnect(generation: number) {
    if (!isOpen || generation !== socketGeneration || reconnectTimer !== null) return;
    // A socket that keeps failing to open (the session lookup still succeeds)
    // stops after the same number of attempts; the user retries by hand.
    if (reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      setStatus("");
      showEmpty(t("remoteBrowser.loadFailed", { error: "socket_closed" }), false, true);
      return;
    }
    setStatus(t("remoteBrowser.reconnecting"));
    const delay = reconnectDelay;
    reconnectDelay = Math.min(RECONNECT_MAX_MS, reconnectDelay * 2);
    reconnectAttempts += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      if (generation === socketGeneration) void refresh({ reconnecting: true });
    }, delay);
  }

  function connect() {
    if (!isOpen || !session?.active || socket) return;
    const generation = ++socketGeneration;
    const target = session;
    void (async () => {
      let ticket = "";
      try {
        ({ ticket } = await requestJson<{ ticket: string }>(
          "/api/browser/sessions/" + encodeURIComponent(target.id) + "/ticket",
          { method: "POST", body: "{}" }
        ));
      } catch (error) {
        if (generation !== socketGeneration) return;
        const code = (error as { code?: string; status?: number })?.status;
        if (code === 403 || code === 404) {
          showEmpty(t("remoteBrowser.ended"), true);
          return;
        }
        scheduleReconnect(generation);
        return;
      }
      if (generation !== socketGeneration || !isOpen) return;
      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${scheme}//${location.host}/api/browser/sessions/${encodeURIComponent(target.id)}/socket`,
        [PROTOCOL, "devmoter-ticket." + ticket]
      );
      ws.binaryType = "arraybuffer";
      socket = ws;
      resetActions();
      let ended = false;
      ws.onopen = () => {
        if (ws !== socket) return;
        reconnectDelay = RECONNECT_MIN_MS;
        reconnectAttempts = 0;
        if (keepStatusOnOpen) keepStatusOnOpen = false;
        else setStatus("");
      };
      ws.onmessage = event => {
        if (ws !== socket) return;
        if (typeof event.data === "string") {
          let message: Record<string, unknown>;
          try { message = JSON.parse(event.data); } catch { return; }
          if (message.t === "closed") ended = true;
          handleEvent(message);
        } else if (event.data instanceof ArrayBuffer) {
          const frame = parseFrame(event.data);
          if (frame) drawFrame(ws, frame);
        }
      };
      ws.onerror = () => ws.close();
      ws.onclose = event => {
        if (ws !== socket) return;
        socket = null;
        resetActions();
        if (ended || FINAL_CLOSE_CODES.has(event.code)) {
          if (!ended) showEmpty(t("remoteBrowser.ended"), true);
          return;
        }
        scheduleReconnect(generation);
      };
    })();
  }

  function handleEvent(message: Record<string, unknown>) {
    switch (message.t) {
      case "hello":
        if (message.session && typeof message.session === "object") session = message.session as BrowserSession;
        render();
        break;
      case "meta":
        if (session) session.url = typeof message.url === "string" ? message.url : session.url;
        render();
        break;
      case "driver": {
        const generation = Number(message.generation) || 0;
        if (!session || generation < session.driver.generation) break;
        session.driver = { holder: (message.holder as Driver["holder"]) ?? null, generation };
        if (session.driver.holder === "agent") setStatus(t("remoteBrowser.agentTookOver"));
        render();
        break;
      }
      case "closed":
        showEmpty(t("remoteBrowser.ended"), true);
        break;
      case "result":
        actionsInFlight.delete(Number(message.id));
        // A failed action drops what was queued behind it, e.g. the rest of a paste.
        if (message.ok === false) outbox = [];
        pumpActions();
        if (message.ok === false) {
          const code = String(message.error || "");
          setStatus(code === "driver_stale" ? t("remoteBrowser.driverLost") : t("remoteBrowser.actionFailed", { error: code }));
        }
        break;
      case "action":
        if (message.source === "agent" && Number.isFinite(message.x) && Number.isFinite(message.y)) showRipple(Number(message.x), Number(message.y));
        break;
    }
  }

  function drawFrame(ws: WebSocket, frame: BrowserFrame) {
    drawing = drawing.then(async () => {
      try {
        const bitmap = await createImageBitmap(new Blob([frame.jpeg as BlobPart], { type: "image/jpeg" }));
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
        bitmap.close?.();
      } catch {
        // A frame that cannot be decoded is skipped; the next one replaces it.
      }
      if (ws === socket && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "ack", seq: frame.seq }));
    });
  }

  function showRipple(x: number, y: number) {
    if (!session) return;
    const rect = canvas.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "rb-ripple";
    ripple.style.left = `${rect.left - stageRect.left + (x / session.viewport.width) * rect.width}px`;
    ripple.style.top = `${rect.top - stageRect.top + (y / session.viewport.height) * rect.height}px`;
    stage.append(ripple);
    window.setTimeout(() => ripple.remove(), 600);
  }

  function act(action: BrowserAction) {
    if (!canDrive() || !socket || socket.readyState !== WebSocket.OPEN) return false;
    if (outbox.length >= MAX_QUEUED_ACTIONS) return false;
    outbox.push(action);
    pumpActions();
    return true;
  }

  function pumpActions() {
    while (outbox.length && actionsInFlight.size < MAX_ACTIONS_IN_FLIGHT) {
      if (!canDrive() || !socket || socket.readyState !== WebSocket.OPEN) {
        outbox = [];
        return;
      }
      const id = nextActionId++;
      actionsInFlight.add(id);
      socket.send(JSON.stringify({ t: "act", id, action: outbox.shift(), generation: session!.driver.generation }));
    }
  }

  function resetActions() {
    outbox = [];
    actionsInFlight.clear();
  }

  function sendText(text: string) {
    const chunks = splitText(text).filter(Boolean);
    // All or nothing: a paste larger than the queue is refused rather than typed in part.
    if (outbox.length + chunks.length > MAX_QUEUED_ACTIONS) {
      setStatus(t("remoteBrowser.actionFailed", { error: "text_too_long" }));
      return;
    }
    for (const chunk of chunks) act({ type: "type", text: chunk });
  }

  // Pointer input: a short press without movement is a tap (click); a drag
  // scrolls the page the way a finger would.
  let pointer: { id: number; x: number; y: number; lastX: number; lastY: number; dragging: boolean } | null = null;
  type ScrollOrigin = { x: number; y: number } | null;
  let pendingScroll: { dx: number; dy: number; origin: ScrollOrigin } = { dx: 0, dy: 0, origin: null };
  let scrollTimer: number | null = null;

  // The wheel event goes where the gesture started, so nested scrollers under the finger move.
  function queueScroll(dx: number, dy: number, origin: ScrollOrigin) {
    pendingScroll = { dx: pendingScroll.dx + dx, dy: pendingScroll.dy + dy, origin: pendingScroll.origin || origin };
    if (scrollTimer !== null) return;
    scrollTimer = window.setTimeout(() => {
      scrollTimer = null;
      const { dx, dy, origin: at } = pendingScroll;
      pendingScroll = { dx: 0, dy: 0, origin: null };
      if (Math.round(dx) || Math.round(dy)) act({ type: "scroll", dx: Math.round(dx), dy: Math.round(dy), ...(at || {}) });
    }, SCROLL_FLUSH_MS);
  }

  const viewportPoint = (clientX: number, clientY: number) =>
    session ? toViewportPoint(clientX, clientY, canvas.getBoundingClientRect(), session.viewport) : null;

  const scale = () => {
    const rect = canvas.getBoundingClientRect();
    return session && rect.width ? session.viewport.width / rect.width : 1;
  };

  canvas.addEventListener("pointerdown", event => {
    if (!canDrive() || (pointer && pointer.id !== event.pointerId)) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, dragging: false };
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  canvas.addEventListener("pointermove", event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (!pointer.dragging && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > TAP_SLOP_PX) pointer.dragging = true;
    if (pointer.dragging) {
      const ratio = scale();
      queueScroll((pointer.lastX - event.clientX) * ratio, (pointer.lastY - event.clientY) * ratio, viewportPoint(pointer.x, pointer.y));
    }
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
  });
  canvas.addEventListener("pointerup", event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const tapped = !pointer.dragging;
    pointer = null;
    if (!tapped || !session) return;
    const point = toViewportPoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), session.viewport);
    if (point) act({ type: "click", ...point });
  });
  canvas.addEventListener("pointercancel", () => { pointer = null; });
  canvas.addEventListener("wheel", event => {
    if (!canDrive()) return;
    event.preventDefault();
    const page = event.deltaMode === 2 && session ? session.viewport : null;
    const line = event.deltaMode === 1 ? WHEEL_LINE_PX : 1;
    queueScroll(event.deltaX * (page ? page.width : line), event.deltaY * (page ? page.height : line), viewportPoint(event.clientX, event.clientY));
  }, { passive: false });

  // Text input goes through an off-screen textarea so the soft keyboard and
  // IME work natively. Only committed text is sent: composition updates stay
  // local and compositionend delivers the final string once.
  ime.addEventListener("compositionstart", () => { composing = true; });
  ime.addEventListener("compositionend", event => {
    composing = false;
    const text = event.data || ime.value;
    ime.value = "";
    if (text) sendText(text);
  });
  ime.addEventListener("input", event => {
    if (composing || (event as InputEvent).isComposing) return;
    const text = ime.value;
    ime.value = "";
    if (text) sendText(text.replace(/\r?\n/g, ""));
    if (/\n/.test(text)) act({ type: "press", key: "Enter" });
  });
  ime.addEventListener("beforeinput", event => {
    if (composing || event.isComposing) return;
    if (event.inputType === "deleteContentBackward" && !ime.value) {
      event.preventDefault();
      act({ type: "press", key: "Backspace" });
    } else if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") {
      event.preventDefault();
      act({ type: "press", key: "Enter" });
    }
  });
  ime.addEventListener("keydown", event => {
    if (composing || event.isComposing || event.key === "Process" || event.keyCode === 229) return;
    if (event.key === "Escape" && !ime.value) {
      event.preventDefault();
      act({ type: "press", key: "Escape" });
      ime.blur();
      return;
    }
    if (!PRESS_KEYS.has(event.key) || ime.value) return;
    event.preventDefault();
    act({ type: "press", key: event.key });
  });
  ime.addEventListener("focus", () => keyboardButton.setAttribute("aria-pressed", "true"));
  ime.addEventListener("blur", () => keyboardButton.setAttribute("aria-pressed", "false"));
  ime.addEventListener("paste", event => {
    const text = event.clipboardData?.getData("text/plain") || "";
    if (!text) return;
    event.preventDefault();
    sendText(text);
  });

  keyboardButton.addEventListener("click", () => {
    if (document.activeElement === ime) ime.blur();
    else if (canDrive()) ime.focus({ preventScroll: true });
  });
  for (const button of navButtons) {
    button.addEventListener("click", () => act({ type: button.dataset.rbAct as "back" | "forward" | "reload" }));
  }
  startButton.addEventListener("click", () => void start());
  retryButton.addEventListener("click", () => {
    reconnectDelay = RECONNECT_MIN_MS;
    reconnectAttempts = 0;
    void refresh();
  });
  stopButton.addEventListener("click", () => void stop());
  takeoverButton.addEventListener("click", () => void setDriver("acquire"));
  releaseButton.addEventListener("click", () => void setDriver("release"));
  q<HTMLButtonElement>("[data-rb-close]").addEventListener("click", () => close());

  const onTabChanging = () => close();
  const onKeydown = (event: KeyboardEvent) => {
    if (isOpen && event.key === "Escape" && event.target !== ime) close();
  };
  window.addEventListener("devmoter:workspace-tab-changing", onTabChanging);
  document.addEventListener("keydown", onKeydown);

  function open() {
    if (isOpen) return;
    isOpen = true;
    panel.hidden = false;
    reconnectDelay = RECONNECT_MIN_MS;
    reconnectAttempts = 0;
    setStatus("");
    window.dispatchEvent(new window.CustomEvent("devmoter:workspace-panel-changed", { detail: { tab: "browser", open: true } }));
    void refresh();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    ime.blur();
    disconnect();
    window.dispatchEvent(new window.CustomEvent("devmoter:workspace-panel-changed", { detail: { tab: "browser", open: false } }));
  }

  function destroy() {
    close();
    window.removeEventListener("devmoter:workspace-tab-changing", onTabChanging);
    document.removeEventListener("keydown", onKeydown);
    panel.remove();
  }

  return { open, close, destroy, isOpen: () => isOpen };
}
