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

  if (selectedChannelId === null || selectedChannelType === null) {
    return { kind: 'empty' }
  }

  if (selectedChannelType === 'text') {
    return { kind: 'text', channelId: selectedChannelId }
  }

  return { kind: 'voice-preview', channelId: selectedChannelId }
}
