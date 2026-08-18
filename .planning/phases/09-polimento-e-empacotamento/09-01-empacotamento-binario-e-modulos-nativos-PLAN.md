---
phase: 09-polimento-e-empacotamento
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - electron-builder.yml
autonomous: true

must_haves:
  truths:
    - "Clonar o repo do zero e rodar `npm install` sozinho já baixa o binário do Electron, sem exigir o passo manual `node node_modules/electron/install.js` que a Fase 0 precisou fazer à mão"
    - "O binário nativo do uiohook-napi (push-to-talk, VOICE-11) sai do asar no pacote gerado, em vez de ficar preso num arquivo que o Electron não consegue abrir em runtime"
    - "Nenhuma string de segredo (chave de API da WorkOS, LIVEKIT_API_SECRET) aparece em nenhum arquivo que entra no pacote final"
  artifacts:
    - path: "package.json"
      provides: "postinstall que baixa o binário do Electron E recompila dependências nativas para a ABI do Electron, nessa ordem"
      contains: "node_modules/electron/install.js"
    - path: "electron-builder.yml"
      provides: "asarUnpack cobrindo uiohook-napi + oneClick explícito"
      contains: "uiohook-napi"
  key_links:
    - from: "package.json (postinstall)"
      to: "node_modules/electron/dist/ (binário baixado)"
      via: "node node_modules/electron/install.js executado a cada npm install"
      pattern: "electron/install.js"
---

<objective>
Fechar as duas dívidas de empacotamento já registradas em fases anteriores e nunca
resolvidas: o `npm install` que não baixa o binário do Electron (00-04-SUMMARY) e o risco
não verificado de o módulo nativo `uiohook-napi` (push-to-talk, Fase 7) sobreviver ao
empacotamento (nota de dependência cruzada no ROADMAP, Fase 7). Nenhuma das duas é
hipotética — a causa raiz de ambas foi confirmada lendo o código-fonte das ferramentas
envolvidas (`09-RESEARCH.md` §1 e §2), não assumida.

Purpose: sem isso, toda pessoa que clonar o repo (inclusive quem for gerar o instalador)
bate no mesmo `Error: Electron uninstall` que a Fase 0 já bateu, e o instalador final,
mesmo se gerado com sucesso, pode produzir um app onde push-to-talk simplesmente não
carrega — sem nenhum erro visível até alguém apertar a tecla e nada acontecer.
Output: `postinstall` corrigido; `electron-builder.yml` com o módulo nativo
explicitamente fora do asar; confirmação estática de que nenhum segredo entra no pacote.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/09-polimento-e-empacotamento/09-RESEARCH.md
@.planning/phases/00-bootstrap-do-repo/00-04-SUMMARY.md
@package.json
@electron-builder.yml

# Este plano roda em WSL2. Empacotar de verdade para Windows (gerar o .exe e instalar
# numa máquina limpa) só é verificável no checkpoint humano do Plano 09-03 — este plano
# corrige a configuração e verifica o que dá para verificar sem uma máquina Windows.
#
# uiohook-napi só existe em node_modules depois que a Fase 7 (Plano 07-06) rodar. Se este
# plano executar antes disso por algum motivo, a Tarefa 2 ainda escreve a config correta
# (asarUnpack não falha por o caminho não existir ainda), mas o grep de verificação de
# `node_modules/uiohook-napi` não vai achar nada — não é uma falha deste plano, é uma
# fase ainda não executada. Reportar isso no SUMMARY se acontecer.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Corrigir o postinstall para baixar o binário do Electron</name>
  <files>package.json</files>
  <action>
    Trocar o script `postinstall` atual:
    ```json
    "postinstall": "electron-builder install-app-deps"
    ```
    por:
    ```json
    "postinstall": "node node_modules/electron/install.js && electron-builder install-app-deps"
    ```

    Causa raiz confirmada em `09-RESEARCH.md` §1: o pacote `electron` nesta versão não
    tem `postinstall` próprio (confirmado no `package.json` publicado da versão pinada),
    e `electron-vite dev` localiza o binário via `require.resolve('electron')` — que
    resolve caminho, não executa o módulo — então nunca dispara o download preguiçoso que
    `require('electron')` teria disparado. Sem `path.txt` presente,
    `electron-vite` lança exatamente `Error: Electron uninstall`, o sintoma registrado em
    `00-04-SUMMARY.md`. `electron-builder install-app-deps` (o script antigo) resolve um
    problema diferente — recompilar dependências nativas para a ABI do Electron — e nunca
    baixou o binário do Electron em si.

    Não remover `electron-builder install-app-deps` do encadeamento: ele continua
    necessário para o caso geral de módulos nativos que precisem de rebuild (mesmo que o
    `uiohook-napi` especificamente não precise — ver Task 2).
  </action>
  <verify>
    Rodar `node node_modules/electron/install.js` diretamente (sem apagar nada do
    ambiente atual — o binário já instalado faz o script checar `isInstalled()` e sair
    rápido, sem rebaixar nada). Confirmar saída sem erro e `node_modules/electron/path.txt`
    presente com conteúdo `electron` (Linux) — em Windows seria `electron.exe`. Rodar
    depois `npm run postinstall` inteiro (os dois comandos encadeados) e confirmar código
    de saída 0.
  </verify>
  <done>`package.json` com o postinstall corrigido; rodar o script duas vezes seguidas
  não produz erro (idempotente); `path.txt` existe e aponta pro executável certo da
  plataforma atual.</done>
