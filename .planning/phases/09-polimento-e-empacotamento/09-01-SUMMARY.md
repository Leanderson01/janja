---
phase: 09-polimento-e-empacotamento
plan: 01
subsystem: infra
tags: [electron, electron-builder, electron-vite, uiohook-napi, packaging, asar, nsis, node-gyp, secrets]

# Dependency graph
requires:
  - phase: 00-bootstrap-do-repo
    provides: "Sintoma original `Error: Electron uninstall` documentado em 00-04-SUMMARY, nunca corrigido na causa raiz"
  - phase: 07-voz
    provides: "uiohook-napi como dependência nativa real (push-to-talk, VOICE-11), risco de empacotamento pendurado desde então"
provides:
  - "postinstall que baixa o binário do Electron de verdade (node node_modules/electron/install.js), corrigindo o `Error: Electron uninstall` de origem"
  - "postinstall que não quebra `npm install` numa máquina sem toolchain de compilação C/C++ (achado novo desta execução, não previsto no plano original)"
  - "electron-builder.yml com uiohook-napi explicitamente fora do asar (asarUnpack) e oneClick: true documentado"
  - "scripts/verify-build-env.mjs — falha alto e cedo em build:win se VITE_CONVEX_URL / VITE_CONVEX_SITE_URL / MAIN_VITE_WORKOS_CLIENT_ID estiverem ausentes"
  - "scripts/verify-no-secrets.mjs — varre out/ (o que vai para dentro do asar) por padrões de segredo antes de electron-builder empacotar"
  - "Confirmação empírica (não só de config): `npx electron-builder --win --dir` rodado neste WSL2 produziu janja.exe com uiohook-napi corretamente fora do asar (app.asar.unpacked), e a etapa de NSIS real só falta `wine`, que não é resolvível dentro deste ambiente"
