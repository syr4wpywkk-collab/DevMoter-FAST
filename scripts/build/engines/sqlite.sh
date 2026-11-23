#!/usr/bin/env bash
# SQLite: out-of-tree autosetup build of the library and the sqlite3 shell.
# Needs: a C compiler and make. Tcl is not required (the tree builds its own jimsh for code generation).
set -euo pipefail

case "${1:-}" in
  build)
    cd "$DMB_WORK"
    "$DMB_SRC/configure" --prefix="$DMB_PREFIX" --disable-tcl --disable-readline --all
    make -j"$DMB_JOBS" sqlite3
    make install
    ;;
  smoke)
    db="$DMB_TMP/smoke.sqlite"
    # -noinit: the user's ~/.sqliterc must not change the output format.
    sqlite3() { "$DMB_PREFIX/bin/sqlite3" -batch -noinit "$@"; }
    result=$(sqlite3 "$db" \
      "CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO t(name) VALUES ('devmoter'), ('base'); SELECT count(*) || ':' || group_concat(name, ',') FROM t;")
    [ "$result" = "2:devmoter,base" ] || { echo "sqlite: unexpected query result: $result" >&2; exit 1; }
    sqlite3 "$db" "PRAGMA integrity_check;" | grep -qx ok
    echo "sqlite $(sqlite3 -version | cut -d' ' -f1)"
    ;;
  *) echo "usage: $0 build|smoke" >&2; exit 2 ;;
esac
