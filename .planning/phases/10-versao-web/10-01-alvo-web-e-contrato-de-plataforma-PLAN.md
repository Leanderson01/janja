---
phase: 10-versao-web
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - vite.config.web.ts
  - tsconfig.web.json
  - tsconfig.web-target.json
  - tsconfig.node.json
  - package.json
  - .gitignore
  - .prettierignore
  - eslint.config.mjs
  - electron.vite.config.ts
  - vitest.config.ts
  - src/renderer/index.html
  - src/renderer/src/env.d.ts
  - src/renderer/src/main.tsx
  - src/renderer/src/platform/contract.ts
  - src/renderer/src/platform/electron/capabilities.ts
  - src/renderer/src/platform/web/capabilities.ts
  - src/renderer/src/platform/capabilities.test.ts
  - scripts/verify-web-bundle.mjs
  - src/renderer/src/components/Versions.tsx
autonomous: true

must_haves:
  truths:
    - "`npm run build:web` produz `dist-web/` a partir do MESMO `src/renderer`, com CSS do Tailwind de verdade (não um arquivo vazio)"
    - "`npm run dev:web` sobe um servidor que o Chrome do Windows alcança por `http://localhost:5173` e que enxerga o `.env.local` da raiz do repositório"
    - "Existe um contrato de plataforma em tipos, e duas implementações de `capabilities` que o compilador prova estarem em conformidade — uma por alvo"
    - "O alias `@platform` resolve para `platform/electron` no alvo Electron e para `platform/web` no alvo web, e o bundle web NÃO contém a implementação Electron"
    - "O desktop constrói e roda exatamente como antes: `npm run build` verde, 644 testes passando, nenhum comportamento novo"
    - "`src/renderer/src/components/Versions.tsx` deixou de existir (não era importado por ninguém)"
  artifacts:
    - path: "vite.config.web.ts"
      provides: "segundo alvo de build a partir de src/renderer, com root, envDir, base, aliases e outDir corretos"
      min_lines: 60
    - path: "src/renderer/src/platform/contract.ts"
      provides: "tipos da camada de plataforma: capabilities, auth, push-to-talk, compartilhamento de tela"
      exports: ["PlatformCapabilities", "PlatformAuth", "PlatformPushToTalk", "PlatformScreenShare", "SessionUser"]
      min_lines: 90
    - path: "src/renderer/src/platform/electron/capabilities.ts"
      provides: "o que o alvo Electron sabe fazer, incluindo o sentinela de bundle"
      exports: ["capabilities"]
    - path: "src/renderer/src/platform/web/capabilities.ts"
      provides: "o que o alvo web sabe fazer, incluindo o sentinela de bundle"
      exports: ["capabilities"]
    - path: "scripts/verify-web-bundle.mjs"
      provides: "prova, sobre o artefato compilado, de que o alvo web não arrastou o lado Electron e de que o CSS não veio vazio"
      min_lines: 70
  key_links:
    - from: "vite.config.web.ts"
      to: "src/renderer/src/platform/web"
      via: "alias @platform"
      pattern: "'@platform':\\s*resolve\\('src/renderer/src/platform/web'\\)"
    - from: "electron.vite.config.ts"
      to: "src/renderer/src/platform/electron"
      via: "alias @platform"
      pattern: "'@platform':\\s*resolve\\('src/renderer/src/platform/electron'\\)"
    - from: "src/renderer/src/main.tsx"
      to: "@platform/capabilities"
      via: "import + log de boot (primeiro consumidor real do alias)"
      pattern: "@platform/capabilities"
    - from: "package.json"
      to: "vite.config.web.ts"
      via: "scripts dev:web / build:web / preview:web"
      pattern: "vite.*--config vite.config.web.ts"
---

<objective>
Fazer o MESMO `src/renderer` construir para o navegador, e criar a costura pela
qual as diferenças entre os dois alvos vão passar — sem implementar nenhuma
delas ainda.

Purpose: este é o andaime da fase inteira. Todos os outros oito planos assumem
que existe (a) um segundo alvo de build que não é uma cópia do renderer e (b)
um lugar único onde "o que existe só no Electron" e "o que existe só no
navegador" se encontram, escolhido pelo BUNDLER e não por `if (isElectron)`.
Enquanto isso não existir, qualquer trabalho de feature na web é código sem
onde morar.

