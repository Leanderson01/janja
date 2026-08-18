---
phase: 00-bootstrap-do-repo
plan: 01
subsystem: infra
tags: [electron, electron-vite, react, typescript, scaffold]

# Dependency graph
requires: []
provides:
  - Estrutura inicial do app Electron (package.json, electron.vite.config.ts, tsconfig*.json)
  - Árvore src/main/, src/preload/, src/renderer/ (template react-ts do electron-vite)
  - Electron pinado exatamente em 43.4.0 (sem ^/~)
  - Build de produção funcional (npm run build gera out/main, out/preload, out/renderer)
affects: [01-livekit-na-vps, 03-shell-da-ui, todas as fases seguintes que escrevem código em src/]

# Tech tracking
tech-stack:
  added: [electron@43.4.0, electron-vite@5.0.0, electron-builder@26.15.3, react@19.2.1, typescript@5.9.3, vite@7.3.6]
  patterns: [scaffold-em-diretório-temporário-fora-do-repo, cp -rn para cópia sem sobrescrita silenciosa]

key-files:
  created: [package.json, electron.vite.config.ts, electron-builder.yml, tsconfig.json, tsconfig.node.json, tsconfig.web.json, src/main/index.ts, src/preload/index.ts, src/renderer/src/App.tsx]
  modified: []

key-decisions:
  - "Scaffolder rodou inteiro em /tmp/janja-scaffold-<pid>, nunca dentro do repo — cinto-e-suspensório contra o incidente anterior"
  - "Electron pinado com npm pkg set (não edição manual de JSON) em 43.4.0 exato"
  - "cp -rn usado na cópia final — teria falhado ruidosamente em vez de sobrescrever, se algum arquivo já existisse"

patterns-established:
  - "Qualquer scaffolder interativo futuro no projeto deve seguir o mesmo padrão: gerar fora do repo, validar, copiar com cp -rn, verificar integridade antes de prosseguir"

# Metrics
duration: 6min
completed: 2026-08-18
---

# Phase 0 Plan 01: Scaffold seguro do app Electron Summary

**App Electron + React + TypeScript scaffolded via electron-vite (template react-ts) em diretório temporário isolado, copiado com segurança para o repo, Electron pinado exatamente em 43.4.0, build de produção verificado tanto no working tree quanto num clone limpo.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-18T19:19:35Z
- **Completed:** 2026-08-18T19:25:28Z
- **Tasks:** 2/2
- **Files modified:** 32 criados na Task 1 (scaffold) + 2 na Task 2 (package.json, package-lock.json)

## Accomplishments
- Scaffold gerado 100% fora do repo (`/tmp/janja-scaffold-<pid>`), com `npm create @quick-start/electron@latest janja -- --template react-ts --skip < /dev/null` — nenhum prompt interativo apareceu, comando saiu limpo sem precisar de `yes`/`--force`/`--yes`
- Validação do `package.json` gerado (`name == "janja"`, tamanho razoável) rodada **antes** de qualquer cópia para o repo real
- Defesa extra confirmada: scaffold não gerou nenhum diretório com nome `.git`/`.planning`/`docs`/`.claude`
- Cópia feita com `cp -rn` (nunca sobrescreve silenciosamente) — nenhum arquivo pulado, porque o repo realmente não tinha `package.json`/`src/` antes
- Integridade pós-cópia verificada: `.git`, `.planning/`, `docs/`, `.claude/` intactos; `git status --porcelain | grep '^D'` vazio (zero arquivos deletados)
- Electron pinado exatamente em `43.4.0` via `npm pkg set devDependencies.electron=43.4.0` (confirmado sem `^`)
- `npm install` completo, `node -e "require('electron/package.json').version"` imprime `43.4.0` exatamente
- `npm run build` (typecheck + electron-vite build) passa com exit code 0, gerando `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html`
- **Verificação extra além do exigido pelo plano:** cloned o repo para um diretório limpo (`git clone` local, fora do repo de trabalho) e rodei `npm install && npm run build` de novo — passou sem erro, confirmando que o commit realmente contém tudo que é necessário, sem depender de estado local não commitado

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold em diretório temporário e cópia segura para o repo** - `9709f15` (feat)
2. **Task 2: Pin exato do Electron, install e build smoke-test** - `ed92f9a` (feat)

_Nenhum commit adicional de metadata foi feito por este agente — STATE.md é responsabilidade do orquestrador, conforme instruído._

