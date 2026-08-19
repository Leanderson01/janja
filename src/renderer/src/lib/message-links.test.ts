import { describe, expect, it } from 'vitest'

import { firstLinkOf } from './message-links'

// Função pura: sem DOM e sem rede, por isso roda no `edge-runtime` padrão do
// vitest, sem o docblock de jsdom.

describe('firstLinkOf', () => {
  it('devolve null para texto vazio', () => {
    expect(firstLinkOf('')).toBeNull()
  })

  it('devolve null para texto sem link nenhum', () => {
    expect(firstLinkOf('bom dia, alguém entra na call hoje?')).toBeNull()
  })

  it('acha link no meio da frase', () => {
    expect(firstLinkOf('olha isso https://exemplo.com/post que eu achei')).toBe(
      'https://exemplo.com/post'
    )
  })

  it('acha link que ocupa a mensagem inteira', () => {
    expect(firstLinkOf('https://exemplo.com')).toBe('https://exemplo.com')
  })

  it('apara o ponto final grudado no fim da frase', () => {
    expect(firstLinkOf('achei aqui: https://exemplo.com/post.')).toBe('https://exemplo.com/post')
  })

  it('apara vírgula, ponto e vírgula e ponto de interrogação', () => {
    expect(firstLinkOf('https://exemplo.com, e mais')).toBe('https://exemplo.com')
    expect(firstLinkOf('https://exemplo.com; ok')).toBe('https://exemplo.com')
    expect(firstLinkOf('viu https://exemplo.com?')).toBe('https://exemplo.com')
  })

  it('apara o parêntese que fecha um comentário, não o da URL', () => {
    // Fechamento sobrando = pontuação do texto.
    expect(firstLinkOf('(veja https://exemplo.com/post)')).toBe('https://exemplo.com/post')
    // Fechamento balanceado = faz parte da URL (o caso da Wikipédia).
    expect(firstLinkOf('https://pt.wikipedia.org/wiki/Java_(linguagem)')).toBe(
      'https://pt.wikipedia.org/wiki/Java_(linguagem)'
    )
  })

  it('devolve só o PRIMEIRO link quando há vários', () => {
    expect(firstLinkOf('https://um.com e https://dois.com e https://tres.com')).toBe(
      'https://um.com'
    )
  })

  it('aceita http além de https', () => {
    expect(firstLinkOf('legado em http://exemplo.com/x')).toBe('http://exemplo.com/x')
  })

  it('preserva query string e fragmento', () => {
    expect(firstLinkOf('https://exemplo.com/busca?q=a&b=2#topo')).toBe(
      'https://exemplo.com/busca?q=a&b=2#topo'
    )
  })

  it('NÃO adivinha link sem esquema', () => {
    expect(firstLinkOf('liguei pro www.exemplo.com hoje')).toBeNull()
    expect(firstLinkOf('manda o arquivo.zip')).toBeNull()
    expect(firstLinkOf('exemplo.com')).toBeNull()
  })

  it('NÃO aceita esquemas perigosos nem exóticos', () => {
    expect(firstLinkOf('javascript:alert(1)')).toBeNull()
    expect(firstLinkOf('clica em javascript:alert(1) agora')).toBeNull()
    expect(firstLinkOf('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(firstLinkOf('ftp://exemplo.com/arquivo')).toBeNull()
    expect(firstLinkOf('file:///C:/Users/leo/segredo.txt')).toBeNull()
  })

  it('não confunde esquema grudado no fim de outra palavra', () => {
    // Sem a fronteira à esquerda, "xhttps://..." viraria link.
    expect(firstLinkOf('xhttps://exemplo.com')).toBeNull()
    expect(firstLinkOf('mailto:eu@https://exemplo.com')).toBeNull()
  })

  it('devolve null quando sobra esquema sem host', () => {
    expect(firstLinkOf('http://')).toBeNull()
    expect(firstLinkOf('olha https://.')).toBeNull()
  })

  it('descarta URL absurdamente longa', () => {
    const gigante = `https://exemplo.com/${'a'.repeat(2100)}`
    expect(firstLinkOf(gigante)).toBeNull()
    // e a de tamanho aceitável continua passando
    expect(firstLinkOf(`https://exemplo.com/${'a'.repeat(100)}`)).toBe(
      `https://exemplo.com/${'a'.repeat(100)}`
    )
  })

  it('corta o link em delimitador de markup e de aspas', () => {
    expect(firstLinkOf('<https://exemplo.com/post>')).toBe('https://exemplo.com/post')
    expect(firstLinkOf('disse "https://exemplo.com/post" ontem')).toBe('https://exemplo.com/post')
  })

  it('acha link depois de quebra de linha', () => {
    expect(firstLinkOf('primeira linha\nhttps://exemplo.com/post')).toBe(
      'https://exemplo.com/post'
    )
  })
})
