#!/usr/bin/env bash
# Runs supabase/tests/*.sql against a throwaway local Postgres (no Docker, no Supabase CLI).
# Needs PostgreSQL server binaries and root (or run as a user allowed to start postgres).
# Each test file gets a fresh database with the stubs, all migrations and grants applied.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
PGDIR="$(mktemp -d /var/tmp/phishsim-pg.XXXXXX)"
PORT="${PGPORT:-55432}"
run_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$PGDIR"
cleanup() { run_pg "$PGBIN/pg_ctl" -D "$PGDIR/data" -m fast stop >/dev/null 2>&1 || true; rm -rf "$PGDIR"; }
trap cleanup EXIT
run_pg "$PGBIN/initdb" -D "$PGDIR/data" -A trust >/dev/null
run_pg "$PGBIN/pg_ctl" -D "$PGDIR/data" -o "-p $PORT -k $PGDIR" -l "$PGDIR/log" -w start >/dev/null
psql_() { psql -h "$PGDIR" -p "$PORT" -U postgres -X -q "$@"; }
status=0
for t in "$ROOT"/supabase/tests/[a-z]*.sql; do
  name="$(basename "$t" .sql)"; db="t_$name"
  psql_ -d postgres -c "create database $db" >/dev/null
  psql_ -d "$db" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/_stubs.sql" >/dev/null
  for m in "$ROOT"/supabase/migrations/*.sql; do psql_ -d "$db" -v ON_ERROR_STOP=1 -f "$m" >/dev/null; done
  psql_ -d "$db" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/_grants.sql" >/dev/null
  echo "=================== $name"
  psql_ -d "$db" -f "$t" 2>&1 | grep -v '^$' || status=1
done
exit $status
