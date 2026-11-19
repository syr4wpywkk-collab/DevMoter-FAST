// Basic 認証の総当たり対策（最終版）
//
// 設計:
//  - IP 単位      : ロックあり（閾値 20 / 上限 15 分）
//  - IP×ユーザー : ロックあり（閾値 5  / 上限 15 分）
//  - ユーザー全体 : ロックしない。失敗応答のみ遅延（上限 2 秒）。
//                   リモートの攻撃者がユーザー名だけでオーナーを締め出せないようにする。
//  - 判定と記録は同期的に行い、遅延は応答の送信だけに掛ける。
//  - 資格情報が無いリクエストは失敗として数えない。
//  - 信頼するプロキシは DEVMOTER_TRUST_PROXY で明示されたものだけ（既定はソケットアドレス）。

import { credentialsMatch } from "./auth.mjs";

const MINUTE = 60_000;
const WINDOW_MS = 15 * MINUTE;
const BASE_LOCK_MS = 2_000;
const MAX_TRACKED = 10_000;
const EVICT_SCAN_LIMIT = 64;

const IP_THRESHOLD = 20;
const PAIR_THRESHOLD = 5;
const USER_DELAY_START = 20;
const USER_DELAY_BASE_MS = 250;
const USER_DELAY_MAX_MS = 2_000;

// ---------- IP 正規化 ----------

function expandIpv6(ip) {
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = Math.max(0, 8 - h.length - t.length);
  const groups = [...h, ...Array(fill).fill("0"), ...t];
  return groups.map((g) => g.padStart(4, "0"));
}

export function normalizeIp(address) {
  let ip = String(address ?? "").trim().toLowerCase();
  if (!ip) return "unknown";
  if (ip.startsWith("::ffff:") && ip.includes(".")) return ip.slice(7);
  if (ip.includes(":")) {
    try {
      return `${expandIpv6(ip).slice(0, 4).join(":")}::/64`;
    } catch {
      return ip;
    }
  }
  return ip;
}

