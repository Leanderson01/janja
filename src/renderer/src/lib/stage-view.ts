/**
 * Palco da call (Plano 08.5-03) — QUAL região a área principal mostra.
 *
 * Até aqui `ConversationArea` decidia isso com um ternário aninhado sobre
 * `selectedChannelId`, e por isso olhar um canal de texto durante uma call era
 * impossível: selecionar o canal de texto era a única forma de sair da tela da
 * call, e voltar para o canal de voz era o mesmo gesto que desconectava. A
 * decisão vira uma função pura aqui porque é ela — e não o layout — que carrega
 * a regra que o usuário percebe.
 *
 * O módulo é PURO e genérico sobre o tipo do id (mesmo espírito de
 * `screenshare-tracks.ts`): sem React, sem Convex, sem DOM. O ambiente de teste
 * padrão do projeto é `edge-runtime`, e a tabela de verdade em
 * `stage-view.test.ts` roda nele sem nenhum setup.
 *
 * A informação que NÃO dá para derivar do resto — e que motiva o booleano
 * `viewingStage` no `SelectionContext` — é: estando numa call com um canal de
 * texto selecionado, o usuário quer ver o texto (acabou de clicar nele) ou o
 * palco (acabou de pedir para voltar)? `selectedChannelId === joinedVoiceChannelId`
 * não distingue "vendo o texto durante a call" de "não estou em call nenhuma".
 */

export type MainView<TChannelId extends string = string> =
  /** A call em que EU estou. Ganha da seleção — ver regra 1. */
  | { kind: 'stage'; channelId: TChannelId }
  /** Canal de texto: histórico + composer. A call, se houver, continua de pé. */
  | { kind: 'text'; channelId: TChannelId }
  /** Canal de voz onde NÃO estou: prévia de quem está lá, sem entrar. */
  | { kind: 'voice-preview'; channelId: TChannelId }
  /** Nada selecionado, ou canal ainda carregando. */
  | { kind: 'empty' }

export type MainViewInput<TChannelId extends string = string> = {
  /** Intenção de estar numa call (`SelectionContext`), não estado de conexão. */
  joinedVoiceChannelId: TChannelId | null
  /** O usuário pediu para ver o palco — ver as três transições no provider. */
  viewingStage: boolean
  selectedChannelId: TChannelId | null
  /** `null` = canal ainda carregando, inexistente ou nenhum selecionado. */
  selectedChannelType: 'text' | 'voice' | null
}

/**
 * Regras, nesta ordem — a ordem É a regra:
 *
 * 1. Em call + `viewingStage` → palco do canal CONECTADO, mesmo com outro canal
 *    selecionado. É isto que faz "voltar para a call" funcionar: sem a
 *    precedência, clicar em Conectado no rodapé não teria efeito visível
 *    enquanto um canal de texto estivesse selecionado.
 *    Também vale quando o canal selecionado É o canal conectado, mesmo com
 *    `viewingStage === false` (ex.: Voltar no histórico) — nunca há prévia da
 *    própria call.
 * 2. Canal de texto selecionado → texto. Note que este caminho é alcançável COM
 *    uma call ativa (`viewingStage === false`): é a call continuando enquanto se
 *    lê o texto, que é o ponto inteiro do plano.
 * 3. Canal de voz selecionado → prévia (ver quem está lá sem entrar).
 *    Comportamento que já existia antes do palco e não pode regredir.
 * 4. Resto → vazio.
 *
 * `joinedVoiceChannelId !== null` na regra 1 não é redundante com `viewingStage`:
 * um `viewingStage === true` sobrevivente a uma desconexão (estado inconsistente)
 * jamais pode produzir um palco sem canal.
 */
export function resolveMainView<TChannelId extends string>(
  input: MainViewInput<TChannelId>
): MainView<TChannelId> {
  const { joinedVoiceChannelId, viewingStage, selectedChannelId, selectedChannelType } = input

  if (joinedVoiceChannelId !== null && viewingStage) {
    return { kind: 'stage', channelId: joinedVoiceChannelId }
  }

  // Selecionar o canal de voz em que EU estou sempre mostra o palco: uma
  // "prévia" da própria call não tem controles nem vídeo (ex.: Voltar do
  // histórico de navegação reaplica o canal com `viewingStage=false`).
  if (joinedVoiceChannelId !== null && selectedChannelId === joinedVoiceChannelId) {
    return { kind: 'stage', channelId: joinedVoiceChannelId }
  }

  if (selectedChannelId === null || selectedChannelType === null) {
    return { kind: 'empty' }
  }

  if (selectedChannelType === 'text') {
    return { kind: 'text', channelId: selectedChannelId }
  }

  return { kind: 'voice-preview', channelId: selectedChannelId }
}

/**
 * Follow-up 1 da rodada 1 (pedido do Leo, teste no Windows): clicar num canal de
 * voz NÃO leva mais para a tela da call, como no Discord.
 *
 * - canal em que NÃO estou → `'join'`: entra na call e a área do meio continua
 *   no que estava (o chat aberto). A seleção da lista também não muda.
 * - canal em que JÁ estou → `'show-stage'`: é o gesto de abrir a tela da call
 *   (Plano 08.5-03). Nunca desconecta.
 */
export function voiceChannelClickAction<TChannelId extends string>(input: {
  clicked: TChannelId
  joinedVoiceChannelId: TChannelId | null
}): 'join' | 'show-stage' {
  return input.clicked === input.joinedVoiceChannelId ? 'show-stage' : 'join'
}

/**
 * O valor de `viewingStage` quando a call muda (`from` → `to`). Quem liga o palco
 * é só `showStage()` explícito — entrar não liga mais.
 *
 * - sair (`to === null`) → `false`: a área do meio volta para o texto;
 * - entrar de fora (`from === null`) → `false`: a área do meio fica onde estava,
 *   e fora de call ela não estava no palco (um `true` sobrando é estado velho);
 * - trocar de uma call para outra → mantém: quem olhava a call passa a olhar a
 *   nova, quem lia um canal de texto continua lendo.
 */
export function viewingStageAfterJoin<TChannelId extends string>(input: {
  viewingStage: boolean
  from: TChannelId | null
  to: TChannelId | null
}): boolean {
  if (input.to === null || input.from === null) return false
  return input.viewingStage
}

/**
 * Clique no AO VIVO de quem transmite, na lista de canais:
 *
 * - a própria transmissão → `'show-stage'`: só abre a tela da call (a própria
 *   tela aparece sem clique);
 * - de outra pessoa, na call em que estou → `'watch'`: abre a tela da call e
 *   assiste;
 * - de outra pessoa, numa call em que NÃO estou → `'join-and-watch'`: entra
 *   (como o Discord faz para assistir), abre a tela da call e assiste assim que
 *   a transmissão chegar.
 */
export function watchStreamAction(input: {
  isSelf: boolean
  isJoinedHere: boolean
}): 'show-stage' | 'watch' | 'join-and-watch' {
  if (input.isSelf) return 'show-stage'
  return input.isJoinedHere ? 'watch' : 'join-and-watch'
}
