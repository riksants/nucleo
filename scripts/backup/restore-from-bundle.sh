#!/usr/bin/env bash
# Rebuilds a backup into an EMPTY LOCAL Postgres using ONLY what is inside the backup itself
# (no repository, no internet). A copy of this script, the stub, the migrations and the restore
# SQL travel inside every encrypted backup (schema/ folder). For the disaster runbook see
# RECUPERACAO-DESASTRE.md (also copied into schema/).
#
# Extract the backup, then from the schema/ folder run:
#   ./restore-from-bundle.sh "postgresql://postgres@localhost:5432/teste"
#
# The target database's public and auth schemas are ERASED first, so point it at a throwaway local
# database. It refuses to run against Supabase. The restored data stays there to be inspected.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="$(cd "$HERE/.." && pwd)" # the extracted backup root (records.csv, checksums.txt, manifest.txt...)
url=${1:?informe a URL de um Postgres LOCAL vazio}
case "$url" in
  *supabase*) echo "Recusado: isto é para um Postgres LOCAL, nunca o Supabase." >&2; exit 1 ;;
esac
PSQL="${PG_BIN:+$PG_BIN/}psql"
native() { if command -v cygpath > /dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
run() { "$PSQL" "$url" -X -q -v ON_ERROR_STOP=1 "$@"; }

echo "1/4 limpando o banco de teste"
run -c "drop schema if exists public cascade" -c "drop schema if exists auth cascade" -c "create schema public"
echo "2/4 estrutura (stub + migrations deste backup)"
run -f "$(native "$HERE/supabase-stub.sql")"
for f in $(ls "$HERE"/migrations/*.sql | sort); do run -f "$(native "$f")"; done
echo "3/4 dados"
run -v dir="$(native "$DATA")" -f "$(native "$HERE/restore.sql")"
echo "4/4 estrutura e invariantes (validate.sql)"
run -f "$(native "$HERE/validate.sql")"
echo "ok: restaurado e validado só com o backup (compare contagens com schema/checksums.txt se quiser)"
