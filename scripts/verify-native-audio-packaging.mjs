#!/usr/bin/env node
// Impede que o áudio de compartilhamento por processo (Fase 8.6) quebre APENAS
// no instalador do Windows — que é o único lugar onde as falhas desta fase
// aparecem.
//
// Por que existe: o addon nativo `loopback-capture` traz três modos de falha que
// passam por typecheck, por `npm run build` e pelos 588 testes sem um pio, e
// só se manifestam depois de o app estar instalado, numa máquina Windows, longe
// de quem escreveu o código. É a lição nº 2 do HANDOFF.md ("build verde não
// significa app funcionando") aplicada antes de doer, e não depois.
//
//   1. BUNDLAR O ADDON. O pacote carrega o `.node` pela lib `bindings`, que
//      descobre o `module_root` inspecionando o `Error.stack` para achar qual
//      arquivo a chamou e subindo diretórios até um `package.json`. Se o
//      electron-vite inlinar `loopback-capture` dentro de `out/main/index.js`, o
//      chamador vira o próprio bundle, o `module_root` vira a raiz do app, e o
//      binário é procurado em `app.asar/build/Release/` — que não existe.
//      Sintoma: "Could not locate the bindings file", só no app empacotado.
//
//   2. INLINAR O WORKLET COMO `data:` URI. O `AudioWorkletProcessor` que
//      converte o PCM nativo em track é carregado por `audioWorklet.addModule()`
//      a partir de um asset. O Vite inlina assets abaixo de 4 KB como `data:`
//      URI, e a CSP deste app é `script-src 'self'` (src/renderer/index.html) —
//      o Chromium bloqueia `data:` e `blob:` como fonte de script. Sintoma: o
//      compartilhamento sai SEM SOM, sem nenhum erro de aplicação. Exatamente a
//      forma da CSP do template recusando o WebSocket do Convex na Fase 2.
//      (A CSP não é afrouxada: quem se adapta é o caminho do asset.)
//
//   3. EMPACOTAR A FERRAMENTA DE BUILD. `loopback-capture` declara `cmake-js`
//      em `dependencies` — não em devDependencies — e o electron-builder
//      empacota `dependencies`. São 39 pacotes de toolchain (cmake-js, tar,
//      yargs, semver, fs-extra, rc, url-join, node-api-headers…) dentro do
//      instalador de quem só quer conversar. Não quebra nada; só é gordura que
//      ninguém vê crescer.
//
//      O reverso da moeda tem o mesmo peso e é mais perigoso: as exclusões que
//      tiram esses 39 do pacote poderiam, no futuro, derrubar um pacote que o
//      runtime realmente usa (`debug` e `semver` são nomes que qualquer
//      dependência nova pode puxar). A asserção 5 existe por causa disso: ela
//      recalcula o que os bundles de main/preload precisam e exige que TUDO
//      esteja no pacote. Sem ela, trocaríamos uma falha-só-no-instalador por
//      outra.
//
// O QUE ESTE SCRIPT **NÃO** PROVA:
//   - que `require('loopback-capture')` CARREGA dentro do electron.exe no
//     Windows (aqui não há Windows nem electron.exe; e `node -e` não serviria,
//     HANDOFF lição nº 1: verificar no ambiente errado não é verificar);
//   - que o instalador NSIS coloca o `.node` em
//     `resources/app.asar.unpacked/node_modules/loopback-capture/build/Release/`
//     (a asserção 4 só enxerga o `--dir`, que neste ambiente é Linux);
//   - que sai som.
// Isso é o checkpoint humano 08.6-06. Este script prova a FORMA, não o
// funcionamento.
import {
  readdirSync,
  readFileSync,
  existsSync,
  statSync,
  openSync,
  readSync,
  closeSync
} from 'node:fs'
import { join, dirname, basename } from 'node:path'

const ROOT = process.cwd()
const MAIN_BUNDLE = join(ROOT, 'out', 'main', 'index.js')
const PRELOAD_BUNDLE = join(ROOT, 'out', 'preload', 'index.js')
const RENDERER_DIR = join(ROOT, 'out', 'renderer')
const ADDON = join(
  ROOT,
  'node_modules',
  'loopback-capture',
  'build',
  'Release',
  'loopback_capture_addon.node'
)

const failures = []
const warnings = []
const passes = []

const fail = (title, ...lines) => failures.push([title, lines])
const warn = (msg) => warnings.push(msg)
const pass = (msg) => passes.push(msg)

function collectFiles(dir, ext = '.js') {
  const found = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...collectFiles(full, ext))
    else if (full.endsWith(ext)) found.push(full)
  }
  return found
}