## Files Created/Modified
- `package.json` - manifest do app, scripts dev/build/typecheck, electron pinado em 43.4.0
- `package-lock.json` - lockfile do install
- `electron.vite.config.ts` - config dos três sub-builds (main/preload/renderer)
- `electron-builder.yml`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json` - config de build/tooling
- `src/main/index.ts` - processo main (janela + IPC básico, sem single-instance-lock ainda — isso é 00-03)
- `src/preload/index.ts`, `src/preload/index.d.ts` - contextBridge mínimo
- `src/renderer/index.html`, `src/renderer/src/{main.tsx,App.tsx,env.d.ts}` - renderer React
- `.gitignore`, `.editorconfig`, `.prettierrc.yaml`, `.prettierignore`, `.vscode/*`, `README.md`, `build/*`, `resources/*`, `eslint.config.mjs` - tooling/config padrão do template

## Decisions Made
- Nenhuma decisão além das já pré-definidas no plano e no research (comando de scaffold, versão do Electron, estratégia de diretório temporário) — plano seguido literalmente.

## Deviations from Plan

None - plano executado exatamente como escrito. Nenhuma das regras de deviation (bug, funcionalidade crítica faltando, blocker, mudança arquitetural) foi acionada — o scaffold e o build funcionaram de primeira, sem necessidade de correções.

## Issues Encountered

Nenhum problema durante a execução das duas tasks do plano em si. Uma observação **fora do escopo do plano**, feita durante exploração adicional pedida pelo contexto (verificar se a GUI do Electron abre em WSL2):

- O binário nativo do Electron **não** é baixado durante `npm install` — o pacote `electron@43.4.0` não declara `postinstall` próprio; o binário só é baixado sob demanda, na primeira vez que algo faz `require('electron')` de verdade (não apenas `require('electron/package.json')`, que só lê o JSON e não dispara o download). Isso significa que `npm run dev` falha na primeira tentativa com `Error: Electron uninstall`, porque `electron-vite` lê `node_modules/electron/path.txt` diretamente em vez de disparar o mecanismo de download lazy do próprio pacote `electron`.
  - **Não é um bug do scaffold nem do pin** — `npm run build` (que é o critério de aceite real do plano) nunca precisa do binário, só dos módulos JS/TS, e por isso passou normalmente, inclusive no clone limpo.
  - Isso não afeta nenhum success criterion do plano (build é o smoke-test exigido, não dev/GUI) e **não modifiquei nenhuma configuração de produção** por causa disso, conforme instruído.
  - Depois de forçar o download manualmente (`node -e "require('electron')"`), tentei `npm run dev` de novo: o processo Electron iniciou e ficou rodando até o timeout de 15s ser atingido (não crashou sozinho), mas logou `Network service crashed or was terminated, restarting service` — um sintoma conhecido de sandbox/GPU em ambientes WSL2/WSLg. **Não consegui confirmar visualmente se uma janela realmente apareceu** (não tenho como capturar screenshot do ambiente gráfico a partir daqui). Isso é consistente com o que `00-RESEARCH.md` §5 já previa como não-verificável fora de uma máquina Windows nativa — registro aqui apenas para honestidade, não é um bloqueio da fase.
  - Nenhum processo Electron ficou pendurado depois do teste (verificado com `pgrep`/`ps` — limpo).
  - Recomendação para fases futuras: se `npm run dev` for necessário como parte de um critério de aceite futuro (não é o caso deste plano), considerar rodar `npx electron --version` ou similar uma vez após `npm install` para forçar o download do binário, e validar abertura de janela numa máquina Windows nativa quando esse critério existir.

## User Setup Required

None - nenhuma configuração de serviço externo necessária nesta plano.

## Next Phase Readiness

- Estrutura base do app Electron existe na raiz do repo, `npm install && npm run build` funciona de ponta a ponta (verificado tanto no working tree quanto num clone limpo separado)
- `.git`, `.planning/`, `docs/`, `.claude/` seguem intactos — o incidente anterior não se repetiu
- Pronto para 00-02/00-03 (próximos planos da fase, incluindo `requestSingleInstanceLock` + `contextIsolation` explícito, ainda não implementados neste plano — por design, ver `<done>` da Task 1)
- Concern registrado (não bloqueante): binário nativo do Electron não baixa durante `npm install`, só sob demanda — relevante se algum plano futuro depender de `npm run dev` funcionar imediatamente após clone+install sem passo extra

---
*Phase: 00-bootstrap-do-repo*
*Completed: 2026-08-18*
