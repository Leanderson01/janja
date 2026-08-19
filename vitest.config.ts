import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // O alias `@` / `@renderer` existe em `electron.vite.config.ts` (bloco
  // `renderer`), que o vitest não lê. Sem repeti-lo aqui, NENHUM teste de
  // componente é possível: todo componente de `components/ui/` importa
  // `@/lib/utils`, e o vitest falha com "Failed to resolve import".
  // Acréscimo do Plano 08.5-02; o ambiente global continua `edge-runtime`.
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@': resolve('src/renderer/src'),
    },
  },
  test: {
    // `edge-runtime` é exigência do `convex-test` e vale para os 18 arquivos
    // de teste que já existiam. Teste de componente escolhe jsdom por arquivo,
    // com o docblock `// @vitest-environment jsdom` na primeira linha.
    environment: 'edge-runtime',
    server: {
      deps: {
        inline: ['convex-test'],
      },
    },
  },
})
