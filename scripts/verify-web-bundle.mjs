#!/usr/bin/env node
// Varre o artefato compilado do alvo WEB (`dist-web/`) e afirma quatro coisas
// que NENHUMA etapa anterior consegue afirmar. A justificativa e a mesma de
// `scripts/verify-renderer-runtime.mjs`, e vale repetir por extenso: build
// verde nao prova nada.
//
// As quatro afirmacoes existem porque as quatro falhas correspondentes sao
// SILENCIOSAS — passam em `npm run typecheck` nos tres projetos, passam em
// `npm run typecheck:web-target`, passam nos 648 testes e passam no proprio
// `vite build`. Todas so aparecem com a pagina aberta, e duas delas nem geram
// erro no console:
//
//   1. O alias `@platform` nao resolveu para a implementacao web. O bundle
//      leva o lado errado da costura e o app tenta falar com `window.auth`
//      num navegador onde a ponte nao existe.
//   2. O lado Electron entrou junto — o caso tipico e alguem importar
//      `@/platform/electron/...` por caminho direto em vez de `@platform`.
//      Isso nao quebra nada em typecheck: e um import valido.
//   3. Sobrou codigo falando com `window.auth|voice|screenshare|electron` ou
//      com `uiohook`. Ver o bloco STRICT_BRIDGES abaixo: no fim do Plano
//      10-01 esta afirmacao AINDA FALHA, e falhar e o comportamento correto.
//   4. O CSS veio vazio. Esta e a mais cara das quatro, porque e a mais
//      invisivel: o `@tailwindcss/vite` usa o `config.root` do Vite como base
//      de varredura das classes, e um root errado produz um build VERDE com
//      um app 100% funcional e 100% SEM ESTILO. E a forma exata da licao no 2
//      do HANDOFF.
//
// Todas as mensagens de erro dizem a SAIDA, nao so o sintoma.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const WEB_DIR = join(process.cwd(), 'dist-web')

// --- Afirmacoes 1 e 2 -------------------------------------------------------
// Literais de string, e nao nomes de funcao ou de arquivo, porque literais
// sobrevivem a minificacao. Definidos em
// `src/renderer/src/platform/{electron,web}/capabilities.ts`.
const SENTINEL_WEB = 'hydra-platform:web'
const SENTINEL_ELECTRON = 'hydra-platform:electron'

// --- Afirmacao 3 ------------------------------------------------------------
// A ponte do Electron, exposta pelo preload. Nada disso existe no navegador:
// sao `undefined`, e o sintoma e um TypeError no primeiro clique.
const BRIDGE_MARKERS = [
  'window.auth',
  'window.voice',
  'window.screenshare',
  'window.electron',
  'uiohook'
]

// --- Afirmacao 4 ------------------------------------------------------------
// Referencia MEDIDA nos dois alvos, a partir da mesma arvore (Plano 10-01):
//   desktop  out/renderer/assets/*.css  63.932 bytes, 3.012 linhas
//   web      dist-web/assets/*.css      51.083 bytes, 1 linha
// A diferenca de ~13 KB e MINIFICACAO, nao varredura, e vale registrar aqui
// para ninguem gastar uma tarde perseguindo um fantasma: o electron-vite nao
// minifica o renderer (o .js dele sai com 2.582 KB contra 1.151 KB do web), o
// Vite puro minifica. A prova de que os dois varreram o MESMO lugar nao e o
// tamanho: e o inventario de seletores, que bate — 311 no desktop contra 310
// no web, e o unico ausente e `.com`, pedaco do banner
// `/*! tailwindcss ... tailwindcss.com */` que o minificador remove.
//
// O piso de 30 KB e folgado de proposito. O que ele precisa separar e "o
// Tailwind varreu o lugar certo" (dezenas de KB) de "o Tailwind so emitiu as
// variaveis do :root" (2-4 KB). Nao e um teste de tamanho, e um teste de
// presenca com margem — por isso ele anda junto com as tres marcas abaixo.
const CSS_MIN_BYTES = 30 * 1024
const CSS_MARKERS = ['.h-screen', '.flex-col', 'is(.dark *)']

const strict = process.argv.includes('--strict-bridges')

function collect(dir, ext) {
  const found = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...collect(full, ext))
    else if (full.endsWith(ext)) found.push(full)
  }
  return found
}

const jsFiles = collect(WEB_DIR, '.js')
const cssFiles = collect(WEB_DIR, '.css')

if (jsFiles.length === 0) {
  console.error(`✖ Nenhum .js encontrado em ${WEB_DIR}.`)
  console.error('  Saida: rode `npm run build:web` antes deste script.')
  process.exit(1)
}

const rel = (f) => relative(process.cwd(), f)
const failures = []

// Afirmacao 1 — o lado certo entrou.
const withWebSentinel = jsFiles.filter((f) => readFileSync(f, 'utf8').includes(SENTINEL_WEB))
if (withWebSentinel.length === 0) {
  failures.push(
    [
      `✖ [1] A implementacao WEB da plataforma nao esta no bundle (sentinela "${SENTINEL_WEB}" ausente).`,
      '  Causa 1: o alias `@platform` de vite.config.web.ts nao aponta para',
      '           src/renderer/src/platform/web.',
      '  Causa 2: nenhum modulo importa mais `@platform/capabilities` — o unico',
      '           consumidor foi removido de src/renderer/src/main.tsx e o',
      '           Rollup podou o arquivo inteiro.',
      '  Saida: conferir as duas coisas, nessa ordem.'
    ].join('\n')
  )
} else {
  console.log(`✓ [1] Implementacao web presente (${withWebSentinel.map(rel).join(', ')})`)
}

