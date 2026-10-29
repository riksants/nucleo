# Sistema visual do NÚCLEO

Identidade compartilhada com o site da RIMERA (rimera.digital): preto quente, texto cor de papel, um único
vermelhão e a fonte Geist. Organização de app de banco: cada tela abre com uma faixa vermelhão (cabeçalho), o
conteúdo fica em superfícies neutras abaixo, e o resto do app mora num menu lateral (☰).
Tudo mora em `src/index.css` (tokens e utilitários) e nos componentes de `src/ui/`; telas usam os tokens, nunca
cores soltas.

## Cores (tokens em `src/index.css`)

| Papel | Escuro | Claro | Uso |
|---|---|---|---|
| `bg` | #0a0a0b | #efede8 | fundo da página |
| `surface` / `sheet` | #1c1c1f / #212124 | #fbfaf7 | cartões (≥ 1,15:1 contra o fundo) / folhas que sobem |
| `raised` / `elevated` | #262629 / #2e2e32 | #e7e4dd / #ffffff | campos / camada acima |
| `ink` / `soft` / `faint` | #edebe6 / #b5b2ab / #9b9993 | #0a0a0b / #4a4843 / #615e58 | texto (todos ≥ 4,5:1) |
| `accent` | #ff5b2e | #ff5b2e | **ação** e estado "ligado" |
| `brand` | #ff5b2e | #ff5b2e | fixo: faixa do cabeçalho, barra de status, peça da logo |
| `accent-hi` | #ff6b3d | #b8350c | vermelhão como texto (links de ação) |
| `income` / `expense` / `warn` / `goal` | verde / rosa-vermelho / âmbar / ciano | versões escuras | significado, nunca decoração |

Regras:
- **Faixa vermelhão (`band`)** no topo de toda tela: menu ☰ (seções) ou ‹ Voltar (telas internas), título,
  ações da tela. Em Início ela leva saudação, saldo e as ações rápidas (discos brancos com ícone vermelhão).
  Dentro da faixa os tokens são reapontados para carvão sobre vermelhão, então botões e links comuns funcionam
  sem estilo próprio. A barra de status (iPhone) é vermelhão nos dois temas; ao rolar, uma barra compacta
  vermelhão com o nome da tela fica no topo.
- **Vermelhão = agir.** Botão principal, "+", texto de ação, setas (›) e links de seção, interruptor ligado.
- **Onde você está = vermelhão suave**: aba da barra inferior em vermelhão com um traço no topo; segmento e
  chip escolhidos com fundo vermelhão translúcido e texto `accent-hi`; sublinhado das abas em vermelhão; item
  atual do menu com fundo suave e barra à esquerda. Na faixa, o segmento escolhido é uma pílula carvão.
