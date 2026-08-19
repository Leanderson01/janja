import { describe, expect, test } from 'vitest'
import { MAX_HTML_SCAN_CHARS, parseOpenGraph } from './ogParse'

/**
 * Testes do parser de Open Graph. Tudo aqui é string literal — sem rede, sem
 * `convex-test`, sem harness: esta é a parte do plano que é testável de verdade
 * neste ambiente, e por isso ela carrega a maior parte das afirmações.
 *
 * O que estes testes NÃO provam: que o bundler do Convex aceita o módulo (o
 * push é impossível nesta máquina — lição nº 1 do HANDOFF.md) e que sites reais
 * emitem as tags que o parser procura.
 */

const BASE = 'https://exemplo.com/artigo/1'

describe('parseOpenGraph', () => {
  test('página completa: todas as og tags são extraídas', () => {
    const html = `
      <html><head>
        <title>Título do fallback</title>
        <meta property="og:title" content="Título Open Graph">
        <meta property="og:description" content="Uma descrição curta.">
        <meta property="og:image" content="https://cdn.exemplo.com/capa.png">
        <meta property="og:site_name" content="Exemplo">
      </head><body>irrelevante</body></html>`

    expect(parseOpenGraph(html, BASE)).toEqual({
      title: 'Título Open Graph',
      description: 'Uma descrição curta.',
      imageUrl: 'https://cdn.exemplo.com/capa.png',
      siteName: 'Exemplo',
    })
  })

  test('og:title tem preferência sobre <title>', () => {
    const html = `<head><title>Fallback</title><meta property="og:title" content="Preferido"></head>`
    expect(parseOpenGraph(html, BASE).title).toBe('Preferido')
  })

  test('página só com <title>: usa o title e o hostname como siteName', () => {
    const html = `<html><head><title>Só o título</title></head><body></body></html>`
    expect(parseOpenGraph(html, BASE)).toEqual({
      title: 'Só o título',
      siteName: 'exemplo.com',
    })
  })

  test('<meta name="description"> serve de fallback para og:description', () => {
    const html = `<head><title>t</title><meta name="description" content="Descrição clássica"></head>`
    expect(parseOpenGraph(html, BASE).description).toBe('Descrição clássica')
  })

  test('atributos em ordem invertida (content antes de property) são lidos', () => {
    // O erro clássico de regex de meta tag: assumir `property` antes de
    // `content`. O Next.js emite exatamente nesta ordem.
    const html = `<head><meta content="Invertido" property="og:title"></head>`
    expect(parseOpenGraph(html, BASE).title).toBe('Invertido')
  })

  test('atributos com aspas simples, sem aspas e em CAIXA ALTA são lidos', () => {
    const html = `<head>
      <meta PROPERTY='og:title' CONTENT='Aspas simples'>
      <meta property=og:site_name content=SemAspas>
    </head>`
    const result = parseOpenGraph(html, BASE)
    expect(result.title).toBe('Aspas simples')
    expect(result.siteName).toBe('SemAspas')
  })

  test('entidades HTML são decodificadas', () => {
    const html = `<head>
      <meta property="og:title" content="Ana &amp; Bia &lt;3 &quot;aspas&quot; &#39;simples&#39;">
    </head>`
    expect(parseOpenGraph(html, BASE).title).toBe(`Ana & Bia <3 "aspas" 'simples'`)
  })

  test('duplo escape não vira tag: &amp;lt; permanece &lt; literal', () => {
    const html = `<head><meta property="og:title" content="&amp;lt;script&amp;gt;"></head>`
    expect(parseOpenGraph(html, BASE).title).toBe('&lt;script&gt;')
  })

  test('imagem relativa é resolvida contra a baseUrl', () => {
    const html = `<head><meta property="og:image" content="/img/capa.png"></head>`
    expect(parseOpenGraph(html, BASE).imageUrl).toBe('https://exemplo.com/img/capa.png')
  })

  test('imagem javascript: é descartada', () => {
    const html = `<head><meta property="og:image" content="javascript:alert(1)"></head>`
    expect(parseOpenGraph(html, BASE).imageUrl).toBeUndefined()
  })

  test('imagem data: é descartada', () => {
    const html = `<head><meta property="og:image" content="data:image/png;base64,AAAA"></head>`
    expect(parseOpenGraph(html, BASE).imageUrl).toBeUndefined()
  })

  test('título é truncado em 200 e descrição em 300 caracteres', () => {
    const html = `<head>
      <meta property="og:title" content="${'t'.repeat(500)}">
      <meta property="og:description" content="${'d'.repeat(500)}">
    </head>`
    const result = parseOpenGraph(html, BASE)
    expect(result.title).toHaveLength(200)
    expect(result.description).toHaveLength(300)
  })

  test('espaços e quebras de linha no título viram um espaço só', () => {
    const html = ['<head><title>Um', '   título    quebrado</title></head>'].join('\n')
    expect(parseOpenGraph(html, BASE).title).toBe('Um título quebrado')
  })

  test('só o <head> é considerado: og tag no <body> é ignorada', () => {
    const html = `<html><head><title>Cabeça</title></head><body>
      <meta property="og:title" content="Corpo"></body></html>`
    expect(parseOpenGraph(html, BASE).title).toBe('Cabeça')
  })

  test('HTML truncado no meio de uma tag não lança', () => {
    const html = `<html><head><title>Metade</title><meta property="og:desc`
    expect(() => parseOpenGraph(html, BASE)).not.toThrow()
    expect(parseOpenGraph(html, BASE).title).toBe('Metade')
  })

  test('string vazia devolve só o siteName derivado da URL', () => {
    expect(parseOpenGraph('', BASE)).toEqual({ siteName: 'exemplo.com' })
  })

  test('baseUrl inválida não lança e não inventa siteName', () => {
    expect(parseOpenGraph('<head><title>x</title></head>', 'nao é url')).toEqual({ title: 'x' })
  })

  test('título vazio ou só espaços não é gravado', () => {
    const html = `<head><title>   </title><meta property="og:title" content=""></head>`
    expect(parseOpenGraph(html, BASE).title).toBeUndefined()
  })

  test('só os primeiros 100 KB são examinados', () => {
    // A tag válida está DEPOIS do teto de leitura: precisa ser ignorada, senão
    // o teto não existe de verdade.
    const html = `<head>${' '.repeat(MAX_HTML_SCAN_CHARS)}<title>Tarde demais</title></head>`
    expect(parseOpenGraph(html, BASE).title).toBeUndefined()
  })

  test('nunca lança em entrada absurda', () => {
    for (const input of ['<<<>>>', '<head', '</head>', '<meta content=', ' ']) {
      expect(() => parseOpenGraph(input, BASE)).not.toThrow()
    }
  })
})
