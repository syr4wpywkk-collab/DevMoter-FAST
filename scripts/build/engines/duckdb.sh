#!/usr/bin/env bash
# DuckDB: CMake + Ninja release build of libduckdb and the duckdb shell, with the
# default statically linked extensions (core_functions, parquet, json, icu).
# Needs: a C++17 compiler, cmake, ninja, python3.
set -euo pipefail

case "${1:-}" in
  build)
    # The exported source has no git metadata, so the version is passed explicitly.
    release=$(tr -d '[:space:]' < "$DMB_SRC/scripts/ci/release_version.txt")
    cmake -S "$DMB_SRC" -B "$DMB_WORK" -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX="$DMB_PREFIX" \
      -DGIT_COMMIT_HASH="$DMB_COMMIT" \
      -DDUCKDB_EXPLICIT_VERSION="v${release}.0-dev0" \
      -DBUILD_SHELL=ON \
      -DBUILD_UNITTESTS=OFF \
      -DBUILD_BENCHMARKS=OFF \
      -DENABLE_SANITIZER=OFF \
      -DENABLE_UBSAN=OFF
    cmake --build "$DMB_WORK" --parallel "$DMB_JOBS"
    cmake --install "$DMB_WORK"
    ;;
  smoke)
    db="$DMB_TMP/smoke.duckdb"
    # -no-init: the user's ~/.duckdbrc must not change or add to the output.
    duckdb() { "$DMB_PREFIX/bin/duckdb" -no-init "$@"; }
    result=$(duckdb "$db" -noheader -csv -c \
      "CREATE TABLE t AS SELECT i AS id, 'row' || i AS name FROM range(1000) r(i); SELECT count(*), sum(id) FROM t;")
    [ "$result" = "1000,499500" ] || { echo "duckdb: unexpected query result: $result" >&2; exit 1; }
    # Parquet and JSON are statically linked: round-trip through both.
    result=$(duckdb "$db" -noheader -csv -c \
      "COPY t TO '$DMB_TMP/t.parquet' (FORMAT parquet); SELECT count(*) FROM '$DMB_TMP/t.parquet' WHERE json_extract_string('{\"k\":\"v\"}', '\$.k') = 'v';")
    [ "$result" = "1000" ] || { echo "duckdb: parquet/json round trip failed: $result" >&2; exit 1; }
    echo "duckdb $(duckdb -noheader -csv -c 'SELECT version();')"
    ;;
  *) echo "usage: $0 build|smoke" >&2; exit 2 ;;
esac
