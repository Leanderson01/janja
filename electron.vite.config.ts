import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      // Externalizacao EXPLICITA dos modulos nativos. Ate aqui o bloco `main`
      // era `{}` e as dependencias ficavam externas por comportamento herdado do
      // electron-vite (verificado no artefato: out/main/index.js so tinha require
      // de @electron-toolkit/utils, @workos-inc/node, electron, fs, path e
      // uiohook-napi). Comportamento herdado nao e contrato — e o preco de perde-lo
      // e alto e invisivel:
      //
      // `loopback-capture` carrega o .node atraves da lib `bindings`, que descobre
      // o `module_root` inspecionando o `Error.stack` para achar QUAL ARQUIVO a
      // chamou e subindo diretorios ate encontrar um `package.json`. Se o rollup
      // inlinar o pacote dentro de out/main/index.js, o chamador passa a ser o
      // proprio bundle, o module_root vira a raiz do app, e o binario e procurado
      // em `app.asar/build/Release/loopback_capture_addon.node` — que nao existe.
      //
      // Nada disso aparece aqui: typecheck passa, build passa, testes passam. A
      // falha e em runtime, no Windows, SO no app empacotado. HANDOFF.md, licao
      // no 2: build verde nao significa app funcionando.
      // Guardado por scripts/verify-native-audio-packaging.mjs (asercao 1).
      rollupOptions: {
        external: ['loopback-capture', 'uiohook-napi']
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    build: {
      // O AudioWorkletProcessor do audio de compartilhamento (Plano 08.6-03) e
      // carregado por `audioWorklet.addModule(url)` a partir de um asset emitido
      // (`import url from './...js?url'`). O Vite, por padrao, inlina qualquer
      // asset abaixo de 4 KB como `data:` URI — e o worklet e pequeno.
      //
      // A CSP deste app e `script-src 'self'` (src/renderer/index.html), o que
      // faz o Chromium BLOQUEAR `data:` e `blob:` como fonte de script. O sintoma
      // seria "compartilhou e nao saiu som", sem erro de aplicacao — exatamente a
      // forma da licao no 2 do HANDOFF (a CSP do template recusando o WebSocket do
      // Convex sem gerar erro).
      //
      // A CSP NAO e afrouxada: quem se adapta e o caminho do asset. Zerar o limite
      // garante arquivo .js real no disco, servido de 'self'.
      // Guardado por scripts/verify-native-audio-packaging.mjs (asercao 2).
      assetsInlineLimit: 0
    },
    plugins: [react(), tailwindcss()]
  }
})
