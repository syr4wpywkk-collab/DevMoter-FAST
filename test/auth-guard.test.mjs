import { test } from "node:test";
import assert from "node:assert/strict";
import { createBasicAuthGuard, createClientIpResolver, createTier, normalizeIp, delayForUserFailures } from "../server/auth-guard.mjs";

const U = "owner";
const P = "correct-horse-battery-staple-16";
const req = (ip, headers = {}) => ({ socket: { remoteAddress: ip }, headers });

function clock(start = 1e12) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}
function makeGuard(extra = {}) {
  const c = clock();
  const sleeps = [];
  const guard = createBasicAuthGuard({
    expectedUsername: U,
    expectedPassword: P,
    now: c.now,
    sleep: async (ms) => { sleeps.push(ms); },
    ...extra,
  });
  return { guard, c, sleeps };
}

test("valid credentials are accepted", async () => {
  const { guard } = makeGuard();
  assert.equal((await guard.verify(req("192.0.2.1"), U, P)).status, "ok");
});

test("same IP + same user: 5 failures lock the pair, correct password is still rejected", async () => {
  const { guard } = makeGuard();
  for (let i = 0; i < 5; i++) await guard.verify(req("192.0.2.2"), U, "x" + i);
  const r = await guard.verify(req("192.0.2.2"), U, P);
  assert.equal(r.status, "locked");
  assert.ok(r.retryAfterSec > 0);
});

test("pair lock expires after backoff", async () => {
  const { guard, c } = makeGuard();
  for (let i = 0; i < 5; i++) await guard.verify(req("192.0.2.3"), U, "x");
  c.advance(3_000);
  assert.equal((await guard.verify(req("192.0.2.3"), U, P)).status, "ok");
});

test("success resets the pair counter", async () => {
  const { guard } = makeGuard();
  for (let i = 0; i < 4; i++) await guard.verify(req("192.0.2.4"), U, "x");
  assert.equal((await guard.verify(req("192.0.2.4"), U, P)).status, "ok");
  for (let i = 0; i < 4; i++) await guard.verify(req("192.0.2.4"), U, "x");
  assert.equal((await guard.verify(req("192.0.2.4"), U, P)).status, "ok");
});

test("one IP spraying many usernames gets IP-locked; other IPs are unaffected", async () => {
  const { guard } = makeGuard();
  let locked = false;
  for (let i = 0; i < 30; i++) {
    if ((await guard.verify(req("192.0.2.9"), "user" + i, "p")).status === "locked") { locked = true; break; }
  }
  assert.ok(locked, "spraying IP should be locked");
  assert.equal((await guard.verify(req("192.0.2.10"), U, P)).status, "ok");
});

test("distributed attack on one username never locks the owner globally", async () => {
  const { guard } = makeGuard();
  let lockedAny = false;
  for (let i = 0; i < 80; i++) {
    const ip = `198.51.${Math.floor(i / 250)}.${i % 250}`;
    const r = await guard.verify(req(ip), U, "wrong" + i);
    if (r.status === "locked") lockedAny = true;
  }
  assert.equal(lockedAny, false, "user tier must not lock");
  assert.equal((await guard.verify(req("203.0.113.200"), U, P)).status, "ok");
});

test("after the user threshold, failing responses are delayed (max 2s)", async () => {
  const { guard, sleeps } = makeGuard();
  for (let i = 0; i < 40; i++) await guard.verify(req(`203.0.113.${i + 1}`), U, "wrong" + i);
  assert.ok(sleeps.length > 0, "expected delayed responses");
  assert.ok(Math.max(...sleeps) <= 2_000);
  assert.equal(delayForUserFailures(19), 0);
  assert.equal(delayForUserFailures(20), 250);
  assert.equal(delayForUserFailures(100), 2_000);
});

test("successful login is never delayed, even when the user tier is hot", async () => {
  const { guard, sleeps } = makeGuard();
  for (let i = 0; i < 40; i++) await guard.verify(req(`198.18.0.${i + 1}`), U, "wrong" + i);
  const before = sleeps.length;
  assert.equal((await guard.verify(req("203.0.113.250"), U, P)).status, "ok");
  assert.equal(sleeps.length, before, "success must not sleep");
});

