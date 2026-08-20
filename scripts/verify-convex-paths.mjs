#!/usr/bin/env node
// Recusa nome de arquivo em `convex/` que o Convex não aceita como módulo.
//
// Por que existe: em 2026-08-19 um arquivo novo chamado `attachment-limits.ts`
// derrubou o push, e o erro só apareceu na máquina Windows — a única com
// credencial de deployment:
//
//     InvalidConfig: lib/attachment-limits.js is not a valid path to a Convex
//     module. Path component attachment-limits.js can only contain alphanumeric
//     characters, underscores, or periods.
//
// Nada antes disso reclama: o TypeScript compila, o vitest roda os testes do
// módulo, o `npm run build` passa. O nome só é validado quando o CLI empurra —
// e neste projeto empurrar acontece longe de quem escreveu o arquivo. Esta
// verificação traz o erro para o lado de cá, onde custa dez segundos.
//
// A regra do Convex: cada componente do caminho aceita apenas letras, números,
// sublinhado e ponto. Hífen não. O padrão do projeto é camelCase, como os
// vizinhos `inviteCode.ts`, `authCompletionPage.ts` e `attachmentLimits.ts`.
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const CONVEX_DIR = join(process.cwd(), 'convex')

// Mesma classe de caracteres que a mensagem de erro do servidor nomeia.
const VALID_COMPONENT = /^[A-Za-z0-9_.]+$/

function walk(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    // `_generated` é escrito pelo próprio CLI: se houver algo inválido lá, o
    // problema é do arquivo de origem, que este script já vai apontar.
    if (entry === '_generated' || entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...walk(full))
    else if (/\.(ts|js|tsx|jsx)$/.test(entry)) found.push(full)
  }
  return found
}

const offenders = []
for (const file of walk(CONVEX_DIR)) {
  const rel = relative(CONVEX_DIR, file)
  for (const component of rel.split(/[\\/]/)) {
    if (!VALID_COMPONENT.test(component)) offenders.push({ rel, component })
  }
}

if (offenders.length > 0) {
  console.error('✖ Nome de módulo que o Convex vai recusar no push:')
  console.error('')
  for (const { rel, component } of offenders) {
    console.error(`  convex/${rel}  →  "${component}" tem caractere inválido`)
  }
  console.error('')
  console.error('  Só letras, números, sublinhado e ponto. O padrão do projeto é')
  console.error('  camelCase (inviteCode.ts, authCompletionPage.ts, attachmentLimits.ts).')
  process.exit(1)
}

console.log('✓ Nomes de módulo do Convex válidos')
