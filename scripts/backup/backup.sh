#!/usr/bin/env bash
# Daily backup of the Núcleo data (GitHub Actions, .github/workflows/backup.yml).
#
# 1. Reads records, user_settings, quota_limits, schema_version and the account list from Supabase
#    as nucleo_backup (read-only user), in one snapshot.
# 2. Restores it into a throwaway Postgres (VERIFY_DB_URL) with every migration of the repository and
#    compares row counts and checksums: a backup that cannot be restored fails the run.
# 3. Encrypts it for the owner's PUBLIC key (age). Only the owner's private key, which is never on
#    GitHub, opens the file. A second, one-time key made here checks that the encrypted file opens
#    and is identical; it disappears with the machine.
#
# Env: NUCLEO_BACKUP_DB_URL (secret), NUCLEO_BACKUP_AGE_RECIPIENT (public key "age1..."),
#      VERIFY_DB_URL (empty Postgres, superuser), OUT_DIR (default backup-out),
#      BACKUP_MAX_MB (default 200), PG_BIN / AGE_BIN (optional folders of the binaries).
set -euo pipefail
umask 077
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

: "${NUCLEO_BACKUP_DB_URL:?defina NUCLEO_BACKUP_DB_URL (secret do GitHub)}"
: "${NUCLEO_BACKUP_AGE_RECIPIENT:?defina NUCLEO_BACKUP_AGE_RECIPIENT (chave pública age1...)}"
: "${VERIFY_DB_URL:?defina VERIFY_DB_URL (Postgres vazio para conferir a restauração)}"
OUT_DIR="${OUT_DIR:-backup-out}"
MAX_MB="${BACKUP_MAX_MB:-200}"
case "$NUCLEO_BACKUP_AGE_RECIPIENT" in
  age1*) ;;
  *)
    log "FALHOU: NUCLEO_BACKUP_AGE_RECIPIENT não é uma chave pública age (age1...)"
    exit 1
    ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
DATA="$WORK/data"
mkdir -p "$DATA" "$OUT_DIR"

log "1/4 lendo o banco"
run export psql_to "$NUCLEO_BACKUP_DB_URL" -v dir="$(native "$DATA")" -f "$(native "$HERE/export.sql")"
summary "$DATA/checksums.txt"

# The production database must have exactly the migrations of the repository (A11).
cut -d, -f1 "$DATA/schema_version.csv" | sort > "$WORK/prod-versions"
ls "$REPO"/supabase/migrations/*.sql | xargs -n1 basename | sed 's/\.sql$//' | sort > "$WORK/repo-versions"
missing=$(comm -13 "$WORK/prod-versions" "$WORK/repo-versions" | tr '\n' ' ')
extra=$(comm -23 "$WORK/prod-versions" "$WORK/repo-versions" | tr '\n' ' ')
if [ -n "$missing" ]; then log "::warning::Migrations do repositório que a produção ainda não tem: $missing"; fi
if [ -n "$extra" ]; then log "::warning::Migrations na produção que não estão no repositório: $extra"; fi

log "2/4 restaurando num banco vazio para conferir"
restore_and_compare "$VERIFY_DB_URL" "$DATA"
log "  restauração idêntica à origem"

log "3/4 criptografando"
name="nucleo-backup-$(date -u +%Y-%m-%dT%H%MZ)"
{
  echo "app=nucleo"
  echo "format=2"
  echo "created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "commit=${GITHUB_SHA:-local}"
} > "$DATA/manifest.txt"
# Self-contained recovery: the DDL that rebuilds the whole database (schema, functions, policies/RLS,
# triggers) and a standalone restore script travel INSIDE the encrypted backup. The .age file plus the
# private key are enough to restore, even if this repository is ever lost. (format=2)
mkdir -p "$DATA/schema/migrations"
cp "$REPO"/supabase/migrations/*.sql "$DATA/schema/migrations/"
cp "$HERE/supabase-stub.sql" "$HERE/restore.sql" "$HERE/checksums.sql" "$HERE/validate.sql" \
   "$HERE/restore-from-bundle.sh" "$DATA/schema/"
cp "$REPO/docs/RECUPERACAO-DESASTRE.md" "$DATA/schema/" 2> /dev/null || true
cat > "$DATA/schema/RESTORE.txt" << 'TXT'
Restaurar este backup num Postgres LOCAL vazio (nunca no Supabase), sem precisar do repositório:
  1. Instale o age (https://github.com/FiloSottile/age) e o cliente do Postgres (psql) 15+.
  2. Abra:  age -d -i SUA-CHAVE-PRIVADA.txt -o backup.tar.gz nucleo-backup-....tar.gz.age
            tar -xzf backup.tar.gz
  3. Entre na pasta schema/ e rode:
            bash restore-from-bundle.sh "postgresql://postgres@localhost:5432/teste"
     (o banco "teste" é apagado e recriado; o script confere estrutura e lê um registro real.)
Conteúdo: records.csv, user_settings.csv, quota_limits.csv, schema_version.csv, ai_entitlements.csv,
accounts.csv (id/e-mail/criação das contas), checksums.txt, manifest.txt e schema/ (todo o DDL).
NÃO incluso: senhas de login (o dono recria as contas — ver RECUPERACAO-DESASTRE.md), notificações
agendadas e aparelhos de push (o app recria), e o histórico de versões (o backup é o estado do dia).
TXT
tar -C "$DATA" -czf "$WORK/$name.tar.gz" .
run keygen "$AGE_KEYGEN" -o "$(native "$WORK/check.key")"
check_recipient=$("$AGE_KEYGEN" -y "$(native "$WORK/check.key")")
run encrypt "$AGE" -r "$NUCLEO_BACKUP_AGE_RECIPIENT" -r "$check_recipient" -o "$(native "$OUT_DIR/$name.tar.gz.age")" "$(native "$WORK/$name.tar.gz")"

log "4/4 conferindo o arquivo criptografado"
run decrypt "$AGE" -d -i "$(native "$WORK/check.key")" -o "$(native "$WORK/check.tar.gz")" "$(native "$OUT_DIR/$name.tar.gz.age")"
if ! cmp -s "$WORK/$name.tar.gz" "$WORK/check.tar.gz"; then
  log "FALHOU: o arquivo criptografado não abre igual"
  exit 1
fi
bytes=$(wc -c < "$OUT_DIR/$name.tar.gz.age" | tr -d ' ')
if [ "$bytes" -gt $((MAX_MB * 1024 * 1024)) ]; then
  log "FALHOU: backup com $bytes bytes, acima do máximo de $MAX_MB MB (BACKUP_MAX_MB)"
  exit 1
fi
log "  $name.tar.gz.age ($bytes bytes), aberto e conferido"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "name=$name" >> "$GITHUB_OUTPUT"; fi
log "ok"
