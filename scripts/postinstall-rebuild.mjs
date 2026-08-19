#!/usr/bin/env node
// Roda `electron-builder install-app-deps` sem deixar uma falha dele abortar o
// `npm install` inteiro.
//
// Motivo confirmado por execução real durante a Fase 9 (não suposição — rodado de
// verdade neste worktree): `electron-builder install-app-deps` delega para
// `@electron/rebuild`, cujo detector de prebuild "prebuildify"
// (module-type/prebuildify.js) só reconhece os nomes de arquivo `node.napi.node`,
// `electron.napi.node` ou `electron.abi<N>.node` dentro de
// `prebuilds/<platform>-<arch>/`. O `uiohook-napi` (única dependência nativa deste
// projeto, usada pelo push-to-talk) publica seus prebuilds como
// `prebuilds/<platform>-<arch>/uiohook-napi.node` — um nome que esse detector não
// reconhece — então ele nunca encontra o prebuild já existente e cai para uma
// recompilação via node-gyp, que falha em qualquer máquina sem toolchain de
// compilação C/C++ completo (confirmado aqui: falha por falta de `X11/keysym.h` no
// WSL2; o mesmo aconteceria no Windows sem Visual Studio Build Tools + Python
// instalados — não é algo que se possa presumir que exista na máquina de quem só
// quer gerar o instalador).
//
// `npmRebuild: false`, já presente em electron-builder.yml, NÃO evita isso: esse
// flag só é lido pelo pipeline de empacotamento real (app-builder-lib/out/packager.js,
// usado por `electron-builder --win`), não pelo comando standalone
// `install-app-deps` usado aqui no postinstall (confirmado lendo
// app-builder-lib/out/util/yarn.js — `installOrRebuild` nunca consulta
// `config.npmRebuild`).
//
// A falha é segura para ignorar NESTE projeto especificamente: `uiohook-napi`
// resolve seu próprio binário certo em runtime via `node-gyp-build` (dependência
// dele, não do electron-builder) direto de dentro de
// `prebuilds/<platform>-<arch>/` — confirmado aqui mesmo: `require('uiohook-napi')`
// carrega com sucesso mesmo depois deste comando falhar, porque a tentativa de
// rebuild falhada não apaga nem corrompe o prebuild publicado que já estava lá.
//
// O comando continua rodando (não removido do postinstall) para cobrir o caso geral
// de uma futura dependência nativa que realmente precise de rebuild via node-gyp —
// só não deixamos a falha dela derrubar o `npm install` inteiro.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const cliPath = join(process.cwd(), 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')

if (!existsSync(cliPath)) {
  console.warn('AVISO: electron-builder não encontrado em node_modules — pulando install-app-deps.')
  process.exit(0)
}

const result = spawnSync(process.execPath, [cliPath, 'install-app-deps'], { stdio: 'inherit' })

if (result.status !== 0) {
  console.warn('')
  console.warn('========================================================================')
  console.warn('AVISO: `electron-builder install-app-deps` falhou (ver saída acima).')
  console.warn('========================================================================')
  console.warn('Não bloqueando o `npm install` por causa disso — motivo detalhado no')
  console.warn('topo de scripts/postinstall-rebuild.mjs. Push-to-talk (uiohook-napi) usa')
  console.warn('um binário pré-compilado que não depende deste passo ter funcionado.')
  console.warn('')
}

process.exit(0)
