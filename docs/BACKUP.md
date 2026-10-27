# Backup e histórico de versões

Duas proteções, independentes:

| | Histórico de versões | Backup diário |
|---|---|---|
| Para quê | desfazer uma edição ou exclusão errada de um item | perda grande: banco apagado, projeto perdido, bug em massa |
| Onde fica | no próprio Supabase (`records_history`) | arquivo criptografado nos artefatos do GitHub Actions |
| Por quanto tempo | 30 dias | 30 dias (um arquivo por dia) |
| Limites | 20 versões por item, 25 MB por conta, 1 versão a cada 10 min por item em edições seguidas (exclusões sempre) | máximo 200 MB por arquivo (`BACKUP_MAX_MB`) |
| Quem abre | o dono do projeto, pelo SQL Editor | só quem tem a chave privada (só você) |

Os limites do histórico ficam em `quota_limits` (`history.days`, `history.per_item`, `history.bytes`,
`history.interval_minutes`) e mudam sem migração nova. Passando do tamanho da conta, saem as versões mais
antigas: o histórico nunca impede uma escrita.

## Configurar o backup (uma vez)

Nada disso fica no repositório. A chave privada nunca vai para o GitHub.

1. **Chave de criptografia (no seu computador).** Instale o [age](https://github.com/FiloSottile/age/releases)
   (Windows: `age-v1.x-windows-amd64.zip`) e rode:
   ```
   age-keygen -o nucleo-backup-chave.txt
   ```
   Ele mostra `Public key: age1...`. **Guarde o arquivo `nucleo-backup-chave.txt` num lugar seguro e fora do
   GitHub** (gerenciador de senhas + uma cópia offline). Sem ele nenhum backup abre, nem para você.
2. **Senha do usuário de backup (SQL Editor do Supabase).** Gere uma senha longa só com letras e números
   (40+ caracteres) e rode:
   ```sql
   alter role nucleo_backup with login password 'COLE-A-SENHA-AQUI';
   ```
   Esse usuário só lê `records`, `user_settings`, `quota_limits`, `schema_version` e a lista de contas;
   não grava nada (testado: UPDATE, INSERT e DELETE são recusados).
3. **GitHub → Settings → Secrets and variables → Actions:**
   - *Secrets* → `NUCLEO_BACKUP_DB_URL`:
     `postgresql://nucleo_backup.<ref-do-projeto>:<senha>@<host-do-pooler>:5432/postgres?sslmode=require`
     (host do pooler: Supabase → Connect → **Session pooler**; a conexão direta não funciona no GitHub, que
     não tem IPv6).
   - *Variables* → `NUCLEO_BACKUP_AGE_RECIPIENT`: a chave **pública** `age1...` do passo 1.
4. **Primeiro backup:** GitHub → Actions → Backup → *Run workflow*. Verde = backup feito, restaurado num banco
   vazio, idêntico à origem e criptografado.
5. **Limpeza diária do histórico:** rode `supabase/cron-manutencao.sql` no SQL Editor (precisa do pg_cron).

## O que o backup faz a cada dia

1. Lê tudo numa única transação de leitura (um instante só, mesmo com o app gravando).
2. Restaura num Postgres vazio, com todas as migrations do repositório, e compara linhas e somas de
   verificação de todas as tabelas. Se não ficar idêntico, a execução falha e o GitHub manda e-mail.
3. Avisa (aviso amarelo) se a produção não tiver exatamente as migrations do repositório.
4. Criptografa para a sua chave pública e confere que o arquivo criptografado abre igual (com uma segunda
   chave de uso único, criada e destruída na mesma máquina).
5. Guarda só o arquivo `.age`.

**Logs:** só nomes de tabela, quantidade de linhas e tamanhos. Erros do Postgres aparecem só na primeira linha
(os valores ficam em DETAIL/CONTEXT, que são cortados) e endereços de conexão são escondidos. O secret é
mascarado pelo GitHub. Testado: nenhum conteúdo aparece no log.

**Atenção:** o GitHub desliga tarefas agendadas de repositórios públicos depois de 60 dias sem nenhum commit,
e manda e-mail quando faz isso. Um commit qualquer (ou *Enable workflow*) religa.

## Testar uma restauração completa (a cada 3 meses)

No seu computador, com um Postgres local vazio (qualquer versão 15+) e o age:

1. GitHub → Actions → Backup → a execução mais recente → *Artifacts* → baixe e descompacte o `.zip`.
2. Rode:
   ```
   bash scripts/backup/restore-local.sh nucleo-backup-....tar.gz.age nucleo-backup-chave.txt postgresql://postgres@localhost:5432/teste
   ```
   O banco `teste` é apagado e recebe o backup. O script confere linha a linha (somas de verificação) e
   termina com `ok`. Ele se recusa a rodar contra o Supabase.

## Restaurar

**Um item (histórico, sem backup).** No SQL Editor:

```sql
-- versões de um item (a mais nova primeiro)
select version_id, replaced_at, deleted, left(data::text, 120) as inicio
  from public.records_history
 where user_id = '<id da conta>' and collection = 'notes' and id = '<id do item>'
 order by replaced_at desc;

-- volta essa versão como a edição mais nova (os aparelhos recebem na próxima sincronização)
select public.records_history_restore(<version_id>);
```

**A conta inteira ou o banco inteiro (backup).** Primeiro restaure localmente (seção acima) e confira os dados lá.
Depois, para levar de volta ao Supabase:
- *mesmo projeto, contas existentes:* copie do banco local só as linhas necessárias (por `user_id`, coleção
  e `id`) e grave com `client_updated_at = now()`, para que vençam as versões atuais;
- *projeto novo (o antigo foi perdido):* as contas precisam ser criadas de novo (cadastro), o que gera ids
  novos. O arquivo `accounts.csv` do backup liga o id antigo ao e-mail; troque o `user_id` antigo pelo novo
  antes de gravar. Faça isso com calma, numa transação, e confira as contagens antes do `commit`.

Nunca restaure direto no Supabase sem antes conferir localmente.

## O que o backup não cobre

- Lembretes agendados e aparelhos com notificação (o app recria).
- Senhas das contas de login (o Supabase guarda; num projeto novo, cada pessoa cria a conta de novo).
- O histórico de versões (o backup é o estado de cada dia).
