#!/usr/bin/env bash
# Opens a backup with YOUR private key and restores it into an EMPTY local Postgres, checking that
# every table matches what was saved. Never touches Supabase.
#
#   scripts/backup/restore-local.sh <nucleo-backup-....tar.gz.age> <chave-privada.txt> <url do Postgres local>
#
# The database in the URL is erased first (it must be a local test database). The restored data
# stays there to be inspected; the decrypted files are deleted at the end.
set -euo pipefail
umask 077
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

file=${1:?arquivo .age}
key=${2:?chave privada}
url=${3:?url de um Postgres local}
case "$url" in
  *supabase*)
    log "Recusado: isto é para um Postgres LOCAL, nunca o Supabase."
    exit 1
    ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
DATA="$WORK/data"
mkdir -p "$DATA"

log "1/3 abrindo o arquivo"
run decrypt "$AGE" -d -i "$(native "$key")" -o "$(native "$WORK/backup.tar.gz")" "$(native "$file")"
tar -C "$DATA" -xzf "$WORK/backup.tar.gz"
grep -E '^(created_at|commit)=' "$DATA/manifest.txt" | sed 's/^/  /'
summary "$DATA/checksums.txt"

log "2/3 apagando o banco local de teste e restaurando"
run reset psql_to "$url" -c "drop schema if exists public cascade" -c "drop schema if exists auth cascade" -c "create schema public"
restore_and_compare "$url" "$DATA"

log "3/3 ok: o backup restaurou completo e idêntico (linhas e somas de verificação de todas as tabelas)"
