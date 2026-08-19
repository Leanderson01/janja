#!/usr/bin/env node
// Varre o bundle já compilado em out/ (main + preload + renderer) procurando por
// padrões com formato de segredo ANTES de electron-builder empacotar esse mesmo
// conteúdo, byte a byte, dentro do asar/instalador. Roda depois de `electron-vite
// build` e antes de `electron-builder --win` (ver package.json, script `build:win`) —
// se algo bater aqui, o instalador nunca chega a ser gerado.
//
// Por que escanear out/ em vez do instalador final: electron-builder empacota o
// conteúdo de out/ verbatim dentro do asar (sem outra etapa de transformação de
// código); escanear a fonte já compilada É escanear o que vai parar no pacote.
//
// O que procura: não segredos específicos deste projeto (não há LIVEKIT_API_SECRET nem
// WORKOS_API_KEY hardcoded em lugar nenhum, confirmado por leitura de código em
// 09-RESEARCH.md e pela Tarefa 2 deste plano) — procura formas GENÉRICAS de segredo
// vazando por engano: prefixos de chave secreta conhecidos (sk_live_/sk_test_, padrão
// WorkOS/Stripe) e o nome literal das duas variáveis de servidor deste projeto que
// nunca deveriam aparecer em código de cliente (WORKOS_API_KEY, LIVEKIT_API_SECRET —
// ambas só existem do lado do Convex, processo separado, nunca bundlado pelo
// electron-vite).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const OUT_DIR = join(process.cwd(), 'out')

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html', '.json', '.css', '.map'])

const PATTERNS = [
  { name: 'chave secreta estilo WorkOS/Stripe (sk_live_...)', regex: /sk_live_[A-Za-z0-9]{10,}/g },
  { name: 'chave secreta estilo WorkOS/Stripe (sk_test_...)', regex: /sk_test_[A-Za-z0-9]{10,}/g },
  { name: 'nome literal da variável de servidor WORKOS_API_KEY', regex: /WORKOS_API_KEY/g },
  { name: 'nome literal da variável de servidor LIVEKIT_API_SECRET', regex: /LIVEKIT_API_SECRET/g }
]

function walk(dir, files = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return files
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      walk(fullPath, files)
    } else {
      files.push(fullPath)
    }
  }
  return files
}

let outStat
try {
  outStat = statSync(OUT_DIR)
} catch {
  console.error('')
  console.error('ERRO verify-no-secrets: diretório out/ não existe.')
  console.error('Este script deve rodar DEPOIS de `electron-vite build` (ver script')
  console.error('`build:win` em package.json) — não há nada para escanear ainda.')
  console.error('')
  process.exit(1)
}

if (!outStat.isDirectory()) {
  console.error('ERRO verify-no-secrets: out/ existe mas não é um diretório.')
  process.exit(1)
}

const files = walk(OUT_DIR).filter((f) => {
  const dot = f.lastIndexOf('.')
  const ext = dot === -1 ? '' : f.slice(dot)
  return TEXT_EXTENSIONS.has(ext)
})

const violations = []

for (const file of files) {
  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue // arquivo binário ou ilegível como texto — não é onde um literal de string apareceria
  }
  for (const { name, regex } of PATTERNS) {
    const matches = content.match(regex)
    if (matches && matches.length > 0) {
      violations.push({ file: relative(process.cwd(), file), pattern: name, count: matches.length })
    }
  }
}

if (violations.length > 0) {
  console.error('')
  console.error('========================================================================')
  console.error('ERRO: build do instalador abortado — possível segredo no bundle compilado.')
  console.error('========================================================================')
  console.error('')
  for (const v of violations) {
    console.error(`  ${v.file}: ${v.pattern} (${v.count}x)`)
  }
  console.error('')
  console.error('Nenhuma dessas strings deveria aparecer em out/ — são padrões de chave')
  console.error('secreta ou nomes de variáveis que só existem do lado do servidor')
  console.error('(Convex), nunca no app Electron empacotado. Investigue antes de gerar')
  console.error('o instalador; um instalador vai para várias máquinas e não pode ser')
  console.error('recolhido depois.')
  console.error('')
  process.exit(1)
}

console.log(`OK verify-no-secrets: ${files.length} arquivo(s) em out/ sem padrão de segredo.`)