Output: `dist-web/` construível, `dev:web` rodando, `platform/contract.ts` com
os quatro tipos da costura, `capabilities` implementado dos dois lados, e um
script que prova sobre o artefato compilado que o alvo web não arrastou o lado
Electron.
</objective>

<precondition>
**Pré-condição do ROADMAP, mantida:** nada desta fase começa antes da sessão de
verificação de `.planning/CHECKPOINT-WINDOWS.md`. Abrir uma segunda plataforma
antes de a primeira ter sido verificada uma vez dobra a superfície de
verificação de algo que ninguém viu funcionar ainda.

**Linha de base desta fase, a ser conferida antes da primeira linha de código**
(e é o que "sem regressão" significa em todos os nove planos):
`npm run typecheck` limpo nos três projetos, `npm run build` verde, e
`npx vitest run` com **38 arquivos e 644 testes passando**.
</precondition>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-versao-web/10-RESEARCH.md
@.planning/CHECKPOINT-WINDOWS.md

# O que se está duplicando (e o que NÃO se está duplicando)
@electron.vite.config.ts
@vitest.config.ts
@tsconfig.web.json
@tsconfig.node.json
@package.json
@src/renderer/index.html

# Os 10 arquivos que tocam a ponte do Electron — o contrato é derivado DELES,
# não inventado. Não editar nenhum neste plano.
@src/preload/index.ts
@src/renderer/src/hooks/useAuth.ts
@src/renderer/src/hooks/useConvexAuthAdapter.ts
@src/renderer/src/lib/profile-hint.ts
@src/renderer/src/main.tsx

# O precedente de "build verde não prova nada" que este plano repete
@scripts/verify-renderer-runtime.mjs
</context>

<tasks>

