import { describe, expect, it } from 'vitest'

import {
  highlightedChannelId,
  resolveMainView,
  viewingStageAfterJoin,
  voiceChannelClickAction,
  watchStreamAction,
  type MainViewInput
} from './stage-view'

// Função pura, sem DOM: roda no `edge-runtime` global do projeto, sem
// `// @vitest-environment jsdom` e sem `@/test/jsdom-setup`.
const VOZ = 'ch_voz'
const VOZ_OUTRO = 'ch_voz_outro'
const TEXTO = 'ch_texto'

// Base "fora de call, nada selecionado" — cada teste sobrescreve só o que
// interessa, para que a combinação sob teste fique legível na própria chamada.
function input(overrides: Partial<MainViewInput> = {}): MainViewInput {
  return {
    joinedVoiceChannelId: null,
    viewingStage: false,
    selectedChannelId: null,
    selectedChannelType: null,
    ...overrides
  }
}

describe('resolveMainView — fora de call', () => {
  it('nada selecionado → vazio', () => {
    expect(resolveMainView(input())).toEqual({ kind: 'empty' })
  })

  it('canal de texto selecionado → texto', () => {
    expect(
      resolveMainView(input({ selectedChannelId: TEXTO, selectedChannelType: 'text' }))
    ).toEqual({ kind: 'text', channelId: TEXTO })
  })

  it('canal de voz selecionado → prévia (ver quem está lá sem entrar)', () => {
    expect(
      resolveMainView(input({ selectedChannelId: VOZ, selectedChannelType: 'voice' }))
    ).toEqual({ kind: 'voice-preview', channelId: VOZ })
  })

  it('canal selecionado mas ainda carregando (tipo null) → vazio', () => {
    expect(resolveMainView(input({ selectedChannelId: TEXTO, selectedChannelType: null }))).toEqual(
      {
        kind: 'empty'
      }
    )
  })

  // Estado inconsistente: `viewingStage` sobrevivendo a uma desconexão. Nunca
  // pode produzir palco — não há canal para o palco mostrar.
  it('viewingStage=true sem call → NUNCA devolve palco', () => {
    expect(resolveMainView(input({ viewingStage: true }))).toEqual({ kind: 'empty' })

    expect(
      resolveMainView(
        input({ viewingStage: true, selectedChannelId: TEXTO, selectedChannelType: 'text' })
      )
    ).toEqual({ kind: 'text', channelId: TEXTO })

    expect(
      resolveMainView(
        input({ viewingStage: true, selectedChannelId: VOZ, selectedChannelType: 'voice' })
      )
    ).toEqual({ kind: 'voice-preview', channelId: VOZ })
  })
})

describe('resolveMainView — em call, olhando o palco', () => {
  it('canal de voz conectado também selecionado → palco', () => {
    expect(
      resolveMainView(
        input({
          joinedVoiceChannelId: VOZ,
          viewingStage: true,
          selectedChannelId: VOZ,
          selectedChannelType: 'voice'
        })
      )
    ).toEqual({ kind: 'stage', channelId: VOZ })
  })

  // O caso que faz "voltar para a call" funcionar: o palco ganha da seleção.
  it('canal de TEXTO selecionado → palco do canal conectado, não o texto', () => {
    expect(
      resolveMainView(
        input({
          joinedVoiceChannelId: VOZ,
          viewingStage: true,
          selectedChannelId: TEXTO,
          selectedChannelType: 'text'
        })
      )
    ).toEqual({ kind: 'stage', channelId: VOZ })
  })

  it('OUTRO canal de voz selecionado → palco do conectado, nunca prévia do outro', () => {
    expect(
      resolveMainView(
        input({
          joinedVoiceChannelId: VOZ,
          viewingStage: true,
          selectedChannelId: VOZ_OUTRO,
          selectedChannelType: 'voice'
        })
      )
    ).toEqual({ kind: 'stage', channelId: VOZ })
  })

  it('nenhum canal selecionado → palco', () => {
    expect(resolveMainView(input({ joinedVoiceChannelId: VOZ, viewingStage: true }))).toEqual({
      kind: 'stage',
      channelId: VOZ
    })
  })
})