// Afirmacao 2 — o lado errado NAO entrou. Esta e a que protege a fase inteira.
const withElectronSentinel = jsFiles.filter((f) =>
  readFileSync(f, 'utf8').includes(SENTINEL_ELECTRON)
)
if (withElectronSentinel.length > 0) {
  failures.push(
    [
      `✖ [2] A implementacao ELECTRON vazou para o bundle web (sentinela "${SENTINEL_ELECTRON}").`,
      ...withElectronSentinel.map((f) => `      ${rel(f)}`),
      '  Causa quase certa: algum modulo importa `@/platform/electron/...` por',
      '  caminho DIRETO em vez de `@platform/...`. Isso e um import valido, entao',
      '  nem o typecheck nem os testes reclamam — so este script ve.',
      '  Saida: trocar o import por `@platform/...` e deixar o bundler escolher.'
    ].join('\n')
  )
} else {
  console.log(`✓ [2] Nenhum vestigio da implementacao Electron`)
}

// Afirmacao 3 — nenhuma ponte de Electron sobrou.
//
// ATENCAO, E DE PROPOSITO: no fim do Plano 10-01 esta afirmacao AINDA FALHA.
// `hooks/useAuth.ts`, `hooks/useConvexAuthAdapter.ts`, `features/auth/AuthGate.tsx`,
// `features/auth/AuthWatchdog.tsx`, `state/voice-context.tsx` e
// `components/shell/ScreenSharePicker.tsx` continuam falando com `window.*`,
// porque migra-los e o trabalho dos Planos 10-02 e 10-03.
//
// Por isso ela e controlada por flag: sem `--strict-bridges` os achados saem
// como AVISO (exit 0) com a contagem, que e a linha de base que aqueles planos
// precisam zerar; com a flag, viram erro. Quem passa a chamar com a flag,
// dentro do `build:web`, e o Plano 10-07 — quando a migracao estiver completa.
// Um portao que so pode ser ligado depois vale mais que um portao desligado:
// a contagem cai a cada plano e da para ver.
const bridgeHits = []
for (const file of jsFiles) {
  const content = readFileSync(file, 'utf8')
  for (const marker of BRIDGE_MARKERS) {
    if (content.includes(marker)) bridgeHits.push({ file, marker })
  }
}
if (bridgeHits.length > 0) {
  const lines = [
    `[3] ${bridgeHits.length} vestigio(s) da ponte do Electron no bundle web:`,
    ...bridgeHits.map(({ file, marker }) => `      ${marker} em ${rel(file)}`),
    '  No navegador `window.auth`/`voice`/`screenshare`/`electron` sao undefined:',
    '  o sintoma e um TypeError no primeiro clique, nao um erro de build.',
    '  Saida: mover o consumidor para tras do alias `@platform` (Planos 10-02/10-03).'
  ]
  if (strict) {
    failures.push(['✖ ' + lines[0], ...lines.slice(1)].join('\n'))
  } else {
    console.warn('⚠ ' + lines.join('\n'))
    console.warn('  (aviso, nao erro: rode com --strict-bridges para transformar em portao)')
  }
} else {
  console.log(`✓ [3] Nenhuma ponte de Electron no bundle web`)
}

// Afirmacao 4 — o CSS nao veio vazio (a armadilha do root do Tailwind).
const CSS_HELP = [
  '  Este e o sintoma exato de base de varredura errada: o `@tailwindcss/vite`',
  '  cria o compilador com `new z(i, e.root, ...)` — a base E o `config.root` do',
  '  Vite — e `src/renderer/src/assets/main.css` nao tem `@source`, entao as',
  '  fontes viram `[{ base: root, pattern: "**/*" }]`.',
  "  Saida: garantir `root: 'src/renderer'` em vite.config.web.ts. Se o root",
  '  PRECISAR ser outro, a mudanca obrigatoria e SIMULTANEA e acrescentar',
  '  `@source "../";` em src/renderer/src/assets/main.css.',
  '  O app abre normal e funciona inteiro — so que sem estilo nenhum.'
].join('\n')

if (cssFiles.length === 0) {
  failures.push(['✖ [4] Nenhum .css em dist-web/.', CSS_HELP].join('\n'))
} else {
  const biggest = cssFiles
    .map((f) => ({ f, size: statSync(f).size }))
    .sort((a, b) => b.size - a.size)[0]
  const content = readFileSync(biggest.f, 'utf8')
  const missing = CSS_MARKERS.filter((m) => !content.includes(m))
  if (biggest.size < CSS_MIN_BYTES || missing.length > 0) {
    failures.push(
      [
        `✖ [4] O CSS do bundle web parece vazio: ${rel(biggest.f)} tem ${biggest.size} bytes` +
          (missing.length > 0 ? `, sem ${missing.join(', ')}` : ''),
        `  Esperado: > ${CSS_MIN_BYTES} bytes e as marcas ${CSS_MARKERS.join(', ')}.`,
        '  Referencia medida: web 51.083 bytes (minificado), desktop 63.932',
        '  bytes (nao minificado) — e as tres marcas presentes nos dois.',
        CSS_HELP
      ].join('\n')
    )
  } else {
    console.log(
      `✓ [4] CSS real: ${rel(biggest.f)}, ${biggest.size} bytes ` +
        `(ref. minificada: 51083), com ${CSS_MARKERS.join(', ')}`
    )
  }
}

if (failures.length > 0) {
  console.error('')
  for (const f of failures) console.error(f + '\n')
  process.exit(1)
}

console.log(
  `\n✓ Bundle web verificado (${jsFiles.length} .js, ${cssFiles.length} .css)` +
    (strict ? ' — modo estrito' : '')
)
