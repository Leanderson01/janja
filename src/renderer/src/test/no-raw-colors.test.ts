// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ARBITRARY_HEX = /-\[#[0-9a-fA-F]{3,8}\]/
const RAW_PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|outline|from|via|to)-(?:white|black|(?:red|blue|green|yellow|gray|zinc|neutral|slate|stone|orange|amber|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/

const root = fileURLToPath(new URL('..', import.meta.url))

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return walk(p)
    return p.endsWith('.tsx') && !p.endsWith('.test.tsx') ? [p] : []
  })
}

const violations: string[] = []
for (const dir of ['components', 'features']) {
  for (const file of walk(join(root, dir))) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (ARBITRARY_HEX.test(line) || RAW_PALETTE.test(line))
          violations.push(`${file.slice(root.length)}:${i + 1}: ${line.trim()}`)
      })
  }
}

describe('guarda de cor crua', () => {
  it('nenhum componente usa cor fora dos tokens', () => {
    expect(violations).toEqual([])
  })
})
