#!/usr/bin/env bash
# PostgreSQL: out-of-tree configure + make build of the server and client tools.
# ICU and readline are off to keep the system dependencies small; password
# authentication (SCRAM) does not need OpenSSL. TLS is off: the initial phase is local-only.
# Needs: a C compiler, make, bison, flex, perl, pkg-config, zlib headers.
set -euo pipefail

case "${1:-}" in
  build)
    cd "$DMB_WORK"
    "$DMB_SRC/configure" --prefix="$DMB_PREFIX" --without-icu --without-readline
    make -j"$DMB_JOBS"
    make install
    ;;
  smoke)
    [ "$(id -u)" != 0 ] || { echo "postgresql: the server refuses to run as root; run the smoke test as a normal user" >&2; exit 1; }
    data="$DMB_TMP/pgdata"
    sockdir="$DMB_TMP/pgsock"
    mkdir -m 700 "$sockdir"
    # "trust" applies only to the unix socket, which sits in a directory only this user can enter.
    "$DMB_PREFIX/bin/initdb" -D "$data" -U devmoter --auth-local=trust --auth-host=reject --encoding=UTF8 --locale=C >"$DMB_TMP/initdb.log" 2>&1 \
      || { cat "$DMB_TMP/initdb.log" >&2; exit 1; }
    # Unix socket only (listen_addresses=''): the smoke test never opens a TCP port.
    start() { "$DMB_PREFIX/bin/pg_ctl" -D "$data" -l "$DMB_TMP/postgres.log" -w -t 60 \
      -o "-c listen_addresses='' -c unix_socket_directories='$sockdir' -c unix_socket_permissions=0700" start >/dev/null; }
    stop() { "$DMB_PREFIX/bin/pg_ctl" -D "$data" -m fast -w stop >/dev/null 2>&1 || true; }
    start || { cat "$DMB_TMP/postgres.log" >&2; exit 1; }
    trap stop EXIT
    psql() { "$DMB_PREFIX/bin/psql" -X -q -A -t -v ON_ERROR_STOP=1 -h "$sockdir" -U devmoter -d postgres "$@"; }
    result=$(psql -c "CREATE TABLE t(id int PRIMARY KEY, name text); INSERT INTO t SELECT i, 'row' || i FROM generate_series(1, 1000) i; SELECT count(*) || ':' || sum(id) FROM t;")
    [ "$result" = "1000:500500" ] || { echo "postgresql: unexpected query result: $result" >&2; exit 1; }
    echo "postgresql $(psql -c 'SHOW server_version;')"
    ;;
  *) echo "usage: $0 build|smoke" >&2; exit 2 ;;
esac
