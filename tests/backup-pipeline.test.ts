/**
 * PARTE 15: contrato do backup e da restauração (workflows + scripts). Falha se alguém enfraquecer
 * as proteções: artefato não criptografado, retenção removida, self-test dependendo de produção/secret,
 * validação pós-restore retirada, ou os SQLs de export/checksums/restore saindo de sincronia. Lê só o repo.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const backup = read('.github/workflows/backup.yml')
const selftest = read('.github/workflows/backup-selftest.yml')
const recovery = read('.github/workflows/account-recovery.yml')
const backupSh = read('scripts/backup/backup.sh')
const libSh = read('scripts/backup/lib.sh')
const exportSql = read('scripts/backup/export.sql')
const checksumsSql = read('scripts/backup/checksums.sql')
const restoreSql = read('scripts/backup/restore.sql')

describe('backup diário (produção): seguro e fail-closed', () => {
  it('só roda no repositório oficial', () => {
    expect(backup).toMatch(/github\.repository == 'riksants\/nucleo'/)
  })
  it('sobe só o arquivo criptografado (.age), nunca os dados em claro', () => {
    expect(backup).toMatch(/path:\s*backup-out\/\*\.age/)
    expect(backup).not.toMatch(/\*\.csv|\*\.tar\.gz\b/)
  })
  it('tem retenção automática e falha se não houver arquivo', () => {
    expect(backup).toMatch(/retention-days:\s*30/)
    expect(backup).toMatch(/if-no-files-found:\s*error/)
  })
  it('restaura numa cópia descartável antes de guardar (serviço postgres)', () => {
    expect(backup).toMatch(/image:\s*postgres:/)
    expect(backup).toMatch(/bash scripts\/backup\/backup\.sh/)
  })
  it('configuração pela metade falha; ausente não toca em nada (fail-closed)', () => {
    expect(backup).toMatch(/Configuração incompleta[\s\S]*exit 1/)
    expect(backup).toMatch(/ready=false/)
  })
})

describe('self-test do restore (CI, isolado): prova sem produção nem secrets', () => {
  it('roda em push e no agendamento', () => {
    expect(selftest).toMatch(/on:\n[\s\S]*push:/)
    expect(selftest).toMatch(/schedule:/)
  })
  it('NÃO usa nenhum secret nem toca em produção', () => {
    expect(selftest).not.toMatch(/secrets\./)
    expect(selftest).not.toMatch(/NUCLEO_BACKUP_DB_URL/)
  })
  it('sobe o pipeline real (postgres + age) pelo selftest.sh', () => {
    expect(selftest).toMatch(/image:\s*postgres:/)
    expect(selftest).toMatch(/bash scripts\/backup\/selftest\.sh/)
    expect(selftest).toMatch(/install[^\n]*\bage\b/)
  })
})

describe('recuperação de contas: provada contra um GoTrue real, sem produção', () => {
  it('sobe o GoTrue oficial e roda o teste de reset+login', () => {
    expect(recovery).toMatch(/image:\s*supabase\/gotrue/i)
    expect(recovery).toMatch(/account-recovery-recreate\.sql/)
    expect(recovery).toMatch(/node scripts\/backup\/account-recovery-test\.mjs/)
  })
  it('recria em auth.users E auth.identities (identidade de e-mail exigida)', () => {
    const sql = read('scripts/backup/account-recovery-recreate.sql')
    expect(sql).toMatch(/insert into auth\.users/)
    expect(sql).toMatch(/insert into auth\.identities/)
  })
  it('não usa secrets de produção', () => {
    expect(recovery).not.toMatch(/secrets\./)
    expect(recovery).not.toMatch(/NUCLEO_BACKUP_DB_URL/)
  })
})

describe('toda restauração valida a estrutura, não só as linhas', () => {
  it('restore_and_compare roda o validate.sql', () => {
    expect(libSh).toMatch(/validate.*validate\.sql/)
  })
})

describe('export, checksums e restore ficam em sincronia (inclui ai_entitlements)', () => {
  for (const [name, sql] of [
    ['export.sql', exportSql],
    ['checksums.sql', checksumsSql],
    ['restore.sql', restoreSql],
  ] as const) {
    it(`${name} cobre ai_entitlements`, () => {
      expect(sql).toMatch(/ai_entitlements/)
    })
  }
})

describe('backup autossuficiente (format=2): o DDL viaja dentro do arquivo', () => {
  it('o tarball embute migrations, os SQLs de restauração e o script de bundle', () => {
    expect(backupSh).toMatch(/format=2/)
    expect(backupSh).toMatch(/schema\/migrations/)
    expect(backupSh).toMatch(/restore-from-bundle\.sh/)
    expect(backupSh).toMatch(/RESTORE\.txt/)
  })
})
