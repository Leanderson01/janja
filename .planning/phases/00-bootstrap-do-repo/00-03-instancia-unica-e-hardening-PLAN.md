---
phase: 00-bootstrap-do-repo
plan: 03
type: execute
wave: 2
depends_on: ["00-01"]
files_modified:
  - src/main/index.ts
  - README.md
autonomous: true

must_haves:
  truths:
    - "app.requestSingleInstanceLock() é chamado antes de qualquer criação de janela; se retornar false, app.quit() é chamado imediatamente"
    - "Handler 'second-instance' está registrado antes de app.whenReady() resolver, e foca/restaura a janela existente"
    - "webPreferences da janela principal declara contextIsolation: true e nodeIntegration: false explicitamente (não depende do default silencioso do Electron)"
    - "README documenta como rodar em dev no WSL2/WSLg e deixa explícito o que só é validável numa máquina Windows nativa"
  artifacts:
    - path: "src/main/index.ts"
      provides: "Single-instance lock + second-instance handler + webPreferences endurecido"
      contains: "requestSingleInstanceLock"
    - path: "README.md"
      provides: "Seção de instruções de dev para WSL2/WSLg + nota sobre validação em Windows nativo"
      contains: "WSL2"
  key_links:
    - from: "app.requestSingleInstanceLock()"
      to: "app.quit()"
      via: "if (!gotTheLock)"
      pattern: "requestSingleInstanceLock"
    - from: "app.on('second-instance', ...)"
      to: "mainWindow.focus()"
      via: "handler registrado antes de app.whenReady()"
      pattern: "second-instance"
    - from: "new BrowserWindow({ webPreferences: ... })"
      to: "contextIsolation: true, nodeIntegration: false"
      via: "declaração explícita no objeto de config"
      pattern: "contextIsolation:\\s*true"
---

<objective>
Ativar `requestSingleInstanceLock` desde o primeiro commit funcional do app,
com o handler `second-instance` focando a janela existente, e declarar
explicitamente `contextIsolation: true` / `nodeIntegration: false` na janela
principal — em vez de confiar nos defaults silenciosos do Electron.
Documentar como rodar em dev no WSL2/WSLg e o que fica de fora dessa
validação (só verificável numa máquina Windows nativa).

Purpose: `APP-04` não é polimento — é pré-condição técnica para `AUTH-01`
(F2). No Windows, o retorno do OAuth via `janja://` chega pelo evento
`second-instance`, que só existe se o lock estiver ativo desde a primeira
janela (design §4). Se F2 for implementada sem essa base, o login quebra em
produção de um jeito que só aparece depois, com o app já em uso.
Output: `src/main/index.ts` com instância única e superfície de segurança
declarada explicitamente; README com instruções de dev para o ambiente atual
(WSL2).
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/research/PITFALLS.md
@.planning/phases/00-bootstrap-do-repo/00-RESEARCH.md
@.planning/phases/00-bootstrap-do-repo/00-01-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Single-instance lock + second-instance handler + webPreferences explícito</name>
  <files>src/main/index.ts</files>
  <action>
    Editar `src/main/index.ts` (gerado pelo scaffold em 00-01). Estrutura
    final, seguindo o padrão oficial confirmado em `00-RESEARCH.md` §4:

    1. Mover a variável da janela principal para escopo de módulo (fora de
       `createWindow`), porque o handler `second-instance` precisa acessá-la:
       `let mainWindow: BrowserWindow | null = null`.

    2. Logo no topo do arquivo, **antes** de qualquer `app.whenReady()` ou
       criação de janela, pedir o lock:

       ```ts
       const gotTheLock = app.requestSingleInstanceLock()

       if (!gotTheLock) {
         app.quit()
       } else {
         app.on('second-instance', () => {
           if (mainWindow) {
             if (mainWindow.isMinimized()) mainWindow.restore()
             mainWindow.focus()
           }
         })

         app.whenReady().then(() => {
           // ... resto da inicialização que já existe (electronApp.setAppUserModelId,
           // optimizer.watchWindowShortcuts, ipcMain.on('ping', ...), createWindow(),
           // app.on('activate', ...)) — tudo isso entra dentro deste bloco else,
           // substituindo o app.whenReady().then(...) que o scaffold já gerou.
         })
       }
       ```

       Não deixar dois `app.whenReady().then(...)` no arquivo — mesclar a
       inicialização já existente para dentro deste bloco `else`, não
       duplicar.

    3. Dentro de `createWindow()`, no objeto `webPreferences` da
       `BrowserWindow`, declarar explicitamente (o scaffold já tem
       `sandbox: false` e `preload: ...` — adicionar as duas linhas
       seguintes, não remover as existentes):

       ```ts
       webPreferences: {
         preload: join(__dirname, '../preload/index.js'),
         sandbox: false,
         contextIsolation: true,
         nodeIntegration: false
       }
       ```

    4. Atribuir `mainWindow = new BrowserWindow({...})` em vez de uma
       constante `const mainWindow = ...` local — precisa ser a variável de
       módulo do passo 1 para o handler de `second-instance` enxergá-la.

    `app.on('window-all-closed', ...)` que o scaffold já gerou continua como
    está, fora do bloco condicional do lock (não precisa mover).
  </action>
  <verify>
    `grep -n "requestSingleInstanceLock" src/main/index.ts` retorna a linha.
    `grep -n "second-instance" src/main/index.ts` retorna a linha.
    `grep -n "contextIsolation: true" src/main/index.ts` retorna a linha.
    `grep -n "nodeIntegration: false" src/main/index.ts` retorna a linha.
    `npm run typecheck` passa sem erro.
    `npm run build` termina com exit code 0.
  </verify>
  <done>src/main/index.ts pede o lock antes de qualquer janela, foca a janela existente no evento second-instance, e declara contextIsolation/nodeIntegration explicitamente; typecheck e build passam.</done>
