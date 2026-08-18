---
phase: 00-bootstrap-do-repo
plan: 02
type: execute
wave: 2
depends_on: ["00-01"]
files_modified:
  - package.json
  - electron.vite.config.ts
  - tsconfig.web.json
  - components.json
  - src/renderer/src/assets/main.css
  - src/renderer/src/App.tsx
  - src/renderer/src/lib/utils.ts
  - src/renderer/src/components/ui/button.tsx
autonomous: true

must_haves:
  truths:
    - "Renderer usa Tailwind v4: main.css contém @import \"tailwindcss\" e electron.vite.config.ts inclui o plugin @tailwindcss/vite no bloco renderer"
    - "components.json existe e npx shadcn@latest add funciona sem erro de detecção de framework (ou, se a CLI falhar, os arquivos foram criados manualmente com o conteúdo confirmado em 00-RESEARCH.md)"
    - "App.tsx renderiza um componente Button do shadcn/ui com classes Tailwind aplicadas, e npm run build continua passando"
  artifacts:
    - path: "components.json"
      provides: "Config manual do shadcn/ui — aliases @/components, @/lib, @/hooks apontando para src/renderer/src"
      contains: "\"style\": \"new-york\""
    - path: "src/renderer/src/assets/main.css"
      provides: "Entry point CSS do renderer com Tailwind v4 + tema base do shadcn"
      contains: "@import \"tailwindcss\""
    - path: "src/renderer/src/lib/utils.ts"
      provides: "Helper cn() usado por todo componente shadcn"
      exports: ["cn"]
    - path: "src/renderer/src/components/ui/button.tsx"
      provides: "Primeiro componente shadcn instalado — prova que a pipeline funciona"
    - path: "electron.vite.config.ts"
      provides: "Plugin @tailwindcss/vite no bloco renderer + alias @ apontando pra src/renderer/src"
      contains: "tailwindcss()"
  key_links:
    - from: "electron.vite.config.ts (renderer.plugins)"
      to: "@tailwindcss/vite"
      via: "import tailwindcss from '@tailwindcss/vite'"
      pattern: "tailwindcss\\(\\)"
    - from: "src/renderer/src/App.tsx"
      to: "src/renderer/src/components/ui/button.tsx"
      via: "import { Button } from"
      pattern: "components/ui/button|@/components/ui/button"
    - from: "tsconfig.web.json (compilerOptions.paths)"
      to: "src/renderer/src"
      via: "alias @/*"
      pattern: "\"@/\\*\""
---

<objective>
Instalar e ligar Tailwind v4 e shadcn/ui no bloco `renderer` do
electron-vite, incluindo o fallback manual para o `components.json` — a CLI
`shadcn init` não reconhece `electron.vite.config.ts` (issue oficial #4885,
sem correção prevista) e nunca teria funcionado direto neste projeto.
Terminar com um componente `Button` do shadcn renderizando de verdade em
`App.tsx`, provando que a pipeline (Tailwind → CSS → componente → build)
funciona de ponta a ponta.