describe('resolveMainView — em call, olhando outra coisa (a call continua)', () => {
  // A promessa central do plano vista do lado da função pura: com a call de pé
  // (`joinedVoiceChannelId` preservado) a área principal mostra o texto.
  it('canal de texto selecionado → texto, com a call ainda ativa', () => {
    const state = input({
      joinedVoiceChannelId: VOZ,
      viewingStage: false,
      selectedChannelId: TEXTO,
      selectedChannelType: 'text'
    })

    expect(resolveMainView(state)).toEqual({ kind: 'text', channelId: TEXTO })
    expect(state.joinedVoiceChannelId).toBe(VOZ)
  })

  it('outro canal de voz selecionado → prévia do outro canal', () => {
    expect(
      resolveMainView(
        input({
          joinedVoiceChannelId: VOZ,
          selectedChannelId: VOZ_OUTRO,
          selectedChannelType: 'voice'
        })
      )
    ).toEqual({ kind: 'voice-preview', channelId: VOZ_OUTRO })
  })

  // Voltar/Avançar do histórico reaplica o canal com `viewingStage=false`; uma
  // "prévia" da própria call não tem palco nem controles.
  it('voltar para o canal de voz em que estou mostra o palco', () => {
    expect(
      resolveMainView(
        input({ joinedVoiceChannelId: VOZ, selectedChannelId: VOZ, selectedChannelType: 'voice' })
      )
    ).toEqual({ kind: 'stage', channelId: VOZ })
  })

  it('nada selecionado → vazio, mesmo em call', () => {
    expect(resolveMainView(input({ joinedVoiceChannelId: VOZ }))).toEqual({ kind: 'empty' })
  })
})

describe('resolveMainView — tabela de verdade completa', () => {
  // As 3 dimensões que importam cruzadas: em call × viewingStage × tipo do
  // canal selecionado. Serve de referência rápida e falha alto se alguém
  // reordenar as regras da função.
  const casos: Array<{
    emCall: boolean
    viewingStage: boolean
    tipo: 'text' | 'voice' | null
    esperado: string
  }> = [
    { emCall: false, viewingStage: false, tipo: null, esperado: 'empty' },
    { emCall: false, viewingStage: false, tipo: 'text', esperado: 'text' },
    { emCall: false, viewingStage: false, tipo: 'voice', esperado: 'voice-preview' },
    { emCall: false, viewingStage: true, tipo: null, esperado: 'empty' },
    { emCall: false, viewingStage: true, tipo: 'text', esperado: 'text' },
    { emCall: false, viewingStage: true, tipo: 'voice', esperado: 'voice-preview' },
    { emCall: true, viewingStage: false, tipo: null, esperado: 'empty' },
    { emCall: true, viewingStage: false, tipo: 'text', esperado: 'text' },
    { emCall: true, viewingStage: false, tipo: 'voice', esperado: 'voice-preview' },
    { emCall: true, viewingStage: true, tipo: null, esperado: 'stage' },
    { emCall: true, viewingStage: true, tipo: 'text', esperado: 'stage' },
    { emCall: true, viewingStage: true, tipo: 'voice', esperado: 'stage' }
  ]

  for (const caso of casos) {
    const rotulo = `emCall=${caso.emCall} viewingStage=${caso.viewingStage} tipo=${caso.tipo}`
    it(`${rotulo} → ${caso.esperado}`, () => {
      const view = resolveMainView(
        input({
          joinedVoiceChannelId: caso.emCall ? VOZ : null,
          viewingStage: caso.viewingStage,
          selectedChannelId: caso.tipo === null ? null : caso.tipo === 'text' ? TEXTO : VOZ_OUTRO,
          selectedChannelType: caso.tipo
        })
      )
      expect(view.kind).toBe(caso.esperado)
    })
  }
})

// Follow-up 1 da rodada 1 (pedido do Leo depois do teste no Windows): entrar
// numa call NÃO leva para a tela da call. A área do meio fica onde estava; quem
// leva para o palco é clicar de novo no canal em que você já está, o cartão
// "Voz conectada" ou o AO VIVO.
describe('clicar num canal de voz', () => {
  it('canal em que NÃO estou → entra', () => {
    expect(voiceChannelClickAction({ clicked: VOZ, joinedVoiceChannelId: null })).toBe('join')
    expect(voiceChannelClickAction({ clicked: VOZ_OUTRO, joinedVoiceChannelId: VOZ })).toBe('join')
  })

  it('canal em que JÁ estou → abre a tela da call', () => {
    expect(voiceChannelClickAction({ clicked: VOZ, joinedVoiceChannelId: VOZ })).toBe('show-stage')
  })
})