</task>

<task type="auto">
  <name>Task 2: Módulo nativo fora do asar, NSIS explícito, verificação de segredo</name>
  <files>electron-builder.yml</files>
  <action>
    **`asarUnpack`**: adicionar `node_modules/uiohook-napi/**` à lista já existente
    (que hoje só tem `resources/**`):
    ```yaml
    asarUnpack:
      - resources/**
      - node_modules/uiohook-napi/**
    ```
    Motivo (detalhado em `09-RESEARCH.md` §2): o `uiohook-napi` já embute o binário
    Windows x64 dentro do próprio pacote npm (prebuild via `prebuildify`, confirmado
    inspecionando o tarball publicado) — não precisa de rebuild nem de rede na hora do
    empacotamento. O risco real é o Electron não conseguir abrir um `.node` de dentro de
    um `asar`. O electron-builder v26 já teria feito isso sozinho via detecção automática
    (`smartUnpack`, ligado por padrão), mas para o único requisito desta fase que depende
    de um módulo nativo (VOICE-11), deixar explícito em vez de confiar só na heurística
    automática — mudança de uma linha, remove uma dúvida.

    **`npmRebuild: false`**: manter como está (já presente no arquivo). Não há nada em
    C++ pra recompilar num pacote N-API com prebuild embutido, e desligar isso evita o
    electron-builder tentar rodar `node-gyp rebuild` sem toolchain de compilação
    disponível no WSL2.

    **NSIS**: adicionar `oneClick: true` explicitamente ao bloco `nsis:` existente (hoje
    o arquivo não declara essa chave e herda o default, que já é `true` — confirmado em
    `09-RESEARCH.md` §3 lendo a interface `NsisOptions` do electron-builder). Não é uma
    mudança de comportamento, é documentar a decisão que já está em vigor: instalador de
    um clique, sem tela de escolha de diretório, roda o app sozinho ao terminar
    (`runAfterFinish`, também default `true`), com atalho de área de trabalho (já
    presente: `createDesktopShortcut: always`). Resultado esperado: "poucos cliques numa
    máquina limpa, sem exigir conhecimento técnico" (critério 1 da Fase 9) sem exigir
    nenhuma tela de configuração do instalador.

    **Verificação de segredo**: confirmar que o bloco `files` já existente continua
    excluindo `.env`/`.env.*` (`'!{.env,.env.*,.npmrc,pnpm-lock.yaml}'` — já está lá, não
    mexer se já cobre isso) e rodar uma varredura de texto no repositório inteiro (fora de
    `node_modules`, `.git`, `out`, `dist`) procurando por `sk_`, `WORKOS_API_KEY`,
    `LIVEKIT_API_SECRET` como literais de código (não como nome de variável de ambiente
    lida de `process.env`, que é o padrão correto e já usado no projeto). Se algo bater,
    reportar no SUMMARY sem tentar corrigir sozinho — isso seria um problema de outra
    fase, não desta.
  </action>
  <verify>
    `grep -n "uiohook-napi" electron-builder.yml` confirma a linha adicionada.
    `grep -n "oneClick" electron-builder.yml` confirma a chave explícita.
    `grep -rn "sk_\|WORKOS_API_KEY\|LIVEKIT_API_SECRET" --include="*.ts" --include="*.tsx" --include="*.yml" --include="*.yaml" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out --exclude-dir=dist .`
    não retorna nenhuma ocorrência como valor literal (comentários explicando que a
    variável NÃO existe, como em `.env.local.example`, não contam como violação — ler o
    contexto antes de marcar como problema).
  </verify>
  <done>`electron-builder.yml` com `asarUnpack` cobrindo `uiohook-napi`, `oneClick: true`
  explícito, e confirmação registrada no SUMMARY de que nenhum segredo aparece como
  literal em nenhum arquivo versionado.</done>
</task>

</tasks>

<verification>
- `npm run build` (typecheck + `electron-vite build`) continua passando depois das
  mudanças — nenhuma delas toca em código de aplicação, só `package.json` e
  `electron-builder.yml`.
- Tentativa best-effort de `npx electron-builder --win --dir --publish=never` a partir do
  WSL2: se rodar com sucesso, ótimo sinal antecipado; se falhar por falta de ferramenta
  específica de Windows (ex: ausência de Wine para alguma etapa), documentar a falha
  exata no SUMMARY como limitação conhecida do ambiente — a prova real acontece no
  Plano 09-03, numa máquina Windows de verdade. Não bloquear este plano por essa
  tentativa falhar.
</verification>

<success_criteria>
Qualquer pessoa que clonar o repo do zero e rodar `npm install` tem o binário do Electron
baixado automaticamente, sem o passo manual que a Fase 0 precisou documentar. A
configuração de empacotamento declara explicitamente que o módulo nativo do
push-to-talk sobrevive ao asar, e nenhum segredo de servidor está embutido em nenhum
arquivo que o instalador empacota.
</success_criteria>

<output>
After completion, create `.planning/phases/09-polimento-e-empacotamento/09-01-SUMMARY.md`
</output>