// ---------------------------------------------------------------------------
// Asserção 1 — o addon nativo continua sendo um `require` EXTERNO
// ---------------------------------------------------------------------------
if (!existsSync(MAIN_BUNDLE)) {
  fail(
    'Bundle do main não encontrado.',
    `  Esperado em ${MAIN_BUNDLE}.`,
    '  Rode `npm run build` antes deste script.'
  )
} else {
  const mainBundle = readFileSync(MAIN_BUNDLE, 'utf8')

  // O interior do pacote NUNCA pode aparecer no bundle: o nome do binário só
  // existe dentro de `loopback-capture/dist/index.cjs`. Se ele vazou para cá, o
  // pacote foi inlinado. Esta metade vale sempre, mesmo antes de existir código
  // que use o addon.
  if (mainBundle.includes('loopback_capture_addon')) {
    fail(
      'O addon `loopback-capture` foi INLINADO dentro de out/main/index.js.',
      '  A string `loopback_capture_addon` só existe dentro do dist/ do pacote —',
      '  se ela está no bundle, o rollup copiou o módulo para cá.',
      '  Consequência: a lib `bindings` resolve o .node pelo Error.stack, o chamador',
      '  passa a ser o bundle, e o binário é procurado em app.asar/build/Release/,',
      '  que não existe. Falha em runtime, no Windows, só no app instalado.',
      '  Saída: manter `loopback-capture` em build.rollupOptions.external no bloco',
      '  `main` de electron.vite.config.ts.'
    )
  }

  // A outra metade — exigir o require — só faz sentido quando algo em src/main
  // de fato usa o addon. Enquanto o consumidor não existir (Onda 1 desta fase,
  // antes do plano 08.6-02 entrar), a ausência é o estado correto e vira aviso.
  const mainSources = collectFiles(join(ROOT, 'src', 'main'), '.ts')
  const consumerExists = mainSources.some((f) =>
    readFileSync(f, 'utf8').includes('loopback-capture')
  )

  if (consumerExists) {
    if (
      mainBundle.includes('require("loopback-capture")') ||
      mainBundle.includes("require('loopback-capture')")
    ) {
      pass('out/main/index.js requer `loopback-capture` externamente (não inlinado)')
    } else {
      fail(
        'src/main usa `loopback-capture`, mas o require sumiu de out/main/index.js.',
        '  Ou o módulo foi inlinado, ou o import virou dinâmico de um jeito que o',
        '  rollup reescreveu. Verifique build.rollupOptions.external no bloco `main`',
        '  de electron.vite.config.ts e como o módulo é carregado em src/main.'
      )
    }
  } else {
    warn('Nada em src/main/ usa `loopback-capture` ainda — asserção de require externo pulada.')
  }
}

// ---------------------------------------------------------------------------
// Asserção 2 — o worklet de áudio é um arquivo .js real, nunca um data: URI
// ---------------------------------------------------------------------------
const rendererFiles = collectFiles(RENDERER_DIR, '.js')

if (rendererFiles.length === 0) {
  fail('Nenhum .js encontrado em out/renderer — rode `npm run build` antes deste script.')
} else {
  const WORKLET = 'screenshare-audio-processor'
  const mentionsWorklet = rendererFiles.some((f) => readFileSync(f, 'utf8').includes(WORKLET))
  const workletAsset = rendererFiles.find((f) => basename(f).startsWith(WORKLET))

  // Tolerante enquanto o worklet não existir (o Plano 08.6-03 é que o cria).
  // Assim que qualquer arquivo do renderer mencionar o nome, a asserção passa a
  // ser obrigatória sozinha — é o que permite este plano rodar na Onda 1 sem
  // ficar verde por engano depois.
  if (!mentionsWorklet && !workletAsset) {
    warn(
      `Worklet \`${WORKLET}\` ainda não existe no renderer — asserção pulada (Plano 08.6-03 vai criá-lo).`
    )
  } else if (!workletAsset) {
    fail(
      `O worklet \`${WORKLET}\` é referenciado no renderer, mas não foi emitido como arquivo .js.`,
      '  Provavelmente virou um `data:` URI inline. A CSP deste app é',
      "  `script-src 'self'` (src/renderer/index.html): o Chromium bloqueia `data:`",
      '  e `blob:` como fonte de script, e `audioWorklet.addModule()` falha em',
      '  silêncio — o compartilhamento sai sem áudio, sem erro de aplicação.',
      '  Saída: manter `assetsInlineLimit: 0` em renderer.build de',
      '  electron.vite.config.ts e importar o worklet com `?url`.',
      '  NÃO afrouxe a CSP para resolver isso.'
    )
  } else {
    pass(`Worklet emitido como asset real: ${workletAsset.replace(ROOT + '/', '')}`)
  }

  const DATA_URI_MARKERS = ['data:text/javascript', 'data:application/javascript']
  const inlined = []
  for (const file of collectFiles(join(RENDERER_DIR, 'assets'), '.js')) {
    const content = readFileSync(file, 'utf8')
    for (const marker of DATA_URI_MARKERS)
      if (content.includes(marker)) inlined.push({ file, marker })
  }
  if (inlined.length > 0) {
    fail(
      'Script inlinado como `data:` URI no bundle do renderer.',
      ...inlined.map(({ file, marker }) => `  ${marker} em ${file.replace(ROOT + '/', '')}`),
      "  A CSP `script-src 'self'` bloqueia `data:` — qualquer coisa carregada",
      '  assim (worklet, worker) falha em silêncio no app empacotado.',
      '  Saída: `assetsInlineLimit: 0` em renderer.build de electron.vite.config.ts.'
    )
  } else {
    pass('Nenhum script inlinado como data: URI em out/renderer/assets')
  }
}