</task>

<task type="auto">
  <name>Task 2: Documentar dev no WSL2/WSLg no README</name>
  <files>README.md</files>
  <action>
    Adicionar ao `README.md` (gerado pelo scaffold em 00-01, já tem seções
    de Install/Development/Build) uma seção nova, depois de "Development":

    ```markdown
    ## Desenvolvimento no WSL2 (WSLg)

    O ambiente de desenvolvimento deste projeto é WSL2/Linux; o alvo de
    produção é Windows exclusivamente.

    `npm run dev` abre a janela do Electron através do WSLg (subsistema
    gráfico integrado ao WSL2 desde o Windows 11) — não deveria exigir X
    server externo nem flags adicionais na maioria das instalações atuais.

    Se a janela não abrir ou o processo travar/crashar sem mensagem clara,
    as causas mais comuns são:

    - `chrome-sandbox` sem permissão de SUID dentro do WSL — tentar rodar
      com a flag `--no-sandbox` **só em desenvolvimento**, nunca no build de
      produção para Windows.
    - Bibliotecas gráficas do sistema faltando no WSL (`libnss3`,
      `libatk1.0-0`, `libgtk-3-0`, `libgbm1`).

    ### O que este ambiente consegue validar

    - A janela abre sem crash.
    - `requestSingleInstanceLock` funciona — abrir uma segunda instância não
      cria uma segunda janela (o mecanismo do Electron é multiplataforma,
      não depende do Windows).

    ### O que só é validável numa máquina Windows nativa

    - Foco de janela real via DWM do Windows.
    - Registro do protocolo customizado `janja://` e o retorno de OAuth via
      `second-instance` com URL na `commandLine` (F2).
    - Captura de áudio de sistema via WASAPI (F8).

    Nenhum desses três está em escopo de F0 — são revalidados nas fases
    correspondentes (F2 e F8) numa máquina Windows real.
    ```
  </action>
  <verify>
    `grep -n "WSL2" README.md` retorna pelo menos uma linha.
    `grep -n "Windows nativa" README.md` retorna a linha da seção de limitações.
  </verify>
  <done>README documenta como rodar em dev no WSL2/WSLg e lista explicitamente o que só é verificável numa máquina Windows nativa.</done>
</task>

</tasks>

<verification>
- `src/main/index.ts` contém `requestSingleInstanceLock`, `second-instance`, `contextIsolation: true` e `nodeIntegration: false`.
- `npm run build` continua passando depois das edições.
- `README.md` tem a seção de dev no WSL2 com a lista do que é/não é validável fora do Windows.
</verification>

<success_criteria>
- Instância única ativa desde este commit — pré-condição para `AUTH-01` em F2.
- Superfície de segurança da janela principal (`contextIsolation`/`nodeIntegration`) declarada explicitamente, não implícita.
- Time (e qualquer implementador futuro) sabe exatamente o que testar no ambiente atual e o que só faz sentido testar em Windows.
</success_criteria>

<output>
After completion, create `.planning/phases/00-bootstrap-do-repo/00-03-SUMMARY.md`.
</output>
