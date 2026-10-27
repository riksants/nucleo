#!/usr/bin/env bash
# Shared by backup.sh (GitHub Actions) and restore-local.sh (owner's computer).
# Nothing here prints data: only table names, row counts and sizes.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PSQL="${PG_BIN:+$PG_BIN/}psql"
AGE="${AGE_BIN:+$AGE_BIN/}age"
AGE_KEYGEN="${AGE_BIN:+$AGE_BIN/}age-keygen"

log() { printf '%s\n' "$*"; }

# Paths given to psql/age (native Windows binaries need C:/... under Git Bash).
native() { if command -v cygpath > /dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

# Error lines without row contents: Postgres puts values in DETAIL/CONTEXT/LINE, never in the
# first line; connection strings are hidden too.
sanitize() {
  grep -E 'ERROR|FATAL|error|failed|could not' \
    | grep -vE 'DETAIL|CONTEXT|LINE [0-9]|HINT' \
    | sed -E 's#postgres(ql)?://[^[:space:]]+#<conexão>#g' \
    | cut -c1-200 | head -5 || true
}

# run <name> <command...>: output goes to files in $WORK; on failure only sanitized errors are shown.
run() {
  local name=$1
  shift
  if ! "$@" > "$WORK/$name.out" 2> "$WORK/$name.err"; then
    log "FALHOU: $name"
    sanitize < "$WORK/$name.err"
    exit 1
  fi
}

# psql_to <url> <args...>
psql_to() {
  local url=$1
  shift
  "$PSQL" "$url" -X -q -v ON_ERROR_STOP=1 "$@"
}

# Empty database with the Supabase stand-in and every migration of the repository, in order.
prepare_restore_db() {
  local url=$1 f
  run stub psql_to "$url" -f "$(native "$HERE/supabase-stub.sql")"
  for f in $(ls "$REPO"/supabase/migrations/*.sql | sort); do
    run "migration-$(basename "$f" .sql)" psql_to "$url" -f "$(native "$f")"
  done
}

# restore_and_compare <url> <folder with the CSVs>: fails unless the restore has exactly the same
# rows and checksums as the source.
restore_and_compare() {
  local url=$1 dir=$2
  prepare_restore_db "$url"
  run restore psql_to "$url" -v dir="$(native "$dir")" -f "$(native "$HERE/restore.sql")"
  run checksums-restored psql_to "$url" -f "$(native "$HERE/checksums.sql")"
  if ! diff -q "$dir/checksums.txt" "$WORK/checksums-restored.out" > /dev/null; then
    log "FALHOU: a restauração não ficou igual à origem"
    diff <(cut -f1,2 "$dir/checksums.txt") <(cut -f1,2 "$WORK/checksums-restored.out") || true
    exit 1
  fi
}

# Table and rows (no checksums in the log).
summary() { awk -F'\t' '{ printf "  %-15s %s linhas\n", $1, $2 }' "$1"; }