<task type="auto">
  <name>Task 1: O segundo alvo de build — vite.config.web.ts, scripts e ignores</name>
  <files>vite.config.web.ts, package.json, .gitignore, .prettierignore, eslint.config.mjs, tsconfig.node.json, tsconfig.web.json, tsconfig.web-target.json</files>
  <action>
    Criar `vite.config.web.ts` na RAIZ do repositório. Nada se move de
    diretório: o alvo web lê o mesmo `src/renderer`, o mesmo `index.html` e os
    mesmos aliases.

        import { resolve } from 'path'
        import { defineConfig } from 'vite'
        import react from '@vitejs/plugin-react'
        import tailwindcss from '@tailwindcss/vite'

        export default defineConfig({
          root: 'src/renderer',
          base: '/',
          envDir: resolve('.'),
          resolve: {
            alias: {
              '@renderer': resolve('src/renderer/src'),
              '@': resolve('src/renderer/src'),
              '@platform': resolve('src/renderer/src/platform/web')
            }
          },
          server: { fs: { allow: [resolve('.')] } },
          build: { outDir: resolve('dist-web'), emptyOutDir: true },
          plugins: [react(), tailwindcss()]
        })

    **Cada linha não óbvia precisa do comentário que explica o modo de falha
    que ela evita. Estas três não são estilo, são armadilhas verificadas:**

    1. `root: 'src/renderer'` — **NÃO MUDAR, NUNCA.** O
       `@tailwindcss/vite` instalado cria o compilador com
       `new z(i, e.root, ...)`, ou seja, a base de varredura das classes É o
       `config.root` do Vite (`node_modules/@tailwindcss/vite/dist/index.mjs`).
       E como `src/renderer/src/assets/main.css` só tem `@import "tailwindcss"`
       (sem `@source`), as fontes viram `[{ base: root, pattern: "**/*" }]`.
       Um root diferente faria o Tailwind varrer o diretório errado: build
       VERDE, typecheck VERDE, 644 testes VERDES — e o app abrindo **sem
       estilo nenhum**. É a forma exata da lição nº 2 do HANDOFF. Se algum dia
       o root precisar mudar, a mudança obrigatória e SIMULTÂNEA é acrescentar
       `@source "../";` em `main.css`.
    2. `envDir: resolve('.')` — o `electron-vite` seta `config.envDir` para a
       raiz do projeto por conta própria
       (`node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js:545`,
       `config.envDir = config.envDir || path.resolve(root)` com
       `root = process.cwd()`). O Vite puro NÃO faz isso: o default dele é o
       `config.root`, que aqui é `src/renderer`. Sem esta linha, o
       `.env.local` da raiz fica invisível, `VITE_CONVEX_URL` chega
       `undefined` e o `dev:web` abre direto na tela "Configuração incompleta"
       — com o arquivo existindo, preenchido, a um diretório de distância.
    3. `server.fs.allow` — `features/auth/AuthGate.tsx` importa
       `../../../../../convex/_generated/api`, que está FORA do `root`. O
       electron-vite não esbarra nisso porque o dev server dele já roda com a
       raiz do projeto liberada. Declarar explicitamente evita um
       "outside of Vite serving allow list" no primeiro `dev:web`.

    `base: '/'` (e não `'./'` como no desktop) porque a Vercel serve a partir
    da raiz da origem. `assetsInlineLimit` NÃO é copiado do desktop: ele existe
    lá pelo `AudioWorklet` do áudio por processo, que não entra no alvo web.

    **Scripts em `package.json`** (acrescentar, sem tocar nos existentes):

        "dev:web": "vite --config vite.config.web.ts",
        "build:web": "npm run typecheck:web && npm run typecheck:web-target && vite build --config vite.config.web.ts",
        "preview:web": "vite preview --config vite.config.web.ts",
        "typecheck:web-target": "tsc --noEmit -p tsconfig.web-target.json --composite false",
        "verify:web-bundle": "node scripts/verify-web-bundle.mjs"

    `verify:web-bundle` ainda **não** entra no `build:web` — ele só passa a ser
    portão no Plano 10-07, quando a migração dos consumidores estiver
    completa. Escrever isso em comentário no SUMMARY, não no JSON.

    **Ignores — `dist-web` é novo e nenhum deles o cobre hoje:**
    - `.gitignore`: acrescentar `dist-web`. O padrão `dist` casa só com o nome
      exato; sem esta linha o primeiro build local vira ~200 arquivos no
      `git status`, e a lição nº 5 do HANDOFF (`git add` amplo quebra o main)
      já custou caro uma vez.
    - `.prettierignore`: acrescentar `dist-web`.
    - `eslint.config.mjs`: acrescentar `'**/dist-web'` ao array `ignores` do
      primeiro bloco. **Este plano NÃO adiciona nenhuma regra nova** — a guarda
      `no-restricted-syntax` contra `window.*` é do Plano 10-07, e ligá-la
      agora quebraria o lint com 9 arquivos ainda não migrados.

    **TypeScript — duas configs, e a segunda é o que prova a costura:**
    - `tsconfig.node.json`: acrescentar `"vite.config.web.*"` ao `include`
      (hoje ele cobre só `electron.vite.config.*`). Sem isso o config novo não
      é checado por ninguém.
    - `tsconfig.web.json`: acrescentar em `paths` o mapeamento
      `"@platform/*": ["src/renderer/src/platform/electron/*"]`. Esta config
      continua sendo a do alvo DESKTOP.
    - `tsconfig.web-target.json` (novo, na raiz): estende
      `./tsconfig.web.json` e sobrescreve APENAS o `paths` de `@platform/*`
      para `src/renderer/src/platform/web/*`. Cabeçalho em comentário
      explicando o porquê: sem esta segunda passada, metade da costura nunca é
      compilada — a implementação web existiria só como arquivos soltos no
      `include`, sem NINGUÉM checando que ela satisfaz o contrato do ponto de
      vista de quem importa `@platform/...`. `composite: false` é passado na
      linha de comando (como os outros typechecks do projeto fazem).

    Não rodar `npm run build:web` ainda — a Task 2 é que cria o
    `platform/`, e o alias apontaria para um diretório inexistente.
  </action>
  <verify>
    `npm run typecheck:node` exit 0 (o `vite.config.web.ts` entrou no include e
    compila). `node -e "const p=require('./package.json'); for (const s of ['dev:web','build:web','preview:web','typecheck:web-target','verify:web-bundle']) if(!p.scripts[s]) throw new Error(s)"` exit 0.
    `grep -c "dist-web" .gitignore .prettierignore eslint.config.mjs` >= 1 em cada.
    `npm run typecheck` (os três projetos) continua exit 0 — o desktop não mudou.
  </verify>
  <done>Existe um segundo alvo de build declarado e checado, com as três armadilhas (root do Tailwind, envDir, fs.allow) documentadas no próprio arquivo; nenhum artefato foi gerado ainda e o desktop está intacto.</done>