- Texto sobre o vermelhão é sempre `coal` (#0a0a0b, 6,4:1), nunca branco (3,1:1). A logo nunca fica direto no
  vermelhão: vai no quadrado carvão (`LogoTile`), igual ao ícone do app.
- Despesa (rosa-vermelho) e aviso (âmbar) ficam longe do vermelhão de ação; valores levam sinal e rótulo.
- Ícones de lista e de estado vazio usam `icon-tile` (fundo vermelhão translúcido, traço vermelhão). No menu,
  ícones de traço em tom neutro e seta vermelhão. Selo "em andamento/ativo" é neutro com o quadradinho
  vermelhão (`Badge tone="accent"`).
- Superfícies se separam por um degrau de tom e uma linha fina (no escuro, uma luz fina no topo do cartão); no
  claro, cartões têm sombra curta e suave. Evitar cartão dentro de cartão.
- Cartão do saldo (Financeiro): superfície neutra que sobe metade sobre a faixa, traço vermelhão curto no topo,
  quadradinho ao lado de "Saldo", Adicionar (vermelhão) e Retirar (contorno) separados por uma linha fina.

## Tipografia

Uma família: Geist (variável) e Geist Mono para rótulos estruturais (`label-mono`).
- Títulos de tela (na faixa): 30 px (40 px no computador), peso 600, espaçamento −0,04em.
- Títulos de seção: 20 px, 600, −0,03em; a ação à direita em `accent-hi` com seta. Corpo: 15–16 px, 400/500.
- O saldo grande (`display-num`): 600, −0,042em, números tabulares. Os outros valores usam `num`.
- Rótulos mono só para nomes de grupo (barra lateral, construtor de regras), nunca acima de um título.
- Pesos: 400, 500 e 600. Sem 700/800.

## Forma

- Botões: pílula. Principal = vermelhão com texto `coal`; secundário = contorno fino (`ring-line-strong`).
- Raios: cartão 18 px (`--radius-card`), campo 14 px (`--radius-field`), folha 24 px, pílulas totalmente redondas.
- Marca: o "N" (`src/app/logoMark.ts`); a peça clara segue a cor do texto, a outra é sempre `brand`. Na faixa
  e no menu, o "N" branco e vermelhão no quadrado carvão + "NÚCLEO" em caixa alta espaçada.

## Navegação

- Celular: barra inferior com Início + até 3 seções (padrão Financeiro, Projetos, Tarefas). Não há mais "Mais".
- Menu lateral (`src/app/SideMenu.tsx`): abre pela esquerda sobre um escurecido; perfil na faixa do topo, busca,
  grupos Dia a dia · Dinheiro · Trabalho · Planejamento · Guardados (só seções ligadas e fora da barra),
  Automações e Conta e preferências. Fecha no X, tocando fora, Esc, deslizando para a esquerda ou ao escolher.
  Links antigos para `#/more` abrem Início com o menu aberto.
- Seções têm ☰; telas internas (Configurações, Busca, Conta, Automações, Resumo do mês…) têm ‹ Voltar.
- Computador: barra lateral fixa com a mesma organização.
- Buscar (`src/features/search/`): procura seções, telas, configurações e ações (`catalog.ts`) e os registros
  das seções ligadas (`records.ts`), no aparelho, sem servidor nem IA paga. Ignora acentos, plural e palavras
  como "quero"/"minhas", perdoa erros pequenos e entende intenção ("adicionar cliente" → Novo cliente;
  "quanto tenho para receber?" → o valor). Grupos: Ir para · Fazer agora · registros por seção. Senhas, segredos
  do cofre e notas de acessos nunca entram no índice. Ações abrem o "+" da tela com `?novo=1` (Financeiro:
  `?novo=in|out`). Enter abre o primeiro resultado.

## Telas reformuladas (2026-10-29)

- Cabeçalho rico (`PageHeader rich`): opcional, só nas telas reformuladas (Hoje, Tarefas, Agenda, Rotina, Hábitos,
  Recorrentes, Alimentação, Caixa de entrada, Assinaturas, Portfólio, Anotações). Linha pequena em caixa alta acima
  do título, título 32/42 px, faixa de números (`stats`, fundo carvão 6%) e o ícone da seção em traço fino a 6%
  no canto (só no celular). Luz suave na faixa (`band-depth`) e, no celular, a página "sobe" sobre a faixa com
  borda arredondada. Entrada: 320 ms, 6 px, respeita "reduzir movimento". As outras telas usam o cabeçalho simples.
- Início: data em caixa alta, saudação, resumo do dia (só o que existe), saldo com selo do mês e as ações num
  "dock" que fica metade sobre a faixa.
- Linha do dia (`src/features/daily/DayParts.tsx`): compartilhada por Hoje, Agenda e Rotina. Estados derivados do
  relógio (`src/core/timeState.ts`): Programado → Em horário → Aguardando confirmação; Concluído e Não realizado
  só pela pessoa. O relógio nunca marca nada como feito. "Concluí / Não fiz / Depois" (Depois = 1 h, por aparelho).
- Faixas de dias (7 colunas, dia de hoje com contorno, escolhido em vermelhão): Agenda, Rotina, Alimentação.
- Campos de data/hora encolhem como qualquer campo (correção do Safari do iPhone em `index.css`); grades da
  página usam `grid-cols-[minmax(0,1fr)]` no celular para nunca empurrar a largura.

## Movimento

- Curva da casa: expo ease-out `cubic-bezier(0.16, 1, 0.3, 1)` (`--ease-out-soft` no CSS, `EASE_OUT_SOFT` em
  `src/lib/motion.ts`). Interface abaixo de 300 ms.
- Toque: `press` (escala 0,97 em 100 ms ao pressionar). Linhas e cartões: `tap` (tom por baixo).
- Indicadores (aba, segmento, item da barra lateral com o quadradinho) deslizam com mola sem rebote.
- Menu lateral: entra em 320 ms (expo ease-out), sai em 220 ms (ease-in), segue o dedo ao deslizar.
- Folhas: mola sem rebote, arrastar para fechar com elástico no limite; botão Fechar sempre visível. Avisos entram e saem por baixo,
  saindo mais rápido do que entram. Troca de tema: esmaecimento de 220 ms.
- Abertura: "N" parado → cápsula vermelhão sobe e alarga → sai pelo topo (`index.html`, `src/app/opening.ts`).
- "Reduzir movimento": só opacidade, sem deslocamento. "Reduzir transparência": barras sólidas.
- Não animar: navegação frequente, atalhos de teclado, dados sendo lidos (o saldo não inclina nem brilha).

## Ícones do app

Gerados do traçado do "N" (`public/`): `icon-192/512.png` (enquadramento da arte), `icon-maskable-512.png`
(o "N" a 82%, dentro do círculo seguro do Android), `apple-touch-icon.png` (180), `favicon.svg` e
`favicon.ico` (16/32/48, quadrado arredondado com o "N" maior). Versão `?v=4` nos links.
