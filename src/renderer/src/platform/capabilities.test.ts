import { describe, it, expect } from 'vitest'
// As DUAS implementações, por caminho relativo explícito e de propósito:
// `@platform` resolveria só UM lado (o Electron, no vitest.config.ts), e o que
// este arquivo existe para provar é justamente a relação entre os dois.
import { capabilities as electron } from './electron/capabilities'
import { capabilities as web } from './web/capabilities'

describe('capabilities dos dois alvos', () => {
  it('declara alvos e sentinelas diferentes', () => {
    expect(electron.target).toBe('electron')
    expect(web.target).toBe('web')
    expect(electron.target).not.toBe(web.target)

    expect(electron.buildTargetSentinel).toBe('hydra-platform:electron')
    expect(web.buildTargetSentinel).toBe('hydra-platform:web')
    // Se os dois sentinelas fossem iguais, `scripts/verify-web-bundle.mjs`
    // não conseguiria distinguir qual lado entrou no artefato — as afirmações
    // 1 e 2 dele passariam a ser a mesma pergunta.
    expect(electron.buildTargetSentinel).not.toBe(web.buildTargetSentinel)
  })

  it('só o Electron tem push-to-talk global', () => {
    expect(electron.globalPushToTalk).toBe(true)
    // Nenhuma API de navegador captura tecla fora de foco. Se este valor virar
    // `true`, a UI passa a prometer algo que não existe.
    expect(web.globalPushToTalk).toBe(false)
  })

  it('o áudio de compartilhamento da web vem da superfície do navegador', () => {
    expect(web.screenShareAudio).toBe('browser-surface')
    expect(electron.screenShareAudio).toBe('process-exclude')
  })

  it('as duas implementações têm exatamente o mesmo conjunto de chaves', () => {
    // O TypeScript pega "alguém acrescentou um campo num lado só" no
    // compilador — mas só se o campo for obrigatório no contrato. Um campo
    // EXTRA num dos lados (que o excesso de propriedades não flagra quando o
    // objeto passa por uma variável) chegaria em runtime sem ninguém ver.
    // Comparar os conjuntos ordenados é o que fecha essa fresta.
    expect(Object.keys(web).sort()).toEqual(Object.keys(electron).sort())
  })
})