Purpose: F3 (Shell da UI) e todas as fases seguintes com interface assumem
que `npx shadcn@latest add <componente>` simplesmente funciona. Sem este
plano, a primeira tentativa de adicionar um componente em F3 pararia no
mesmo bug de detecção de framework que já está documentado e resolvido aqui.
Output: Tailwind v4 + shadcn/ui prontos para uso, com um componente real
instalado e renderizando.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/00-bootstrap-do-repo/00-RESEARCH.md
@.planning/phases/00-bootstrap-do-repo/00-01-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Tailwind v4 no bloco renderer</name>
  <files>package.json, electron.vite.config.ts, tsconfig.web.json, src/renderer/src/assets/main.css</files>
  <action>
    Instalar Tailwind v4 (sem `tailwind.config.js` — v4 é CSS-first):

    ```bash
    npm install -D tailwindcss @tailwindcss/vite
    ```

    Editar `electron.vite.config.ts`: importar o plugin e adicioná-lo ao
    array `plugins` do bloco `renderer` (não tocar em `main`/`preload` —
    Tailwind não se aplica a eles). Também adicionar o alias `@` apontando
    pro mesmo diretório que `@renderer` já usa, porque todo componente que o
    CLI do shadcn gera importa de `@/lib/utils` hardcoded (ver
    `00-RESEARCH.md` §3.1):

    ```ts
    import { resolve } from 'path'
    import { defineConfig } from 'electron-vite'
    import react from '@vitejs/plugin-react'
    import tailwindcss from '@tailwindcss/vite'

    export default defineConfig({
      main: {},
      preload: {},
      renderer: {
        resolve: {
          alias: {
            '@renderer': resolve('src/renderer/src'),
            '@': resolve('src/renderer/src')
          }
        },
        plugins: [react(), tailwindcss()]
      }
    })
    ```

    Editar `tsconfig.web.json` — adicionar `"@/*"` em `compilerOptions.paths`
    ao lado do `"@renderer/*"` já existente (os dois convivem, não
    substituir um pelo outro):

    ```json
    "paths": {
      "@renderer/*": ["src/renderer/src/*"],
      "@/*": ["src/renderer/src/*"]
    }
    ```

    Substituir o conteúdo de `src/renderer/src/assets/main.css` (o CSS de
    demo gerado pelo scaffold, com logo/versões, não serve mais) por:

    ```css
    @import "tailwindcss";
    ```

    (o import do tema do shadcn entra na Task 2, depois que o pacote
    `shadcn` estiver instalado — ver `00-RESEARCH.md` §3.4). Deixar
    `src/renderer/src/assets/base.css` como está por enquanto — não é mais
    importado por `main.css` depois desta edição, e será removido ou
    reaproveitado em F3 conforme necessário; não é escopo deste plano.
  </action>
  <verify>
    `grep -n "tailwindcss()" electron.vite.config.ts` retorna a linha dentro
    do bloco `renderer`.
    `grep -n '"@/\*"' tsconfig.web.json` retorna a linha.
    `grep -n '@import "tailwindcss"' src/renderer/src/assets/main.css` retorna a linha.
    `npm run typecheck` passa sem erro (confirma que o alias `@` resolve
    corretamente no TypeScript).
  </verify>
  <done>Tailwind v4 ligado ao build do renderer via @tailwindcss/vite; alias @ configurado em electron.vite.config.ts e tsconfig.web.json; typecheck passa.</done>
</task>

