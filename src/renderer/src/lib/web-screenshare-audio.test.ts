import { describe, expect, it } from 'vitest'

import {
  describeWebScreenShareAudio,
  WEB_SCREENSHARE_AUDIO_LOG_PREFIX
} from './web-screenshare-audio'

// O veredito do áudio de compartilhamento na WEB, provado sem navegador
// nenhum. É por isso que ele é uma função pura: a alternativa seria só
// descobrir o texto errado na frente de dez pessoas numa call.
//
// Cada teste afirma DUAS coisas diferentes:
//  - o `kind` e a `message` — o que a pessoa vê (ou não vê);
//  - o `log` — o dado do experimento do eco (Plano 10-09, §5.4 da pesquisa).
// A segunda é a que costuma apodrecer sem ninguém notar, porque log não quebra
// tela. Daí as asserções sobre os três valores de entrada em TODOS os casos.

describe('describeWebScreenShareAudio', () => {
  it('regra 1: janela sem áudio avisa que no Chrome janela é sempre muda', () => {
    const verdict = describeWebScreenShareAudio({
      hasAudioTrack: false,
      displaySurface: 'window'
    })

    expect(verdict.kind).toBe('no-audio-window')
    // A ÚNICA das cinco que a pessoa precisa ler: sem ela, ela descobre que
    // ninguém ouviu nada só quando alguém reclama.
    expect(verdict.message).not.toBeNull()
    expect(verdict.message).toContain('JANELA')
    expect(verdict.message).toContain('tela inteira')
    expect(verdict.log).toContain('VEREDITO no-audio-window')
    // A causa nomeada: não é defeito do app, é limitação do Chrome/Windows.
    expect(verdict.log).toContain('40947205')
  })

  it('regra 2: sem áudio em superfície que suporta áudio culpa a caixinha, não a pessoa', () => {
    const verdict = describeWebScreenShareAudio({
      hasAudioTrack: false,
      displaySurface: 'browser'
    })

    expect(verdict.kind).toBe('no-audio-declined')
    expect(verdict.message).toContain('SEM SOM')
    expect(verdict.log).toContain('VEREDITO no-audio-declined')
  })

  it('regra 2 também vale para tela inteira: monitor sem áudio NÃO cai na regra 1', () => {
    const verdict = describeWebScreenShareAudio({
      hasAudioTrack: false,
      displaySurface: 'monitor'
    })

    // Se a ordem de avaliação invertesse as regras 1 e 2, este caso viraria
    // "janela é muda" — uma explicação falsa para quem compartilhou a tela
    // inteira e só esqueceu a caixinha.
    expect(verdict.kind).toBe('no-audio-declined')
    expect(verdict.log).toContain('displaySurface=monitor')
  })

  it('regra 3: pedido aceito e aplicado não incomoda ninguém, mas deixa a prova no log', () => {
    const verdict = describeWebScreenShareAudio({
      hasAudioTrack: true,
      displaySurface: 'monitor',
      restrictOwnAudio: true
    })

    expect(verdict.kind).toBe('audio-protected')
    // Não há nada a dizer quando dá certo.
    expect(verdict.message).toBeNull()
    expect(verdict.log).toContain('VEREDITO audio-protected')
    expect(verdict.log).toContain('restrictOwnAudio=true')
    // Tela inteira é o caso que vale para o experimento do eco.
    expect(verdict.log).toContain('TELA INTEIRA')
  })

  it('regra 3 com ABA: o log avisa que ausência de eco aqui não prova nada', () => {
    const verdict = describeWebScreenShareAudio({
      hasAudioTrack: true,
      displaySurface: 'browser',
      restrictOwnAudio: true
    })

    expect(verdict.kind).toBe('audio-protected')
    // Sem esta frase, um experimento feito com ABA seria lido como prova de que
    // a flag funciona — e o desktop seria julgado por um teste que não testou
    // nada, porque aba não tem eco com ou sem flag.
    expect(verdict.log).toContain('ABA')
    expect(verdict.log).toContain('NÃO prova nada')
  })

  it('regra 4: pedido negado avisa a pessoa sobre eco, com a saída disponível', () => {
    const verdict = describeWebScreenShareAudio({
      hasAudioTrack: true,
      displaySurface: 'monitor',
      restrictOwnAudio: false
    })

    expect(verdict.kind).toBe('audio-unprotected')
    expect(verdict.message).toContain('eco')
    expect(verdict.message).toContain('ABA')
    expect(verdict.log).toContain('VEREDITO audio-unprotected')
    // A distinção que o experimento precisa: reconhecida e NEGADA.
    expect(verdict.log).toContain('NÃO aplicado')
    expect(verdict.log).toContain('restrictOwnAudio=false')
  })

  it('regra 5: navegador que não reporta a propriedade nomeia a versão exigida', () => {
    const verdict = describeWebScreenShareAudio({
      hasAudioTrack: true,
      displaySurface: 'monitor'
    })

    expect(verdict.kind).toBe('audio-unknown-support')
    expect(verdict.message).toContain('141')
    expect(verdict.log).toContain('VEREDITO audio-unknown-support')
    expect(verdict.log).toContain('não reporta `restrictOwnAudio`')
    expect(verdict.log).toContain('>= 141')
    // O terceiro resultado da §5.4: a base de comparação está errada.
    expect(verdict.log).toContain('invalida a base de comparação')
    expect(verdict.log).toContain('restrictOwnAudio=undefined')
  })

  it('todos os cinco vereditos carregam os três valores de entrada e o mesmo prefixo', () => {
    const casos: Parameters<typeof describeWebScreenShareAudio>[0][] = [
      { hasAudioTrack: false, displaySurface: 'window' },
      { hasAudioTrack: false, displaySurface: 'monitor' },
      { hasAudioTrack: true, displaySurface: 'monitor', restrictOwnAudio: true },
      { hasAudioTrack: true, displaySurface: 'monitor', restrictOwnAudio: false },
      { hasAudioTrack: true, displaySurface: undefined }
    ]

    const kinds = casos.map((caso) => describeWebScreenShareAudio(caso).kind)
    expect(new Set(kinds).size).toBe(5)

    for (const caso of casos) {
      const { log } = describeWebScreenShareAudio(caso)
      // O prefixo é o que se procura no console. Se ele mudar, o roteiro do
      // checkpoint do Plano 10-09 ("procure por VEREDITO") deixa de funcionar.
      expect(log.startsWith(WEB_SCREENSHARE_AUDIO_LOG_PREFIX)).toBe(true)
      expect(log).toContain('VEREDITO')
      expect(log).toContain(`hasAudioTrack=${String(caso.hasAudioTrack)}`)
      expect(log).toContain(`displaySurface=${caso.displaySurface ?? 'undefined'}`)
      expect(log).toContain(
        `restrictOwnAudio=${caso.restrictOwnAudio === undefined ? 'undefined' : String(caso.restrictOwnAudio)}`
      )
    }
  })
})
