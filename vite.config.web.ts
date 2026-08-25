import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Segundo alvo de build: o MESMO `src/renderer` compilado para o navegador.
 *
 * Nada se move de diretório. Este arquivo lê o mesmo `root`, o mesmo
 * `index.html` e os mesmos aliases que `electron.vite.config.ts` — a única
 * diferença deliberada é para onde `@platform` aponta, e é dela que a fase
 * inteira depende: quem escolhe entre "o que existe só no Electron" e "o que
 * existe só no navegador" é o BUNDLER, nunca um `if (isElectron)` em código de
 * feature. O que não existe no alvo não entra no grafo de módulos.
 */
export default defineConfig({
  // NÃO MUDAR, NUNCA. O `@tailwindcss/vite` instalado cria o compilador com
  // `new z(i, e.root, ...)` (node_modules/@tailwindcss/vite/dist/index.mjs),
  // onde `e` é a config resolvida do Vite — ou seja, a base de varredura das
  // classes É o `config.root`. E como `src/renderer/src/assets/main.css` só tem
  // `@import "tailwindcss"` (sem nenhum `@source`), as fontes viram
  // `[{ base: root, pattern: "**/*" }]`.
  //
  // Um root diferente faria o Tailwind varrer o diretório errado: o build
  // passaria VERDE, o typecheck VERDE, os 644 testes VERDES — e o app abriria
  // **sem estilo nenhum**. É a forma exata da lição nº 2 do HANDOFF (build
  // verde não significa app funcionando).
  //
  // Se algum dia o root precisar mudar, a mudança obrigatória e SIMULTÂNEA é
  // acrescentar `@source "../";` em `src/renderer/src/assets/main.css`.
  // Guardado por scripts/verify-web-bundle.mjs (afirmação 4).
  root: 'src/renderer',

  // `/` e não `'./'` (que é o default do renderer do electron-vite, correto lá
  // porque o app carrega de `file://`): a Vercel serve a partir da raiz da
  // origem.
  base: '/',

  // O `electron-vite` seta isto por conta própria — em
  // `node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js:545`,
  // `config.envDir = config.envDir || path.resolve(root)` com
  // `root = process.cwd()`. O Vite puro NÃO faz isso: o default dele é o
  // `config.root`, que aqui é `src/renderer`.
  //
  // Sem esta linha o `.env.local` da RAIZ do repositório fica invisível,
  // `VITE_CONVEX_URL` chega `undefined` e o `dev:web` abre direto na tela
  // "Configuração incompleta" — com o arquivo existindo, preenchido, a um
  // diretório de distância. Nenhum erro, nenhum aviso.
  envDir: resolve('.'),

  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@': resolve('src/renderer/src'),
      // A chave da fase. O espelho está em `electron.vite.config.ts`
      // (-> platform/electron). Consumidores importam `@platform/...`;
      // o contrato de TIPOS é sempre importado por `@/platform/contract`,
      // que é igual nos dois alvos.
      '@platform': resolve('src/renderer/src/platform/web')
    }
  },

  server: {
    fs: {
      // `features/auth/AuthGate.tsx` importa
      // `../../../../../convex/_generated/api`, que está FORA do `root`. O dev
      // server do electron-vite não esbarra nisso porque já roda com a raiz do
      // projeto liberada; o Vite puro recusa com "outside of Vite serving allow
      // list" no primeiro `dev:web`. Declarar explicitamente evita a surpresa.
      allow: [resolve('.')]
    }
  },

  build: {
    outDir: resolve('dist-web'),
    emptyOutDir: true
    // `assetsInlineLimit: 0` NÃO é copiado do desktop de propósito: ele existe
    // lá pelo AudioWorklet do áudio por processo (Fase 8.6), que não entra no
    // alvo web — na web o áudio do compartilhamento vem no próprio
    // `getDisplayMedia`.
  },

  plugins: [react(), tailwindcss()]
})