<task type="auto">
  <name>Task 2: components.json manual + primeiro componente shadcn + App.tsx mínimo</name>
  <files>components.json, src/renderer/src/assets/main.css, src/renderer/src/App.tsx, src/renderer/src/lib/utils.ts, src/renderer/src/components/ui/button.tsx, package.json</files>
  <action>
    **Passo 1 — instalar o pacote de tema do shadcn** (traz as variáveis CSS
    prontas, evita colar dezenas de valores hex à mão — ver `00-RESEARCH.md`
    §3.4):

    ```bash
    npm install -D shadcn tw-animate-css
    ```

    Atualizar `src/renderer/src/assets/main.css` para o conteúdo final:

    ```css
    @import "tailwindcss";
    @import "tw-animate-css";
    @import "shadcn/tailwind.css";

    @layer base {
      * {
        @apply border-border outline-ring/50;
      }
      body {
        @apply bg-background text-foreground;
      }
    }
    ```

    **Passo 2 — criar `components.json` na raiz do repo**, conteúdo exato
    confirmado em `00-RESEARCH.md` §3.3:

    ```json
    {
      "$schema": "https://ui.shadcn.com/schema.json",
      "style": "new-york",
      "rsc": false,
      "tsx": true,
      "iconLibrary": "lucide",
      "tailwind": {
        "config": "",
        "css": "src/renderer/src/assets/main.css",
        "baseColor": "neutral",
        "cssVariables": true,
        "prefix": ""
      },
      "aliases": {
        "components": "@/components",
        "utils": "@/lib/utils",
        "ui": "@/components/ui",
        "lib": "@/lib",
        "hooks": "@/hooks"
      }
    }
    ```

    **Passo 3 — instalar o primeiro componente:**

    ```bash
    npx shadcn@latest add button
    ```

    **Se este comando falhar com erro de detecção de framework** (o bug
    documentado na issue #4885 é especificamente sobre `electron.vite.config.ts`
    não ser reconhecido — pode ou não atingir também o `add`, não só o
    `init`): não insistir tentando flags diferentes da CLI. Em vez disso,
    criar os dois arquivos manualmente, com o conteúdo já confirmado em
    `00-RESEARCH.md` §3.5 (baixado direto do registry oficial do shadcn):

    `src/renderer/src/lib/utils.ts`:
    ```ts
    import { clsx, type ClassValue } from "clsx"
    import { twMerge } from "tailwind-merge"

    export function cn(...inputs: ClassValue[]) {
      return twMerge(clsx(inputs))
    }
    ```

    `src/renderer/src/components/ui/button.tsx`: componente completo do
    registry oficial (`cva` + `Slot` de `radix-ui`, importa `cn` de
    `@/lib/utils`) — copiar o conteúdo exato do arquivo
    `registry/new-york-v4/ui/button.tsx` documentado em `00-RESEARCH.md`
    §3.5.

    Em qualquer um dos dois caminhos (CLI ou manual), garantir que as
    dependências do componente estão instaladas:
    ```bash
    npm install clsx tailwind-merge class-variance-authority radix-ui
    ```
    (a CLI faria isso sozinha; no caminho manual, rodar explicitamente.)

    **Passo 4 — substituir o conteúdo de demo de `App.tsx`** (logo do
    Electron, lista de versões, texto de boas-vindas — nada disso é produto)
    por um placeholder mínimo que prova a pipeline:

    ```tsx
    import { Button } from '@/components/ui/button'

    function App(): React.JSX.Element {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
          <Button>janja</Button>
        </div>
      )
    }

    export default App
    ```

    Remover a importação de `./assets/main.css` de `src/renderer/src/main.tsx`
    só se ela tiver sido removida — **não remover**, o CSS continua sendo
    necessário; só o conteúdo do arquivo CSS mudou (Passo 1). Remover
    também a importação/uso de `Versions` e `electronLogo` de `App.tsx`
    junto com a troca acima (não deixar imports mortos).
  </action>
  <verify>
    `test -f components.json` e `grep -n '"style": "new-york"' components.json` retornam sucesso.
    `test -f src/renderer/src/lib/utils.ts` e `grep -n "export function cn" src/renderer/src/lib/utils.ts` retornam sucesso.
    `test -f src/renderer/src/components/ui/button.tsx` retorna sucesso.
    `grep -n "components/ui/button" src/renderer/src/App.tsx` retorna a linha do import.
    `npm run build` termina com exit code 0 (prova que Tailwind, alias e componente compilam juntos sem erro).
  </verify>
  <done>components.json existe (manual, funcional independente do bug de detecção da CLI); Button do shadcn instalado e renderizado em App.tsx; npm run build passa.</done>
</task>

</tasks>

<verification>
- `electron.vite.config.ts` tem `tailwindcss()` no bloco `renderer`.
- `components.json` existe com aliases `@/*` consistentes com `tsconfig.web.json` e `electron.vite.config.ts`.
- `src/renderer/src/components/ui/button.tsx` e `src/renderer/src/lib/utils.ts` existem.
- `App.tsx` importa e renderiza `Button`.
- `npm run build` passa sem erro.
</verification>

<success_criteria>
- Tailwind v4 funcional no renderer, sem `tailwind.config.js` (config CSS-first).
- shadcn/ui funcional via `components.json` manual — `npx shadcn@latest add <outro-componente>` deve funcionar para qualquer componente futuro, não só o `button` testado aqui.
- App renderiza um componente real com estilos aplicados, não mais o boilerplate de demonstração do electron-vite.
</success_criteria>

<output>
After completion, create `.planning/phases/00-bootstrap-do-repo/00-02-SUMMARY.md`.
</output>