affects: [09-02-pagina-de-conclusao-de-login, 09-03-checkpoint-instalador-e-regressao-final]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scripts de verificação standalone em scripts/*.mjs, encadeados via npm run antes de electron-builder — falha loud e cedo em vez de produzir artefato quebrado silenciosamente"
    - "Passos de postinstall que podem falhar sem quebrar `npm install` são isolados em wrapper próprio (scripts/postinstall-rebuild.mjs) que sempre sai 0, documentando por que a falha é segura de ignorar"

key-files:
  created:
    - scripts/verify-build-env.mjs
    - scripts/verify-no-secrets.mjs
    - scripts/postinstall-rebuild.mjs
  modified:
    - package.json
    - electron-builder.yml

key-decisions:
  - "postinstall NÃO chama `electron-builder install-app-deps` diretamente mais — chama scripts/postinstall-rebuild.mjs, que roda o mesmo comando mas nunca deixa uma falha dele abortar o `npm install`. Motivo: achado novo, confirmado rodando o comando de verdade (não follow do plano original, que instruía manter o comando tal como estava)."
  - "build:win agora é `verify:build-env && build && verify:no-secrets && electron-builder --win` — dois gates novos, loud-fail, antes de gastar tempo empacotando."
  - "VITE_CONVEX_SITE_URL é exigida por verify:build-env mesmo não sendo lida por nenhum código ainda (chega no Plano 09-02) — decisão deliberada de já blindar o comando de build que vai gerar o instalador real, dado que 09-02 roda antes do checkpoint real do 09-03."

patterns-established:
  - "Nenhum novo padrão de código de aplicação — só de tooling de build."

# Metrics
duration: ~35min
completed: 2026-08-19
---

# Phase 9 Plan 1: Empacotamento binário e módulos nativos Summary

**postinstall corrigido baixa o binário do Electron sem quebrar em máquina sem toolchain C/C++; uiohook-napi confirmado fora do asar por build real gerado neste WSL2 (`--win --dir`); dois gates novos (`verify:build-env`, `verify:no-secrets`) bloqueiam `build:win` antes de gerar um instalador quebrado ou vazado**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-19
- **Tasks:** 2 planejadas + 1 deviation crítico (postinstall) + 2 adições pedidas explicitamente pelo orquestrador (env-loud-fail, secret-scan em output)
- **Files modified:** 2 (`package.json`, `electron-builder.yml`)
- **Files created:** 3 (`scripts/verify-build-env.mjs`, `scripts/verify-no-secrets.mjs`, `scripts/postinstall-rebuild.mjs`)

## Accomplishments

- `postinstall` agora baixa o binário do Electron de verdade
  (`node node_modules/electron/install.js`), fechando o `Error: Electron uninstall`
  documentado em `00-04-SUMMARY.md` desde a Fase 0 — causa raiz confirmada em
  `09-RESEARCH.md` §1 (electron-vite usa `require.resolve`, não `require`, e nunca
  dispara o download preguiçoso).
- **Achado novo, não previsto no plano nem no 09-RESEARCH.md**: `electron-builder
  install-app-deps` (o script antigo de postinstall) delega para `@electron/rebuild`,
  cujo detector de prebuild `prebuildify` só reconhece nomes de arquivo
  `node.napi.node` / `electron.napi.node` / `electron.abi<N>.node` — mas o
  `uiohook-napi` publica `prebuilds/<platform>-<arch>/uiohook-napi.node` (nome
  diferente). Isso faz `@electron/rebuild` nunca achar o prebuild já existente e
  cair para recompilação via `node-gyp`, que falha em qualquer máquina sem
  toolchain C/C++ completo. Confirmado rodando o comando de verdade neste worktree:
  falhou por falta de `X11/keysym.h` no WSL2, e o mesmo aconteceria no Windows sem
  Visual Studio Build Tools + Python. `npmRebuild: false` (já presente no
  `electron-builder.yml`) **não evita isso** — esse flag só é lido pelo pipeline de
  empacotamento real (`packager.js`), nunca pelo comando standalone
  `install-app-deps`. Ver "Deviations" abaixo para o fix aplicado.
- `electron-builder.yml`: `uiohook-napi` explicitamente fora do asar
  (`asarUnpack: node_modules/uiohook-napi/**`), `oneClick: true` documentado
  explicitamente no bloco `nsis`.
- **Confirmação empírica, não só de configuração**: rodei
  `npx electron-builder --win --dir --publish=never` neste WSL2 (com valores
  fake das três env vars, só para o build não abortar no gate novo) e o build
  **completou com sucesso**, produzindo `dist/win-unpacked/janja.exe`. Confirmei
  com `npx asar list` + `npx asar extract-file` que `uiohook-napi.node` (o binário
  win32-x64) está listado no `app.asar` só como referência "unpacked" — o conteúdo
  real (173KB) só existe em `app.asar.unpacked/node_modules/uiohook-napi/prebuilds/
  win32-x64/uiohook-napi.node`, ou seja, exatamente fora do asar como Task 2 exigia.
  A tentativa de gerar o instalador NSIS completo (`.exe`) parou em
  `spawn wine ENOENT` — WSL2 não tem `wine` instalado, e esse passo do
  electron-builder precisa dele para rodar o compilador NSIS a partir de Linux.
  Essa é uma limitação de ambiente conhecida, não um problema de configuração —
  a prova final do instalador acontece no checkpoint humano do Plano 09-03, numa
  máquina Windows de verdade.
- Dois gates novos em `build:win`, pedidos explicitamente pelo orquestrador além do
  escopo original do plano (ver "Deviations"): `verify:build-env` (falha alto e
  cedo se `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` ou
  `MAIN_VITE_WORKOS_CLIENT_ID` estiverem vazias — testado, funciona) e
  `verify:no-secrets` (varre `out/` por padrões de segredo antes de empacotar —
  testado com uma string `sk_live_...` injetada de propósito, detectou e bloqueou
  corretamente, depois removida).
- Confirmado, via grep no repositório inteiro (fora de `node_modules`/`.git`/`out`/
  `dist`), que nenhuma ocorrência de `sk_`, `WORKOS_API_KEY` ou `LIVEKIT_API_SECRET`
  aparece como valor literal — todas as ocorrências são leituras via
  `process.env.X` (padrão correto, todas em `convex/*`, que roda no servidor do
  Convex e nunca é empacotado pelo Electron), um comentário explicando a ausência
  proposital da chave, ou fixtures de teste com valor fake.

## Task Commits

Este ambiente de execução está sob a diretiva explícita `<NO_GIT>` do orquestrador —
**nenhum commit foi criado**. Todas as mudanças estão no working tree, não
commitadas, para o orquestrador revisar e commitar.

Arquivos alterados/criados (ver `git status`/`git diff` no worktree):
- `package.json` — modificado
- `electron-builder.yml` — modificado
- `scripts/verify-build-env.mjs` — criado
- `scripts/verify-no-secrets.mjs` — criado
- `scripts/postinstall-rebuild.mjs` — criado

## Files Created/Modified

- `package.json` — `postinstall` corrigido para baixar o binário do Electron e
  delegar o rebuild de dependências nativas a um wrapper não-bloqueante; três
  scripts novos (`verify:build-env`, `verify:no-secrets`); `build:win` agora
  encadeia os dois gates novos antes de `electron-builder --win`.
- `electron-builder.yml` — `asarUnpack` cobrindo `node_modules/uiohook-napi/**`;
  `oneClick: true` explícito no bloco `nsis`.
- `scripts/verify-build-env.mjs` — usa `loadEnv` do próprio Vite para checar
  exatamente o que o build real vai enxergar; falha com mensagem em português
  listando as variáveis faltando.
- `scripts/verify-no-secrets.mjs` — varre recursivamente `out/` (o que
  `electron-builder` empacota verbatim dentro do asar) procurando por
  `sk_live_`/`sk_test_` e os nomes literais `WORKOS_API_KEY`/`LIVEKIT_API_SECRET`.
- `scripts/postinstall-rebuild.mjs` — roda `electron-builder install-app-deps` sem
  deixar uma falha dele abortar `npm install`; documenta a causa raiz confirmada
  (detector de prebuild do `@electron/rebuild` não reconhece o nome de arquivo que
  `uiohook-napi` usa) diretamente no cabeçalho do arquivo.

## Decisions Made

- **postinstall não remove `electron-builder install-app-deps` do encadeamento**
  (respeitando a instrução explícita do plano original), mas o isola num wrapper
  que nunca falha o processo inteiro — resolve a tensão entre "manter o comando
  para o caso geral de futuras dependências nativas que precisem de rebuild" (razão
  do plano) e "não pode quebrar `npm install` numa máquina limpa" (a própria
  premissa da Fase 9), com um achado novo confirmado por execução real que o plano
  original não previu.
- **`VITE_CONVEX_SITE_URL` incluída no gate `verify:build-env` mesmo não sendo lida
  por nenhum código ainda** (essa leitura chega só no Plano 09-02). Decisão
  deliberada, pedida explicitamente pelo orquestrador: o comando `build:win` que vai
  gerar o instalador de verdade só roda depois que 09-02 e 09-03 também tiverem
  rodado, então blindar o gate desde já (em vez de esperar 09-02 para adicionar a
  checagem) evita esquecer de reforçar isso depois.
- **Verificação de segredo estendida para além do grep manual do Task 2**: além do
  grep de código-fonte pedido no plano (rodado e sem violações), adicionei
  `verify:no-secrets` como gate automatizado no pipeline de build, rodando contra o
  bundle já compilado (`out/`) — o que de fato vai para dentro do asar — em vez de
  depender só de uma varredura manual de texto feita uma vez durante a execução
  deste plano.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `electron-builder install-app-deps` quebra `npm install` numa máquina sem toolchain C/C++, mesmo com `npmRebuild: false` configurado**

- **Found during:** Verificação do Task 1 (rodar `npm run postinstall` duas vezes
  seguidas, conforme o `<verify>` do próprio plano pedia)
- **Issue:** Rodar `npm run postinstall` com o script do plano original
  (`node node_modules/electron/install.js && electron-builder install-app-deps`)
  falhava com `Error: \`make\` failed with exit code: 2` /
  `fatal error: X11/keysym.h: No such file or directory`. Investigado lendo o
  código-fonte de `app-builder-lib` (mesmo padrão de rigor do `09-RESEARCH.md`):
  `install-app-deps` (CLI standalone) chama `installOrRebuild` em
  `app-builder-lib/out/util/yarn.js`, que nunca consulta `config.npmRebuild` — esse
  flag só é lido em `packager.js`, usado pelo pipeline de empacotamento real
  (`electron-builder --win`), não pelo comando standalone de postinstall. E dentro
  de `@electron/rebuild`, o detector `Prebuildify.findPrebuiltModule()`
  (`module-type/prebuildify.js`) só reconhece os nomes `node.napi.node`,
  `electron.napi.node` ou `electron.abi<N>.node` — mas `uiohook-napi` publica
  `prebuilds/<platform>-<arch>/uiohook-napi.node`, nome que o detector não bate,
  então ele nunca encontra o prebuild e cai para compilar via `node-gyp`.
- **Fix:** `postinstall` agora chama `scripts/postinstall-rebuild.mjs`, que roda o
  mesmo `electron-builder install-app-deps` mas captura o código de saída e nunca
  propaga falha — sempre sai `0`, imprimindo um aviso explicando por que é seguro
  ignorar (confirmado que `require('uiohook-napi')` continua funcionando depois da
  falha, porque a tentativa de rebuild falhada não apaga nem corrompe o prebuild já
  publicado). O comando continua rodando (não removido), preservando a razão
  original do plano de cobrir uma futura dependência nativa que precise de rebuild
  de verdade.
- **Files modified:** `package.json` (script `postinstall`),
  `scripts/postinstall-rebuild.mjs` (novo)
- **Verification:** `npm run postinstall` rodado duas vezes seguidas, saída `0` nas
  duas, e `node -e "require('uiohook-napi')"` carrega com sucesso depois de cada
  execução (`Object.keys` retorna `EventType`, `WheelDirection`, `UiohookKey`,
  `uIOhook`).
- **Committed in:** Não commitado (diretiva `<NO_GIT>` do orquestrador) —
  mudanças em `package.json` e `scripts/postinstall-rebuild.mjs` no working tree.

### Adições pedidas explicitamente pelo orquestrador (fora do escopo original do plano, dentro do escopo da fase)

O orquestrador pediu explicitamente, além das duas tasks do plano: (1) falha loud
em build time se as três env vars faltarem, e (2) um check automatizado (não só
manual) de que nenhum segredo chega ao pacote. Nenhuma das duas mexe em
`convex/`, lógica de voz, ou `contextIsolation`/`nodeIntegration`.

**2. [Pedido explícito do orquestrador] `scripts/verify-build-env.mjs`**
- Gate novo, encadeado antes de `electron-vite build` em `build:win`. Usa
  `loadEnv` do próprio Vite (mesma fonte de verdade que o build real usa) para
  checar `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, `MAIN_VITE_WORKOS_CLIENT_ID`.
  Testado: falha com mensagem clara sem `.env.local` presente; passa com as três
  variáveis setadas via `process.env`.

**3. [Pedido explícito do orquestrador] `scripts/verify-no-secrets.mjs`**
- Gate novo, encadeado depois de `electron-vite build` e antes de
  `electron-builder --win` em `build:win`. Varre `out/` (o que
  `electron-builder` empacota verbatim dentro do asar) por
  `sk_live_`/`sk_test_`/`WORKOS_API_KEY`/`LIVEKIT_API_SECRET`. Testado
  positivo e negativo: passa contra o `out/` real do projeto (nenhuma violação);
  detecta e bloqueia corretamente quando uma string `sk_live_...` de teste foi
  injetada de propósito num arquivo de `out/` (depois removida).

---

**Total deviations:** 1 auto-fixed (blocking) + 2 adições pedidas explicitamente
pelo orquestrador, fora do escopo do `PLAN.md` original mas dentro do objetivo da
fase.
**Impact on plan:** O deviation de Rule 3 era necessário para o `must_have` do
próprio plano funcionar de verdade ("rodar `npm install` sozinho já baixa o
binário do Electron... sem exigir passo manual") — sem o fix, `npm install`
continuaria quebrando, só que com um erro diferente do que a Fase 0 documentou. As
duas adições do orquestrador são gates de proteção adicionais, sem tocar em nenhum
arquivo fora de `package.json` + `scripts/` novos. Nenhum scope creep em código de
aplicação.

## Issues Encountered

Nenhum além do já documentado em "Deviations" acima. A tentativa de gerar o
instalador NSIS completo (`--win` sem `--dir`) parou em `spawn wine ENOENT` —
WSL2 não tem `wine` instalado. Isso é esperado e documentado no próprio plano
como limitação de ambiente conhecida, não um problema de configuração: o modo
`--dir` (sem NSIS) já provou que o `asarUnpack` funciona de ponta a ponta; a
etapa que falta (compilar o instalador `.exe` de fato) só roda com `wine` em
Linux/WSL2, ou nativamente numa máquina Windows — que é exatamente o que o
checkpoint humano do Plano 09-03 vai fazer.

## User Setup Required

Nenhuma configuração de serviço externo. O que o usuário precisa ter em mãos
**antes** de rodar `npm run build:win` na máquina Windows (ver "Comando exato"
abaixo) é puramente local: um arquivo `.env.local` na raiz do projeto com as três
variáveis. Nenhuma delas é secreta.

## Next Phase Readiness

- `postinstall` e `electron-builder.yml` prontos para o checkpoint humano do
  Plano 09-03 (build real numa máquina Windows).
- `VITE_CONVEX_SITE_URL` já é exigida pelo gate `verify:build-env`, mas ainda não
  é lida por nenhum código de aplicação — isso é resolvido pelo Plano 09-02
  (`src/main/auth/auth.ts` passa a montar `REDIRECT_URI` a partir dela). Até
  09-02 rodar, `verify:build-env` vai barrar `build:win` mesmo que o app não
  precise da variável ainda — comportamento intencional (blindagem antecipada),
  registrado aqui para não ser confundido com um bug se alguém rodar `build:win`
  antes de 09-02.
- Nenhum bloqueio novo identificado para 09-02 ou 09-03.

---

## Comando exato para o usuário rodar no Windows

```
npm run build:win
```

Isso roda `verify:build-env && npm run build (typecheck + electron-vite build) &&
verify:no-secrets && electron-builder --win` — um único comando, sem passos
manuais extras (o `npm install` inicial dispara sozinho o download do binário do
Electron, corrigido nesta execução).

**O que precisa estar em vigor ANTES de rodar esse comando:**

1. **Node.js instalado** na máquina Windows (qualquer versão LTS recente já serve
   — este projeto usa Node 22 em desenvolvimento).
2. **`npm install` já rodado** na raiz do projeto (isso já baixa o binário do
   Electron sozinho, com a correção desta execução — não precisa mais do passo
   manual `node node_modules/electron/install.js` que a Fase 0 documentou).
3. **Um arquivo `.env.local` na raiz do projeto**, com as três variáveis abaixo
   preenchidas com valores reais (nenhuma é secreta — ver `.env.local.example`
   para o formato exato):
   - `MAIN_VITE_WORKOS_CLIENT_ID`
   - `VITE_CONVEX_URL`
   - `VITE_CONVEX_SITE_URL`

   Se qualquer uma faltar, `npm run build:win` para imediatamente com uma
   mensagem em português listando exatamente qual falta — não produz um
   instalador quebrado silenciosamente.
4. **Nada além disso.** Não precisa de Visual Studio Build Tools, Python, nem
   nenhum toolchain de compilação C/C++ — o achado desta execução confirma que
   `uiohook-napi` (push-to-talk) já embute o binário `win32-x64` pronto dentro do
   próprio pacote, e o postinstall corrigido não tenta mais (de forma bloqueante)
   recompilar nada.

**O que este plano NÃO verificou** (fica para o checkpoint humano do Plano
09-03, que roda numa máquina Windows de verdade): se o instalador `.exe` gerado
de fato instala e roda sem erro, se o push-to-talk funciona depois de instalado
via o binário `app.asar.unpacked`, e se o app conecta corretamente aos serviços
reais (Convex/WorkOS/LiveKit) com valores de produção em vez dos valores fake
usados nos testes desta execução.

---
*Phase: 09-polimento-e-empacotamento*
*Completed: 2026-08-19*
