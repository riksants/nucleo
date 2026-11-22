#!/usr/bin/env bash
# Backup self-test: proves the WHOLE backup→encrypt→decrypt→restore→compare→validate pipeline on a
# real Postgres, using SYNTHETIC data only — no production, no secrets. Runs in CI on every push
# (.github/workflows/backup-selftest.yml). Any break in the restore machinery turns the run red here,
# before it can ever reach the real daily backup.
#
# Env: SOURCE_DB_URL (empty Postgres, superuser — seeded and read), VERIFY_DB_URL (empty Postgres,
#      superuser — restored into). They must be two DIFFERENT databases. OUT_DIR optional.
set -euo pipefail
umask 077
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

: "${SOURCE_DB_URL:?defina SOURCE_DB_URL (Postgres vazio para a origem sintética)}"
: "${VERIFY_DB_URL:?defina VERIFY_DB_URL (Postgres vazio para restaurar)}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
DATA="$WORK/data"
BACK="$WORK/back"
mkdir -p "$DATA" "$BACK"

log "1/5 montando a origem sintética (stub + migrations + dados falsos)"
prepare_restore_db "$SOURCE_DB_URL"
run seed psql_to "$SOURCE_DB_URL" -f "$(native "$HERE/selftest-seed.sql")"

log "2/5 exportando (mesmo export.sql do backup real)"
run export psql_to "$SOURCE_DB_URL" -v dir="$(native "$DATA")" -f "$(native "$HERE/export.sql")"
summary "$DATA/checksums.txt"

log "3/5 ida e volta de criptografia (age), com chave de uso único"
tar -C "$DATA" -czf "$WORK/backup.tar.gz" .
run keygen "$AGE_KEYGEN" -o "$(native "$WORK/check.key")"
recipient=$("$AGE_KEYGEN" -y "$(native "$WORK/check.key")")
run encrypt "$AGE" -r "$recipient" -o "$(native "$WORK/backup.tar.gz.age")" "$(native "$WORK/backup.tar.gz")"
run decrypt "$AGE" -d -i "$(native "$WORK/check.key")" -o "$(native "$WORK/back.tar.gz")" "$(native "$WORK/backup.tar.gz.age")"
if ! cmp -s "$WORK/backup.tar.gz" "$WORK/back.tar.gz"; then
  log "FALHOU: o arquivo criptografado não reabre idêntico"
  exit 1
fi
tar -C "$BACK" -xzf "$WORK/back.tar.gz"

log "4/5 restaurando num banco vazio e comparando (linhas, checksums, estrutura e invariantes)"
restore_and_compare "$VERIFY_DB_URL" "$BACK"

log "5/5 ok: exportou, criptografou, reabriu, restaurou do zero, bateu igual e validou a estrutura"
