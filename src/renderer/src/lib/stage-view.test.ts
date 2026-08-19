import { describe, expect, it } from 'vitest'

import { resolveMainView, type MainViewInput } from './stage-view'

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

  // Só alcançável por estado inconsistente (o provider liga `viewingStage` ao
  // entrar na call), mas a regra tem que ser total: sem `viewingStage`, o canal
  // conectado é tratado como qualquer canal de voz selecionado.
  it('o próprio canal conectado selecionado, sem viewingStage → prévia', () => {
    expect(
      resolveMainView(
        input({ joinedVoiceChannelId: VOZ, selectedChannelId: VOZ, selectedChannelType: 'voice' })
      )
    ).toEqual({ kind: 'voice-preview', channelId: VOZ })
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