describe('viewingStageAfterJoin', () => {
  it('entrar de fora da call não liga o palco', () => {
    expect(viewingStageAfterJoin({ viewingStage: false, from: null, to: VOZ })).toBe(false)
  })

  it('entrar de fora da call desliga um palco velho que tenha sobrado', () => {
    expect(viewingStageAfterJoin({ viewingStage: true, from: null, to: VOZ })).toBe(false)
  })

  it('sair da call devolve a área do meio para o texto', () => {
    expect(viewingStageAfterJoin({ viewingStage: true, from: VOZ, to: null })).toBe(false)
    expect(viewingStageAfterJoin({ viewingStage: false, from: VOZ, to: null })).toBe(false)
  })

  it('trocar de call mantém o que a área do meio mostrava', () => {
    expect(viewingStageAfterJoin({ viewingStage: false, from: VOZ, to: VOZ_OUTRO })).toBe(false)
    expect(viewingStageAfterJoin({ viewingStage: true, from: VOZ, to: VOZ_OUTRO })).toBe(true)
  })

  // O caminho inteiro, como o Leo descreveu: chat de texto aberto, clica num
  // canal de voz de fora → entra e continua no chat; clica de novo no mesmo
  // canal → tela da call.
  it('chat aberto + entrar num canal de voz → continua no chat; clicar de novo → palco', () => {
    const antes = input({ selectedChannelId: TEXTO, selectedChannelType: 'text' })
    expect(voiceChannelClickAction({ clicked: VOZ, joinedVoiceChannelId: null })).toBe('join')

    const depoisDeEntrar = input({
      ...antes,
      joinedVoiceChannelId: VOZ,
      viewingStage: viewingStageAfterJoin({ viewingStage: false, from: null, to: VOZ })
    })
    expect(resolveMainView(depoisDeEntrar)).toEqual({ kind: 'text', channelId: TEXTO })

    expect(voiceChannelClickAction({ clicked: VOZ, joinedVoiceChannelId: VOZ })).toBe('show-stage')
    expect(resolveMainView({ ...depoisDeEntrar, viewingStage: true })).toEqual({
      kind: 'stage',
      channelId: VOZ
    })
  })
})

describe('clicar no AO VIVO da lista de canais', () => {
  it('a própria transmissão só abre a tela da call', () => {
    expect(watchStreamAction({ isSelf: true, isJoinedHere: true })).toBe('show-stage')
    expect(watchStreamAction({ isSelf: true, isJoinedHere: false })).toBe('show-stage')
  })

  it('transmissão de outra pessoa na call em que estou → abre e assiste', () => {
    expect(watchStreamAction({ isSelf: false, isJoinedHere: true })).toBe('watch')
  })

  it('transmissão de outra pessoa numa call em que NÃO estou → entra, abre e assiste', () => {
    expect(watchStreamAction({ isSelf: false, isJoinedHere: false })).toBe('join-and-watch')
  })
})

describe('highlightedChannelId — o que a lista destaca segue a área do meio', () => {
  it('tela da call → o canal de voz conectado', () => {
    expect(highlightedChannelId({ kind: 'stage', channelId: VOZ })).toBe(VOZ)
  })

  it('chat de texto → o canal de texto', () => {
    expect(highlightedChannelId({ kind: 'text', channelId: TEXTO })).toBe(TEXTO)
  })

  it('prévia de voz → o canal de voz da prévia', () => {
    expect(highlightedChannelId({ kind: 'voice-preview', channelId: VOZ_OUTRO })).toBe(VOZ_OUTRO)
  })

  it('vazio → nada', () => {
    expect(highlightedChannelId({ kind: 'empty' })).toBeNull()
  })

  it('em call com texto selecionado e a tela da call aberta, destaca a call e não o texto', () => {
    const view = resolveMainView({
      joinedVoiceChannelId: VOZ,
      viewingStage: true,
      selectedChannelId: TEXTO,
      selectedChannelType: 'text'
    })
    expect(highlightedChannelId(view)).toBe(VOZ)
  })
})