export function parseTrustedProxies(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeProxyIp(address) {
  const ip = String(address ?? "").trim().toLowerCase();
  if (ip.startsWith("::ffff:") && ip.includes(".")) return ip.slice(7);
  if (ip.includes(":")) {
    try { return expandIpv6(ip).join(":"); } catch { return ip; }
  }
  return ip || "unknown";
}

export function createClientIpResolver({ trustedProxies = [] } = {}) {
  // Trust is an exact peer identity check; never reuse the /64 rate-limit bucket.
  const trusted = new Set(trustedProxies.map(normalizeProxyIp));
  return function clientIp(req) {
    const socketIp = normalizeIp(req?.socket?.remoteAddress);
    if (!trusted.has(normalizeProxyIp(req?.socket?.remoteAddress))) return socketIp;
    // 信頼プロキシが追記した最後の要素だけを採用する（クライアントが前に付けた値は無視）
    const raw = req.headers?.["x-forwarded-for"];
    const parts = String(Array.isArray(raw) ? raw[0] : raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? normalizeIp(parts[parts.length - 1]) : socketIp;
  };
}

// ---------- 1 スコープ分のカウンタ ----------

export function createTier({
  threshold,
  lock = true,
  maxLockoutMs = 15 * MINUTE,
  windowMs = WINDOW_MS,
  maxTracked = MAX_TRACKED,
  now = () => Date.now(),
}) {
  const entries = new Map(); // key -> { count, firstFailedAt, lockedUntil }
  const isStale = (e, t) => t - e.firstFailedAt > windowMs && t >= e.lockedUntil;

  const live = (key, t) => {
    const e = entries.get(key);
    if (!e) return null;
    if (isStale(e, t)) { entries.delete(key); return null; }
    return e;
  };

  // 上限到達時: 期限切れだけを有限回走査する。生きたロックは追い出さない。
  const reclaim = (t) => {
    if (entries.size < maxTracked) return true;
    let scanned = 0;
    for (const [k, e] of entries) {
      if (isStale(e, t)) { entries.delete(k); if (entries.size < maxTracked) return true; }
      if (++scanned >= EVICT_SCAN_LIMIT) break;
    }
    return entries.size < maxTracked;
  };

  return {
    retryAfterSec(key) {
      if (!lock) return 0;
      const t = now();
      const e = live(key, t);
      return e && t < e.lockedUntil ? Math.ceil((e.lockedUntil - t) / 1000) : 0;
    },

    recordFailure(key) {
      const t = now();
      const prev = live(key, t);
      let entry;
      if (prev) {
        // 有効なエントリ（窓内 or ロック中）。ロック中はリセットしない
        entry = { ...prev, count: prev.count + 1 };
      } else {
        if (!reclaim(t)) return null; // fail closed rather than evicting an active lock
        entry = { count: 1, firstFailedAt: t, lockedUntil: 0 };
      }
      if (lock && entry.count >= threshold) {
        const exp = Math.min(entry.count - threshold, 30);
        entry.lockedUntil = Math.max(entry.lockedUntil, t + Math.min(maxLockoutMs, BASE_LOCK_MS * 2 ** exp));
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry.count;
    },

    recordSuccess(key) { entries.delete(key); },
    size: () => entries.size,
  };
}

// ---------- ガード本体 ----------

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function delayForUserFailures(count) {
  if (count < USER_DELAY_START) return 0;
  return Math.min(USER_DELAY_MAX_MS, USER_DELAY_BASE_MS * 2 ** Math.min(count - USER_DELAY_START, 3));
}

export function createBasicAuthGuard({
  expectedUsername,
  expectedPassword,
  trustedProxies = [],
  now = () => Date.now(),
  sleep = defaultSleep,
  matches = credentialsMatch,
  maxPendingDelays = 50,
}) {
  const clientIp = createClientIpResolver({ trustedProxies });
  const expected = { username: expectedUsername, password: expectedPassword };
  const normUser = (u) => String(u ?? "").slice(0, 64).toLowerCase();

  const ipTier = createTier({ threshold: IP_THRESHOLD, now });
  const pairTier = createTier({ threshold: PAIR_THRESHOLD, now });
  const userTier = createTier({ threshold: USER_DELAY_START, lock: false, now });
  let pending = 0;

  // 同期的な判定・記録（レースを作らない）
  function decide(req, username, password) {
    if (username == null || password == null) return { status: "missing" };

    const ip = clientIp(req);
    const u = normUser(username);
    const ipKey = `ip:${ip}`;
    const pairKey = `pair:${ip}:${u}`;
    const userKey = `user:${u}`;

    const retryAfterSec = Math.max(ipTier.retryAfterSec(ipKey), pairTier.retryAfterSec(pairKey));
    if (retryAfterSec > 0) return { status: "locked", retryAfterSec };

    if (matches({ username, password }, expected)) {
      ipTier.recordSuccess(ipKey);
      pairTier.recordSuccess(pairKey);
      return { status: "ok" };
    }

    const ipCount = ipTier.recordFailure(ipKey);
    const pairCount = pairTier.recordFailure(pairKey);
    if (ipCount === null || pairCount === null) return { status: "locked", retryAfterSec: 1 };
    const userCount = userTier.recordFailure(userKey) ?? USER_DELAY_START - 1;
    return { status: "invalid", delayMs: delayForUserFailures(userCount) };
  }

  return {
    async verify(req, username, password) {
      const decision = decide(req, username ?? null, password ?? null);
      if (decision.status === "invalid" && decision.delayMs > 0) {
        if (pending >= maxPendingDelays) return { status: "locked", retryAfterSec: 1 }; // 遅延待ちの上限は fail closed
        pending += 1;
        try {
          await sleep(decision.delayMs);
        } finally {
          pending -= 1;
        }
      }
      return decision;
    },
    _stats: () => ({ ip: ipTier.size(), pair: pairTier.size(), user: userTier.size(), pending }),
  };
}