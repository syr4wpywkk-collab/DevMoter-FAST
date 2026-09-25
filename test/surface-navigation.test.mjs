import test from "node:test";
import assert from "node:assert/strict";
import { createSurfaceNavigation, initialMainSurface } from "../src/surface-navigation.mjs";

function fakeWindow(path = "/") {
  const entries = [{ href: `http://devmoter.test${path}`, state: null }];
  let index = 0;
  const listeners = new Map();
  const location = {};
  Object.defineProperties(location, {
    href: { get: () => entries[index].href },
    pathname: { get: () => new URL(entries[index].href).pathname },
    search: { get: () => new URL(entries[index].href).search },
    hash: { get: () => new URL(entries[index].href).hash }
  });
  const history = {
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    pushState(state, _title, url) {
      entries.splice(index + 1);
      entries.push({ href: new URL(url, location.href).href, state });
      index++;
    },
    replaceState(state, _title, url) { entries[index] = { href: new URL(url, location.href).href, state }; },
    back() { if (index > 0) { index--; emit("popstate"); } },
    forward() { if (index < entries.length - 1) { index++; emit("popstate"); } }
  };
  function emit(type) { for (const callback of listeners.get(type) || []) callback({ type }); }
  return {
    history, location,
    addEventListener(type, callback) { const list = listeners.get(type) || new Set(); list.add(callback); listeners.set(type, list); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    back: () => history.back(), forward: () => history.forward()
  };
}

test("normal startup lands on Home and reload can restore the Home URL", () => {
  assert.equal(initialMainSurface("", { savedBackend: "codex" }), "home");
  const win = fakeWindow();
  const nav = createSurfaceNavigation({ window: win });
  assert.equal(nav.current(), "home");
  assert.equal(new URL(win.location.href).searchParams.get("surface"), "home");
  const reloaded = createSurfaceNavigation({ window: win });
  assert.equal(reloaded.current(), "home");
});

test("legacy backend/session/project deep links keep a usable existing surface", () => {
  assert.equal(initialMainSurface("?backend=codex&session=t1"), "codex");
  assert.equal(initialMainSurface("?session=t1", { savedBackend: "api" }), "api");
  assert.equal(initialMainSurface("", { hasProjectDeepLink: true, savedBackend: "opencode" }), "opencode");
  assert.equal(initialMainSurface("?surface=home&backend=codex"), "home");
});

test("Home to surface to Home updates Back and Forward without duplicate entries", () => {
  const win = fakeWindow();
  const changes = [];
  const nav = createSurfaceNavigation({ window: win, onSurface: surface => changes.push(surface) });
  assert.equal(nav.navigate("codex"), true);
  const afterOpen = win.history.length;
  assert.equal(nav.navigate("codex"), false);
  assert.equal(win.history.length, afterOpen);
  assert.equal(nav.current(), "codex");
  assert.equal(nav.navigate("home"), true);
  assert.equal(nav.current(), "home");
  win.back();
  assert.equal(nav.current(), "codex");
  win.forward();
  assert.equal(nav.current(), "home");
  assert.deepEqual(changes, ["codex", "home", "codex", "home"]);
});

test("repeated Home navigation preserves one history entry and route parameters", () => {
  const win = fakeWindow("/?project=p1#notes");
  const nav = createSurfaceNavigation({ window: win, hasProjectDeepLink: true, savedBackend: "opencode" });
  assert.equal(nav.current(), "opencode");
  const depth = win.history.length;
  nav.navigate("home");
  nav.navigate("home");
  assert.equal(win.history.length, depth + 1);
  const url = new URL(win.location.href);
  assert.equal(url.searchParams.get("project"), "p1");
  assert.equal(url.searchParams.get("surface"), "home");
  assert.equal(url.hash, "#notes");
});

test("temporary modal state is not serialized as a main surface", () => {
  const win = fakeWindow();
  const nav = createSurfaceNavigation({ window: win });
  const depth = win.history.length;
  // Opening and closing Settings does not call main-surface navigation.
  assert.equal(nav.current(), "home");
  assert.equal(win.history.length, depth);
  assert.equal(new URL(win.location.href).searchParams.get("surface"), "home");
});
