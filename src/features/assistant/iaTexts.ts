/**
 * Texts of the AI switch in Settings. With NÚCLEO IA the AI reads parts of the person's data during a
 * question, so the switch must say so plainly (it is the consent). The legacy text stays only for
 * builds without NÚCLEO IA, where the old interpreter really sends only the sentence.
 */
export const IA_SWITCH_TEXT = {
  label: 'Assistente com IA',
  off: 'Opcional · desligado: nada é enviado',
  on: 'Ligado · durante cada pergunta, trechos dos seus dados vão para a Anthropic',
  title: 'Ligar o Assistente com IA?',
  message:
    'Quando você fizer uma pergunta que os comandos do Assistente não respondem, o NÚCLEO envia à Anthropic (a empresa da IA) a sua pergunta, um resumo curto da conversa e só os dados necessários para responder — por exemplo, os totais e lançamentos de um mês, os compromissos de alguns dias ou as suas metas. Senhas, cofre e acessos nunca são enviados. Os servidores do NÚCLEO não guardam o conteúdo das perguntas, só o custo de cada uma. A IA não cria nem altera nada sem a sua confirmação. Precisa de conexão e tem limite de uso. Você pode desligar quando quiser.',
}

export const LEGACY_SWITCH_TEXT = {
  label: 'Entender frases livres com IA',
  off: 'Opcional · desligado: nada é enviado',
  // unchanged from before NÚCLEO IA (same line on and off)
  on: 'Opcional · desligado: nada é enviado',
  title: 'Usar IA para frases livres?',
  message:
    'Quando os comandos do Assistente não entenderem uma frase, só essa frase e a data de hoje serão enviadas ao servidor do NÚCLEO, que pede à IA da Anthropic para transformá-la em um comando. Nenhum registro seu (tarefas, finanças, alimentação, anotações, senhas) é enviado. Nada é executado sem a sua confirmação. Precisa de conexão e tem limite diário. Você pode desligar quando quiser.',
}
