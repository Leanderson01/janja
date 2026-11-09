// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./main.css', import.meta.url), 'utf8')

/** Recorta o corpo do bloco que começa em `header` até a chave que o fecha. */
function block(header: string): string {
  const start = css.indexOf(header)
  if (start === -1) throw new Error(`bloco não encontrado: ${header}`)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  throw new Error(`bloco sem fechamento: ${header}`)
}

const dark = block('.dark {')
const theme = block('@theme inline {')

describe('tokens do Discord', () => {
  it('o bloco .dark tem as cores medidas no print', () => {
    expect(dark).toMatch(/--background:\s*#1a1a1e/)
    expect(dark).toMatch(/--sidebar:\s*#121214/)
    expect(dark).toMatch(/--secondary:\s*#2c2c30/)
    expect(dark).toMatch(/--primary:\s*#5865f2/)
    expect(dark).toMatch(/--panel:\s*#202024/)
    expect(dark).toMatch(/--composer:\s*#222327/)
    expect(dark).toMatch(/--muted-foreground:\s*#81828a/)
  })

  it('todo token novo tem mapeamento no @theme inline', () => {
    for (const t of [
      'panel', 'panel-border', 'composer', 'strong', 'hint', 'icon', 'link', 'voice',
      'avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5', 'embed-x', 'embed-youtube'
    ])
      expect(theme).toContain(`--color-${t}: var(--${t})`)
  })

  it('a fonte padrão é a Figtree', () => {
    expect(theme).toMatch(/--font-sans:\s*'Figtree Variable'/)
  })
})