// ---------------------------------------------------------------------------
// Asserção 3 — o .node pré-compilado está em node_modules e não está truncado
// ---------------------------------------------------------------------------
if (!existsSync(ADDON)) {
  fail(
    'O binário nativo do loopback-capture não está em node_modules.',
    `  Esperado: ${ADDON.replace(ROOT + '/', '')}`,
    '  O pacote publica o .node x64 já compilado dentro do tarball; se ele sumiu,',
    '  a instalação está incompleta. Saída: `npm install loopback-capture@2.0.0`.',
    '  (Não tente compilar: o pacote não tem binding.gyp e o cmake-js dele nunca roda.)'
  )
} else {
  const size = statSync(ADDON).size
  // Um download interrompido deixa um arquivo de 0 byte que passa em `test -f`.
  // O binário publicado tem ~331 KB.
  if (size < 100 * 1024) {
    fail(
      `O binário nativo tem apenas ${size} bytes — está truncado.`,
      '  O .node publicado tem ~331 KB. Um arquivo curto quase sempre é download',
      '  interrompido ou cache corrompido do npm.',
      '  Saída: `rm -rf node_modules/loopback-capture && npm install`.'
    )
  } else {
    pass(`Binário nativo presente e íntegro (${Math.round(size / 1024)} KB)`)
  }
}

// ---------------------------------------------------------------------------
// Asserções 4 e 5 — o que entrou (e o que sumiu) do app empacotado
// ---------------------------------------------------------------------------

// Lê o diretório do asar sem dependência nenhuma: 4 bytes de pickle, o tamanho
// do JSON em UInt32LE no offset 12, e o JSON a partir do offset 16.
function readAsarHeader(asarPath) {
  const fd = openSync(asarPath, 'r')
  try {
    const prefix = Buffer.alloc(16)
    readSync(fd, prefix, 0, 16, 0)
    const jsonSize = prefix.readUInt32LE(12)
    const json = Buffer.alloc(jsonSize)
    readSync(fd, json, 0, jsonSize, 16)
    return JSON.parse(json.toString('utf8'))
  } finally {
    closeSync(fd)
  }
}

// `name` pode ser escopado (@scope/pkg): cada segmento é um nível de `files`.
function asarHasPackage(header, name) {
  let node = header.files?.node_modules
  for (const segment of name.split('/')) {
    if (!node?.files?.[segment]) return false
    node = node.files[segment]
  }
  return true
}

const distDir = join(ROOT, 'dist')
const unpackedDirs = existsSync(distDir)
  ? readdirSync(distDir)
      .filter((d) => d.endsWith('-unpacked'))
      .map((d) => join(distDir, d, 'resources'))
      .filter((d) => existsSync(d))
  : []

