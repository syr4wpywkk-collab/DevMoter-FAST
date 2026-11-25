#!/usr/bin/env bash
# Valkey: make build of valkey-server and valkey-cli with the bundled jemalloc.
# Valkey only builds in-tree, so it builds inside the exported copy of the source, never in the vendored directory.
# TLS is off: the initial phase is local-only and connects over a unix socket.
# Needs: a C compiler, make, pkg-config.
set -euo pipefail

case "${1:-}" in
  build)
    make -C "$DMB_SRC" -j"$DMB_JOBS" BUILD_TLS=no USE_SYSTEMD=no MALLOC=jemalloc
    make -C "$DMB_SRC" PREFIX="$DMB_PREFIX" BUILD_TLS=no USE_SYSTEMD=no MALLOC=jemalloc install
    ;;
  smoke)
    sock="$DMB_TMP/valkey.sock"
    # Unix socket only (port 0): the smoke test never opens a TCP port.
    "$DMB_PREFIX/bin/valkey-server" --port 0 --unixsocket "$sock" --unixsocketperm 700 \
      --dir "$DMB_TMP" --save "" --appendonly no --daemonize no >"$DMB_TMP/valkey.log" 2>&1 &
    pid=$!
    trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true' EXIT
    cli() { "$DMB_PREFIX/bin/valkey-cli" -s "$sock" "$@"; }
    for _ in $(seq 1 100); do [ -S "$sock" ] && [ "$(cli ping 2>/dev/null)" = PONG ] && break; sleep 0.1; done
    [ "$(cli ping)" = PONG ] || { cat "$DMB_TMP/valkey.log" >&2; exit 1; }
    [ "$(cli set devmoter:smoke base)" = OK ]
    [ "$(cli get devmoter:smoke)" = base ] || { echo "valkey: GET returned the wrong value" >&2; exit 1; }
    [ "$(cli incrby devmoter:counter 41)" = 41 ] && [ "$(cli incr devmoter:counter)" = 42 ]
    echo "valkey $(cli info server | tr -d '\r' | sed -n 's/^valkey_version://p')"
    cli shutdown nosave >/dev/null 2>&1 || true
    ;;
  *) echo "usage: $0 build|smoke" >&2; exit 2 ;;
esac
