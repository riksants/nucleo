# Sistema visual do NÚCLEO

Identidade compartilhada com o site da RIMERA (rimera.digital): preto quente, texto cor de papel, um único
vermelhão e a fonte Geist. Adaptada para um app de uso diário: a mesma linguagem, sem efeitos de landing page.
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
| `accent-hi` | #ff6b3d | #b8350c | vermelhão como texto (links de ação) |
| `income` / `expense` / `warn` / `goal` | verde / rosa-vermelho / âmbar / ciano | versões escuras | significado, nunca decoração |

Regras:
- **Vermelhão = agir.** Botão principal, "+", texto de ação, interruptor ligado, tarefa feita, o quadradinho da marca.
- **Onde você está = pílula clara** (papel no escuro, tinta no claro): aba ativa, segmento escolhido, sublinhado
  das abas, opção selecionada. Não usa vermelhão.
- Texto sobre o vermelhão é sempre `coal` (#0a0a0b, 6,4:1), nunca branco (3,1:1).
- Despesa (rosa-vermelho) e aviso (âmbar) ficam longe do vermelhão de ação; valores levam sinal e rótulo.
- Ícones de lista e de estado vazio usam `icon-tile` (graphite). Selo "em andamento/ativo" é neutro com o
  quadradinho vermelhão (`Badge tone="accent"`).
- Superfícies se separam por um degrau de tom e uma linha fina (no escuro, uma luz fina no topo do cartão), sem
  sombras projetadas (só folhas e o "+" têm sombra).

## Tipografia

Uma família: Geist (variável) e Geist Mono para rótulos estruturais (`label-mono`).
- Títulos de tela: 32 px (40 px no computador), peso 600, espaçamento −0,045em.
- Títulos de seção: 19 px, 600, −0,03em. Corpo: 15–16 px, 400/500.
- O saldo grande (`display-num`): 600, −0,042em, números tabulares. Os outros valores usam `num`.
- Rótulos mono só para nomes de grupo (barra lateral, construtor de regras), nunca acima de um título.
- Pesos: 400, 500 e 600. Sem 700/800.

## Forma

- Botões: pílula. Principal = vermelhão com texto `coal`; secundário = contorno fino (`ring-line-strong`).
- Raios: cartão 18 px (`--radius-card`), campo 14 px (`--radius-field`), folha 24 px, pílulas totalmente redondas.
- Marca: o "N" (`src/app/logoMark.ts`); a peça clara segue a cor do texto, a outra é o vermelhão. Na barra
  lateral, o "N" + "NÚCLEO" em caixa alta espaçada, como a marca RIMERA.

## Movimento

- Curva da casa: expo ease-out `cubic-bezier(0.16, 1, 0.3, 1)` (`--ease-out-soft` no CSS, `EASE_OUT_SOFT` em
  `src/lib/motion.ts`). Interface abaixo de 300 ms.
- Toque: `press` (escala 0,97 em 100 ms ao pressionar). Linhas e cartões: `tap` (tom por baixo).
- Indicadores (aba, segmento, item da barra lateral com o quadradinho) deslizam com mola sem rebote.
- Folhas: mola sem rebote, arrastar para fechar com elástico no limite. Avisos entram e saem por baixo,
  saindo mais rápido do que entram. Troca de tema: esmaecimento de 220 ms.
- Abertura: "N" parado → cápsula vermelhão sobe e alarga → sai pelo topo (`index.html`, `src/app/opening.ts`).
- "Reduzir movimento": só opacidade, sem deslocamento. "Reduzir transparência": barras sólidas.
- Não animar: navegação frequente, atalhos de teclado, dados sendo lidos (o saldo não inclina nem brilha).

## Ícones do app

Gerados do traçado do "N" (`public/`): `icon-192/512.png` (enquadramento da arte), `icon-maskable-512.png`
(o "N" a 82%, dentro do círculo seguro do Android), `apple-touch-icon.png` (180), `favicon.svg` e
`favicon.ico` (16/32/48, quadrado arredondado com o "N" maior). Versão `?v=4` nos links.