test("requests without credentials are never counted as failures", async () => {
  const { guard } = makeGuard();
  for (let i = 0; i < 100; i++) {
    assert.equal((await guard.verify(req("192.0.2.20"), null, null)).status, "missing");
  }
  assert.equal((await guard.verify(req("192.0.2.20"), U, P)).status, "ok");
});

test("a failure recorded during an active lock does not clear the lock", () => {
  const c = clock();
  const tier = createTier({ threshold: 5, now: c.now });
  for (let i = 0; i < 15; i++) { tier.recordFailure("k"); c.advance(60_000); }
  c.advance(60_000); // window has expired, lock still active
  assert.ok(tier.retryAfterSec("k") > 0);
  tier.recordFailure("k");
  assert.ok(tier.retryAfterSec("k") > 0, "lock must survive");
});

test("tier size stays within the cap under many unique keys", () => {
  const c = clock();
  const tier = createTier({ threshold: 5, maxTracked: 1_000, now: c.now });
  for (let i = 0; i < 5_000; i++) tier.recordFailure("u" + i);
  assert.ok(tier.size() <= 1_000);
});

test("pending delay cap fails closed", async () => {
  const gate = { open: false, resolvers: [] };
  const sleep = (ms) => (gate.open ? Promise.resolve() : new Promise((r) => gate.resolvers.push(r)));
  const { guard } = makeGuard({ sleep, maxPendingDelays: 2 });
  gate.open = true;
  for (let i = 0; i < 25; i++) await guard.verify(req(`203.0.113.${i + 1}`), U, "w" + i);
  gate.open = false;
  const pendings = [1, 2].map((i) => guard.verify(req(`198.51.100.${i}`), U, "w"));
  const third = await guard.verify(req("198.51.100.3"), U, "w");
  assert.equal(third.status, "locked");
  gate.resolvers.forEach((r) => r());
  await Promise.all(pendings);
});

test("IPv6 is bucketed by /64 (compressed forms are expanded correctly)", () => {
  assert.equal(normalizeIp("2001:db8::1"), normalizeIp("2001:db8::2"));
  assert.notEqual(normalizeIp("2001:db8::1"), normalizeIp("2001:db8:1::1"));
  assert.equal(normalizeIp("::ffff:192.0.2.5"), "192.0.2.5");
});

test("X-Forwarded-For is ignored unless the socket is a trusted proxy", () => {
  const untrusted = createClientIpResolver({ trustedProxies: [] });
  assert.equal(untrusted(req("203.0.113.5", { "x-forwarded-for": "6.6.6.6" })), "203.0.113.5");

  const trusted = createClientIpResolver({ trustedProxies: ["127.0.0.1"] });
  // クライアントが前に偽の値を付けても、プロキシが追記した最後の値を採用する
  assert.equal(trusted(req("127.0.0.1", { "x-forwarded-for": "6.6.6.6, 203.0.113.9" })), "203.0.113.9");
  assert.equal(trusted(req("127.0.0.1")), "127.0.0.1");
});

test("trusted IPv6 proxies are matched by exact address, not /64", () => {
  const resolver = createClientIpResolver({ trustedProxies: ["2001:db8::1"] });
  assert.equal(resolver(req("2001:db8::2", { "x-forwarded-for": "6.6.6.6" })), normalizeIp("2001:db8::2"));
  assert.equal(resolver(req("2001:0db8:0:0:0:0:0:1", { "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
});

test("capacity pressure never evicts an active lock", () => {
  const c = clock();
  const tier = createTier({ threshold: 1, maxTracked: 1, now: c.now });
  tier.recordFailure("locked");
  assert.equal(tier.recordFailure("new"), null);
  assert.ok(tier.retryAfterSec("locked") > 0);
  assert.equal(tier.size(), 1);
});