</task>

<task type="auto">
  <name>Task 2: O contrato de plataforma e a primeira implementação dos dois lados</name>
  <files>src/renderer/src/platform/contract.ts, src/renderer/src/platform/electron/capabilities.ts, src/renderer/src/platform/web/capabilities.ts, src/renderer/src/platform/capabilities.test.ts, electron.vite.config.ts, vitest.config.ts, src/renderer/src/env.d.ts, src/renderer/src/main.tsx, src/renderer/index.html, src/renderer/src/components/Versions.tsx</files>
  <action>
    **`src/renderer/src/platform/contract.ts` — só tipos, zero implementação.**
    Importável pelos dois lados e por qualquer consumidor, sempre pelo caminho
    `@/platform/contract` (nunca por `@platform`, que é o alias que troca de
    alvo). Cabeçalho explicando a regra que sustenta a fase: **nenhum
    `if (isElectron)` em código de feature — quem escolhe é o bundler.** O que
    não existe no alvo não entra no grafo de módulos, e é por isso que o bundle
    da web nunca vê `window.screenshare` nem o worklet de PCM.

    Os quatro tipos, derivados dos 10 arquivos medidos (não inventados):

        /** Perfil da pessoa logada. Deliberadamente igual ao `AuthUserLike` de
         *  `lib/profile-hint.ts:27-32` — que por sua vez é igual ao `User` do
         *  `authkit-js`. É por isso que `profile-hint.ts` NÃO muda nesta fase. */
        export type SessionUser = {
          email: string
          firstName: string | null
          lastName: string | null
          profilePictureUrl: string | null
        }

        export type PlatformCapabilities = {
          /** Qual implementação entrou no bundle. Diagnóstico + sentinela. */
          target: 'electron' | 'web'
          /** String literal única, existente SÓ para scripts/verify-web-bundle.mjs.
           *  É a única prova à prova de minificação de qual lado da costura
           *  entrou no artefato — nomes de função somem, literais de string não. */
          buildTargetSentinel: string
          /** PTT funciona com o app SEM foco (uiohook). Web: false. */
          globalPushToTalk: boolean
          /** O app desenha o próprio seletor de fonte. Web: false (o Chrome desenha). */
          ownScreenSourcePicker: boolean
          /** De onde vem o som do compartilhamento. */
          screenShareAudio: 'process-exclude' | 'browser-surface' | 'none'
          /** Instância única, deep link, bandeja, atualização automática. Web: false. */
          desktopIntegration: boolean
        }

        export type PlatformAuth = { ... }        // ver Plano 10-03
        export type PlatformPushToTalk = { ... }  // ver Plano 10-02
        export type PlatformScreenShare = { ... } // ver Plano 10-02

    Escrever os TRÊS últimos por extenso agora, exatamente como o §3 da
    pesquisa os define, mesmo que as implementações cheguem nos planos 02 e 03
    — é justamente por serem escritos antes que eles funcionam como contrato.
    Assinaturas obrigatórias:

    - `PlatformAuth`: `AuthProvider` (componente), `useSession()`,
      `useConvexAuthAdapter()` (com o `fetchAccessToken({ forceRefreshToken })`
      **exato** que `ConvexProviderWithAuth` exige), `signIn()`, `signOut()`,
      `getProfile(): Promise<SessionUser | null>` (nunca lança) e
      `hasLiveSession(): Promise<boolean>`.
      **O `forceRefreshToken` é obrigatório no tipo, e o comentário precisa
      dizer por quê:** é a alavanca que o `AuthWatchdog` existe para puxar
      (Pitfall 4, `get-convex/convex-backend#259`). Foi por descartá-la que o
      `@convex-dev/workos` foi rejeitado — ele chama `getAccessToken()` sem
      argumento. Registrar isso aqui, no contrato, para ninguém "simplificar"
      depois.
    - `PlatformPushToTalk`: `subscribe(h: { onDown(): void; onUp(): void }): () => void`
      e `setActive(active: boolean): void`.
    - `PlatformScreenShare`: `captureOptions(hint, wantsAudio): ScreenShareCaptureOptions`
      (tipo do `livekit-client`), `startAudio(room: Room): Promise<void>`,
      `stopAudio(): Promise<void>` e `Extras: React.ComponentType`.
      Comentar que `startAudio` no Electron é o 2º passo (WASAPI por processo,
      Fase 8.6) e na web é a LEITURA DE VOLTA do que o Chrome concedeu — não
      um no-op vazio (Plano 10-06).

    **`platform/electron/capabilities.ts`:**

        import type { PlatformCapabilities } from '@/platform/contract'
        export const capabilities: PlatformCapabilities = {
          target: 'electron',
          buildTargetSentinel: 'hydra-platform:electron',
          globalPushToTalk: true,
          ownScreenSourcePicker: true,
          screenShareAudio: 'process-exclude',
          desktopIntegration: true
        }

    **`platform/web/capabilities.ts`:** idêntico em forma, com
    `target: 'web'`, `buildTargetSentinel: 'hydra-platform:web'`,
    `globalPushToTalk: false`, `ownScreenSourcePicker: false`,
    `screenShareAudio: 'browser-surface'`, `desktopIntegration: false`.

    A anotação de tipo explícita (`: PlatformCapabilities`) não é decoração: é
    ela que faz o compilador reprovar uma implementação que divergir do
    contrato, nos dois typechecks.

    **`platform/capabilities.test.ts`** (ambiente edge-runtime, sem docblock
    jsdom): importa as DUAS implementações por caminho relativo explícito
    (`./electron/capabilities` e `./web/capabilities`, nunca por `@platform`,
    que resolveria só um lado) e prova:
    - os dois `target` são diferentes e os dois sentinelas são diferentes;
    - `web.globalPushToTalk === false` e `electron.globalPushToTalk === true`;
    - `web.screenShareAudio === 'browser-surface'`;
    - as duas têm exatamente o mesmo conjunto de chaves (`Object.keys`
      ordenados) — é o teste que pega "alguém acrescentou um campo num lado
      só", que o TypeScript pega no compilador mas o runtime não.

    **Aliases nos outros dois configs:**
    - `electron.vite.config.ts`, bloco `renderer.resolve.alias`: acrescentar
      `'@platform': resolve('src/renderer/src/platform/electron')`. Não tocar
      em mais nada deste arquivo — os comentários longos sobre
      `rollupOptions.external` e `assetsInlineLimit` são documentação viva.
    - `vitest.config.ts`, `resolve.alias`: acrescentar
      `'@platform': resolve('src/renderer/src/platform/electron')`, com
      comentário dizendo por que aponta para o ELECTRON: os 23 testes do
      `ScreenSharePicker` e o resto da suíte existente testam o alvo desktop;
      testes específicos do alvo web importam por caminho relativo
      (`../platform/web/...`), como o `capabilities.test.ts` acima faz.

    **`src/renderer/src/env.d.ts`:** hoje é só
    `/// <reference types="vite/client" />`. Acrescentar a tipagem explícita
    das variáveis embutidas em tempo de build:

        interface ImportMetaEnv {
          readonly VITE_CONVEX_URL?: string
          /** Só o alvo web. No desktop o client id vive em MAIN_VITE_* e é lido
           *  pelo processo main — o renderer do Electron nunca o vê. */
          readonly VITE_WORKOS_CLIENT_ID?: string
        }
        interface ImportMeta { readonly env: ImportMetaEnv }

    **`src/renderer/src/main.tsx`:** acrescentar UMA coisa só — o primeiro
    consumidor real do alias, que é o que dá sentido ao verificador de bundle:

        import { capabilities } from '@platform/capabilities'
        console.info('[platform]', capabilities.target, capabilities.buildTargetSentinel)

    (uma linha de import e uma de log, antes do `createRoot`). Não alterar mais
    nada em `main.tsx` — a montagem do provider de auth é do Plano 10-03.

    **`src/renderer/index.html` — UM arquivo para os dois alvos.**
    Acrescentar `https://api.workos.com` à `connect-src` da CSP existente, com
    um comentário na mesma prosa dos que já estão lá: **é necessário só no alvo
    web** (o `POST /user_management/authenticate` que o `authkit-js` faz do
    navegador), e é inofensivo no desktop, onde quem fala com a WorkOS é o
    processo main — que não passa por CSP nenhuma. Sem esta entrada o Chromium
    recusa a requisição **sem gerar erro de aplicação**: a mesma classe de
    falha que travou a Fase 2 e o motivo de aquele comentário longo existir.
    Não criar um `index.web.html`: duplicaria a estrutura e o comentário da
    CSP, que é documentação viva, e qualquer divergência futura entre os dois
    viraria um bloqueio silencioso.
    **NÃO acrescentar `frame-ancestors` aqui** — a diretiva é ignorada em
    `<meta>` por especificação; ela vira cabeçalho de resposta no Plano 10-04.

    **Apagar `src/renderer/src/components/Versions.tsx`** — é o único outro
    consumidor de `window.electron` e **não é importado por arquivo nenhum**
    (verificado por grep na pesquisa e a reconfirmar antes de apagar). Portar
    seria trabalho para código morto; deixar seria um `window.electron` que a
    guarda de lint do Plano 10-07 teria que contornar.
  </action>
  <verify>
    `grep -rn "Versions" src/renderer/src | grep -v "process.versions"` não retorna nada (nenhum órfão de import).
    `grep -c "api.workos.com" src/renderer/index.html` = 1 e `grep -c "frame-ancestors" src/renderer/index.html` = 0.
    `npm run typecheck` exit 0 nos três projetos (alvo desktop, com `@platform` -> electron).
    `npm run typecheck:web-target` exit 0 (mesmo código, com `@platform` -> web).
    `npx vitest run src/renderer/src/platform` — o novo arquivo passa.
    `npx vitest run` — 39 arquivos, 644 + N testes; **zero** regressão nos 644.
  </verify>
  <done>O contrato existe em tipos, `capabilities` existe nos dois alvos e o compilador prova a conformidade das duas versões; `main.tsx` consome o alias; `Versions.tsx` não existe mais.</done>
