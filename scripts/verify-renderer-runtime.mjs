#!/usr/bin/env node
// Varre o bundle compilado do RENDERER procurando pelo runtime de SERVIDOR do
// Convex. Se ele estiver lá, o app não abre — e nada antes deste script percebe.
//
// Por que existe: em 2026-08-19 o app parou de abrir com
//
//     Uncaught ReferenceError: process is not defined   (server.js:101)
//
// A causa era um único import: `src/renderer/src/lib/attachments.ts` pegava duas
// constantes de `convex/messages.ts`, que importa `convex/server`. O bundler segue
// o import e traz o runtime de servidor junto — e esse runtime usa `process`, que
// não existe no renderer do Electron.
//
// O que torna esse defeito caro é o que ele NÃO faz: `npm run typecheck` passa,
// `npm run build` passa, os 480 testes passam. Nenhuma dessas etapas carrega o
// módulo no ambiente onde ele quebra. Só abrir o app mostra — e, neste projeto,
// abrir o app só acontece numa máquina Windows, que é onde o ciclo de correção
// custa mais caro. Ver HANDOFF.md, lição nº 2: build verde não significa app
// funcionando.
//
// A regra que este script defende: nada em `src/renderer/` pode importar de
// `convex/` além de `_generated/api` (tipos e referências de função, que o cliente
// precisa) e dos módulos folha sem import nenhum, como `lib/attachmentLimits.ts`.
//
// Marcadores escolhidos por serem exports que SÓ existem no runtime de servidor —
// se algum aparece no bundle do cliente, o `convex/server` entrou junto.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RENDERER_DIR = join(process.cwd(), 'out', 'renderer')

const SERVER_MARKERS = ['mutationGeneric', 'queryGeneric', 'actionGeneric', 'internalMutationGeneric']

function collectJs(dir) {
  const found = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...collectJs(full))
    else if (full.endsWith('.js')) found.push(full)
  }
  return found
}

const files = collectJs(RENDERER_DIR)

if (files.length === 0) {
  console.error(`✖ Nenhum .js encontrado em ${RENDERER_DIR} — rode o build antes deste script.`)
  process.exit(1)
}

const hits = []
for (const file of files) {
  const content = readFileSync(file, 'utf8')
  for (const marker of SERVER_MARKERS) {
    if (content.includes(marker)) hits.push({ file, marker })
  }
}

if (hits.length > 0) {
  console.error('✖ Runtime de servidor do Convex dentro do bundle do renderer.')
  console.error('  O app vai falhar ao abrir com "ReferenceError: process is not defined".')
  console.error('')
  for (const { file, marker } of hits) console.error(`  ${marker} em ${file}`)
  console.error('')
  console.error('  Causa quase certa: algum arquivo de src/renderer/ importa de convex/')
  console.error('  um módulo que, direta ou indiretamente, importa convex/server.')
  console.error('  Saída: mover o valor compartilhado para um módulo folha, sem imports')
  console.error('  (o precedente é convex/lib/attachmentLimits.ts).')
  process.exit(1)
}

console.log(`✓ Renderer sem runtime de servidor do Convex (${files.length} arquivos verificados)`)