if (unpackedDirs.length === 0) {
  warn(
    'Nenhum dist/*-unpacked/resources encontrado — asserções de empacotamento puladas (rode `npm run build:unpack`).'
  )
} else {
  // Fecho de dependências a partir dos requires que SOBREVIVEM nos bundles.
  // É a lista do que precisa existir dentro do pacote; qualquer exclusão de
  // electron-builder.yml que atinja um destes é um bug de empacotamento.
  // Ferramentas de BUILD: a raiz da subárvore que electron-builder.yml exclui de
  // propósito. `cmake-js` é dependência DECLARADA de `loopback-capture`, então o
  // fecho abaixo passaria por dentro dele e reivindicaria as 39 transitivas de
  // toolchain como "necessárias em runtime". A aresta é cortada aqui — e o corte
  // é seguro justamente porque é o mesmo corte que as exclusões fazem.
  //
  // O buraco que isso NÃO abre: se uma dependência nova puxar `debug` (ou
  // `semver`, ou `tar`) por um caminho que não passe pelo cmake-js, o fecho acha
  // o pacote por esse outro caminho e a asserção 5 acusa a exclusão como bug.
  const BUILD_ONLY = ['cmake-js', 'node-api-headers']

  const readPkg = (dir) => {
    try {
      return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    } catch {
      return null
    }
  }
  const resolveFrom = (fromDir, name) => {
    let dir = fromDir
    for (;;) {
      const candidate = join(dir, 'node_modules', name)
      if (existsSync(join(candidate, 'package.json'))) return candidate
      const parent = dirname(dir)
      if (parent === dir || dir === ROOT) break
      dir = parent
    }
    const candidate = join(ROOT, 'node_modules', name)
    return existsSync(join(candidate, 'package.json')) ? candidate : null
  }

  const bundleRequires = new Set()
  for (const bundle of [MAIN_BUNDLE, PRELOAD_BUNDLE]) {
    if (!existsSync(bundle)) continue
    for (const match of readFileSync(bundle, 'utf8').matchAll(/require\(["']([^"']+)["']\)/g)) {
      const name = match[1]
      if (name === 'electron' || name.startsWith('node:') || name.startsWith('.')) continue
      if (resolveFrom(ROOT, name)) bundleRequires.add(name)
    }
  }

  const needed = new Map()
  const stack = [...bundleRequires].map((n) => [resolveFrom(ROOT, n), n])
  while (stack.length > 0) {
    const [dir, name] = stack.pop()
    if (!dir || needed.has(dir)) continue
    if (BUILD_ONLY.includes(name)) continue
    needed.set(dir, name)
    const pkg = readPkg(dir)
    if (!pkg) continue
    for (const dep of Object.keys({
      ...(pkg.dependencies ?? {}),
      ...(pkg.optionalDependencies ?? {})
    })) {
      const resolved = resolveFrom(dir, dep)
      if (resolved) stack.push([resolved, dep])
    }
  }
  const neededNames = [...new Set(needed.values())].sort()

  for (const resources of unpackedDirs) {
    const label = resources.replace(ROOT + '/', '')
    const asar = join(resources, 'app.asar')
    const asarUnpacked = join(resources, 'app.asar.unpacked')
    const plainApp = join(resources, 'app')

    const present = (name) => {
      if (existsSync(asar) && asarHasPackage(readAsarHeader(asar), name)) return true
      if (existsSync(join(asarUnpacked, 'node_modules', ...name.split('/')))) return true
      if (existsSync(join(plainApp, 'node_modules', ...name.split('/')))) return true
      return false
    }

    // Asserção 4 — a ferramenta de build ficou de fora
    const smuggled = BUILD_ONLY.filter((name) => present(name))
    if (smuggled.length > 0) {
      fail(
        `Ferramenta de build dentro do app empacotado (${label}): ${smuggled.join(', ')}`,
        '  `cmake-js` está em `dependencies` do loopback-capture (não em dev), e o',
        '  electron-builder empacota `dependencies` — mas ele só roda no script',
        '  `compile` do pacote, que nunca executamos: o .node vem pré-compilado.',
        '  Saída: manter as exclusões `!node_modules/<pacote>/**` no bloco `files`',
        '  de electron-builder.yml.'
      )
    } else {
      pass(`Sem ferramenta de build no app empacotado (${label})`)
    }

    // Asserção 5 — nenhuma exclusão derrubou algo que o runtime usa
    const missing = neededNames.filter((name) => !present(name))
    if (missing.length > 0) {
      fail(
        `Pacote necessário em runtime AUSENTE do app empacotado (${label}): ${missing.join(', ')}`,
        '  Estes pacotes são alcançáveis a partir dos `require` que sobrevivem em',
        '  out/main/index.js e out/preload/index.js — o app instalado vai morrer com',
        '  "Cannot find module" ao abrir, e só no Windows.',
        '  Causa quase certa: uma exclusão `!node_modules/<pacote>/**` em',
        '  electron-builder.yml (a lista foi medida contra o cmake-js) agora atinge',
        '  uma dependência nova. Saída: remover a linha de exclusão do pacote citado.'
      )
    } else {
      pass(
        `Todos os ${neededNames.length - BUILD_ONLY.length} pacotes de runtime presentes no pacote (${label})`
      )
    }
  }
}

// ---------------------------------------------------------------------------

for (const msg of warnings) console.warn(`! ${msg}`)

if (failures.length > 0) {
  console.error('')
  for (const [title, lines] of failures) {
    console.error(`✖ ${title}`)
    for (const line of lines) console.error(line)
    console.error('')
  }
  console.error(`${failures.length} verificação(ões) de empacotamento do áudio nativo falharam.`)
  process.exit(1)
}

for (const msg of passes) console.log(`✓ ${msg}`)
console.log(
  `✓ Empacotamento do áudio nativo verificado (${passes.length} asserções, ${warnings.length} pulada(s))`
)