</task>

<task type="auto">
  <name>Task 3: O verificador de bundle e o primeiro build web de verdade</name>
  <files>scripts/verify-web-bundle.mjs</files>
  <action>
    Criar `scripts/verify-web-bundle.mjs`, no mesmo molde e com a mesma
    justificativa de `scripts/verify-renderer-runtime.mjs`: **build verde não
    prova nada.** A diferença é o que se afirma sobre o artefato.

    O script varre `dist-web/` (falha alto se o diretório não existir: "rode
    `npm run build:web` antes") e faz QUATRO afirmações, cada uma com a
    mensagem de erro dizendo o que fazer:

    1. **O lado certo entrou.** A string `hydra-platform:web` aparece em algum
       `.js` de `dist-web/`. Se não aparecer, o alias `@platform` não resolveu
       para a implementação web — ou o único consumidor foi removido de
       `main.tsx`.
    2. **O lado errado NÃO entrou.** A string `hydra-platform:electron` não
       aparece em nenhum `.js`. Esta é a afirmação que protege a fase inteira:
       ela quebra no minuto em que alguém importar de
       `@/platform/electron/...` por caminho direto em vez de por `@platform`.
    3. **Nenhuma ponte de Electron sobrou.** Nenhum `.js` contém
       `window.auth`, `window.voice`, `window.screenshare`, `window.electron`
       nem `uiohook`. **ATENÇÃO — no fim deste plano esta afirmação AINDA
       FALHA**, e falhar é o comportamento correto: `useAuth.ts`,
       `useConvexAuthAdapter.ts`, `AuthGate.tsx`, `AuthWatchdog.tsx`,
       `voice-context.tsx` e `ScreenSharePicker.tsx` ainda falam com
       `window.*`. Ela é fechada pelos Planos 10-02 e 10-03 e vira portão de
       build no 10-07. Implementar controlado por flag: sem
       `--strict-bridges`, os achados desta afirmação saem como AVISO (exit 0)
       com a contagem; com a flag, viram erro (exit 1). O Plano 10-07 é quem
       passa a chamar com a flag, dentro do `build:web`.
    4. **O CSS não veio vazio — a armadilha do Tailwind.** Existe ao menos um
       `.css` em `dist-web/`, ele tem mais de 30 KB, e contém as três marcas
       `.h-screen`, `.flex-col` e `is(.dark *)`. Referência medida: o CSS do
       build desktop de hoje tem 62 KB e contém as três. Um `.css` de 2 KB com
       só as variáveis do `:root` é exatamente o sintoma de root de varredura
       errado — app 100% funcional e 100% sem estilo. Mensagem de erro
       apontando explicitamente para `root: 'src/renderer'` em
       `vite.config.web.ts` e para a alternativa `@source "../";` no
       `main.css`.

    Depois de escrever o script, **rodar o build de verdade**:
    `npm run build:web` e em seguida `npm run verify:web-bundle`. As
    afirmações 1, 2 e 4 têm que passar; a 3 tem que AVISAR (com a lista dos
    arquivos), e o número de achados dela vai para o SUMMARY como a linha de
    base que os planos 02 e 03 precisam zerar.
  </action>
  <verify>
    `npm run build:web` exit 0 e `dist-web/index.html` existe.
    `npm run verify:web-bundle` exit 0, imprimindo OK para as afirmações 1, 2 e 4 e AVISO para a 3.
    `npm run verify:web-bundle -- --strict-bridges` exit 1 (a flag existe e morde).
    `git status --porcelain dist-web` vazio (o `.gitignore` pegou).
    `npm run build` (desktop) exit 0 e `npm run verify:renderer-runtime` exit 0 — o alvo antigo não foi tocado.
  </verify>
  <done>Existe prova, sobre o artefato compilado e não sobre intenção, de que o alvo web usa a implementação web, não contém a Electron e tem CSS de verdade; e existe um número de baseline para as pontes que ainda faltam migrar.</done>
</task>

</tasks>

<verification>
**O que passou a ser verificável NESTE ambiente (WSL2), e não era antes:**
- Que o mesmo `src/renderer` constrói para o navegador, com CSS real
  (`npm run build:web` + `verify:web-bundle`).
- Que o alias de plataforma resolve por alvo — os dois typechecks
  (`typecheck:web` e `typecheck:web-target`) compilam o MESMO código com as
  duas implementações.
- Que o `dev:web` sobe. **O Leo consegue abrir `http://localhost:5173` no
  Chrome do Windows** (o WSL2 encaminha `localhost`), e `http://localhost` é
  *secure context* — a partir daqui microfone, `getDisplayMedia` e WebRTC
  passam a funcionar num ciclo de segundos, em vez de um ciclo de
  build + instalador. Este plano não usa isso ainda; ele destrava.

**O que continua exigindo Windows nativo (e não muda com este plano):**
- Nada específico deste plano. Ele é 100% verificável aqui.

**Prova de que o desktop não regrediu** (rodar os quatro, e LER a saída):
1. `npm run typecheck` — três projetos limpos.
2. `npx vitest run` — os 644 testes que existiam continuam passando (38
   arquivos + o novo `capabilities.test.ts`).
3. `npm run build` — `electron-vite build` verde.
4. `npm run verify:renderer-runtime` — o bundle do renderer do Electron
   continua sem o runtime de servidor do Convex.
O único arquivo do desktop com mudança de comportamento é `main.tsx`, e a
mudança é um `console.info` de boot. `Versions.tsx` foi apagado sem
consumidores.
</verification>

<success_criteria>
- `npm run build:web` gera `dist-web/` com `index.html` e um `.css` > 30 KB
  contendo `.h-screen`, `.flex-col` e `is(.dark *)`.
- `npm run verify:web-bundle` aprova as afirmações 1, 2 e 4; a 3 avisa e o
  número fica registrado no SUMMARY.
- `npm run typecheck`, `npm run typecheck:web-target` e `npm run build` todos
  exit 0.
- `npx vitest run` sem nenhuma regressão sobre os 644.
- `src/renderer/src/platform/contract.ts` declara os quatro tipos por extenso,
  incluindo o `forceRefreshToken` com o comentário do Pitfall 4.
- `dist-web` está nos três ignores (git, prettier, eslint).
</success_criteria>

<output>
Ao terminar, criar `.planning/phases/10-versao-web/10-01-SUMMARY.md`.
Registrar obrigatoriamente: (a) o número de achados da afirmação 3 do
verificador (a baseline de pontes a migrar) e quais arquivos são; (b) o tamanho
em bytes do CSS gerado, ao lado dos 62 KB do desktop, como prova numérica de
que o Tailwind varreu o lugar certo.
</output>
