import { describe, expect, it } from 'vitest'

import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  formatBytes,
  isImage,
  validateFiles
} from './attachments'

// Funções puras: sem DOM e sem rede, por isso rodam no `edge-runtime` padrão do
// vitest, sem o docblock de jsdom.

function file(name: string, size: number): { name: string; size: number } {
  return { name, size }
}

describe('constantes', () => {
  // Se este teste falhar, alguém redeclarou os limites no cliente em vez de
  // importá-los de convex/messages.ts — que é exatamente como cliente e
  // servidor passam a discordar em silêncio.
  it('vêm do módulo do Convex, com os valores do backend', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(25 * 1024 * 1024)
    expect(MAX_ATTACHMENTS_PER_MESSAGE).toBe(5)
  })
})

describe('validateFiles — tamanho', () => {
  it('aceita o arquivo exatamente no limite (o teto é inclusivo, igual ao do servidor)', () => {
    const result = validateFiles([file('limite.bin', MAX_ATTACHMENT_BYTES)], 0)

    expect(result.accepted).toHaveLength(1)
    expect(result.accepted[0].name).toBe('limite.bin')
    expect(result.rejected).toHaveLength(0)
  })

  it('recusa 1 byte acima do limite', () => {
    const result = validateFiles([file('grande.zip', MAX_ATTACHMENT_BYTES + 1)], 0)

    expect(result.accepted).toHaveLength(0)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].name).toBe('grande.zip')
    expect(result.rejected[0].reason).toBe('too-large')
    // A mensagem tem que dizer o limite — "não deu" sem o número obriga o
    // usuário a adivinhar.
    expect(result.rejected[0].message).toContain('25 MB')
  })

  it('recusa o arquivo grande sem gastar uma das vagas', () => {
    const result = validateFiles(
      [file('grande.zip', MAX_ATTACHMENT_BYTES + 1), file('ok.png', 10)],
      MAX_ATTACHMENTS_PER_MESSAGE - 1
    )

    expect(result.accepted.map((f) => f.name)).toEqual(['ok.png'])
    expect(result.rejected.map((f) => f.reason)).toEqual(['too-large'])
  })
})

describe('validateFiles — quantidade', () => {
  it('aceita os primeiros e recusa o resto quando o lote estoura o máximo', () => {
    const lote = Array.from({ length: 7 }, (_, i) => file(`f${i}.png`, 100))

    const result = validateFiles(lote, 0)

    expect(result.accepted.map((f) => f.name)).toEqual([
      'f0.png',
      'f1.png',
      'f2.png',
      'f3.png',
      'f4.png'
    ])
    expect(result.rejected.map((f) => f.name)).toEqual(['f5.png', 'f6.png'])
    expect(result.rejected.every((f) => f.reason === 'too-many')).toBe(true)
    expect(result.rejected[0].message).toContain('5 anexos')
  })

  it('conta os que já estão selecionados: escolher 3 duas vezes não passa de 5', () => {
    const result = validateFiles([file('a.png', 1), file('b.png', 1), file('c.png', 1)], 3)

    expect(result.accepted.map((f) => f.name)).toEqual(['a.png', 'b.png'])
    expect(result.rejected.map((f) => f.name)).toEqual(['c.png'])
  })

  it('recusa tudo quando a lista já está cheia', () => {
    const result = validateFiles([file('a.png', 1)], MAX_ATTACHMENTS_PER_MESSAGE)

    expect(result.accepted).toHaveLength(0)
    expect(result.rejected[0].reason).toBe('too-many')
  })

  it('lote vazio não produz nada', () => {
    expect(validateFiles([], 0)).toEqual({ accepted: [], rejected: [] })
  })
})

describe('formatBytes', () => {
  it('bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('KB', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1,5 KB')
  })

  it('MB, com vírgula decimal de pt-BR', () => {
    expect(formatBytes(1024 * 1024)).toBe('1 MB')
    expect(formatBytes(1_258_291)).toBe('1,2 MB')
    expect(formatBytes(MAX_ATTACHMENT_BYTES)).toBe('25 MB')
  })
})

describe('isImage', () => {
  it('reconhece os formatos que o grupo realmente manda', () => {
    expect(isImage('image/png')).toBe(true)
    expect(isImage('image/jpeg')).toBe(true)
    expect(isImage('image/gif')).toBe(true)
    expect(isImage('image/webp')).toBe(true)
  })

  it('aceita o tipo com parâmetro de cabeçalho', () => {
    expect(isImage('image/png; charset=binary')).toBe(true)
    expect(isImage('IMAGE/PNG')).toBe(true)
  })

  // SVG é documento executável; embutir um vindo de terceiro é vetor de XSS.
  // Cai no cartão genérico de propósito — não "consertar".
  it('NÃO trata SVG como imagem embutível', () => {
    expect(isImage('image/svg+xml')).toBe(false)
    expect(isImage('image/svg+xml; charset=utf-8')).toBe(false)
  })

  it('não confunde outros tipos nem a ausência de tipo', () => {
    expect(isImage('application/pdf')).toBe(false)
    expect(isImage('video/mp4')).toBe(false)
    expect(isImage('text/imagexyz')).toBe(false)
    expect(isImage(undefined)).toBe(false)
    expect(isImage('')).toBe(false)
  })
})
