---
phase: 00-bootstrap-do-repo
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - package-lock.json
  - electron.vite.config.ts
  - electron-builder.yml
  - tsconfig.json
  - tsconfig.node.json
  - tsconfig.web.json
  - eslint.config.mjs
  - .gitignore
  - .editorconfig
  - .prettierrc.yaml
  - .prettierignore
  - .vscode/extensions.json
  - .vscode/launch.json
  - .vscode/settings.json
  - README.md
  - build/entitlements.mac.plist
  - build/icon.icns
  - build/icon.ico
  - build/icon.png
  - resources/icon.png
  - src/main/index.ts
  - src/preload/index.ts
  - src/preload/index.d.ts
  - src/renderer/index.html
  - src/renderer/src/main.tsx
  - src/renderer/src/App.tsx
  - src/renderer/src/env.d.ts
  - src/renderer/src/assets/base.css
  - src/renderer/src/assets/main.css
  - src/renderer/src/assets/electron.svg
  - src/renderer/src/assets/wavy-lines.svg
  - src/renderer/src/components/Versions.tsx
autonomous: true

must_haves:
  truths:
    - "Repo mantém .git, .planning/, docs/ e .claude/ intactos depois do scaffold — nenhum arquivo pré-existente do projeto foi apagado ou sobrescrito"
    - "package.json na raiz tem \"name\": \"janja\" — não uma string gigante de caracteres repetidos (sintoma do incidente anterior, onde `yes` alimentou o prompt de nome do projeto)"
    - "devDependencies.electron é exatamente \"43.4.0\", sem ^ nem ~"
    - "npm install e npm run build completam sem erro rodando a partir da raiz real do repo (não do diretório temporário de scaffold)"
    - "git status depois de tudo mostra só arquivos novos (untracked/added), zero arquivos deletados"
  artifacts:
    - path: "package.json"
      provides: "Manifest do app: nome, scripts (dev/build/typecheck), electron pinado em 43.4.0 exato"
      contains: "\"electron\": \"43.4.0\""
    - path: "electron.vite.config.ts"
      provides: "Config dos três sub-builds (main/preload/renderer) do electron-vite"
      contains: "renderer"
    - path: "src/main/index.ts"
      provides: "Processo main — janela + IPC básico, ainda sem single-instance-lock (isso é 00-03)"
    - path: "src/preload/index.ts"
      provides: "contextBridge mínimo, conforme design §3"
    - path: "src/renderer/src/App.tsx"
      provides: "Componente raiz do renderer React"
    - path: ".gitignore"
      provides: "Ignora node_modules, out, dist — evita commitar build artifacts"
      contains: "node_modules"
  key_links:
    - from: "package.json scripts.dev"
      to: "electron-vite dev"
      via: "script npm"
      pattern: "electron-vite dev"
---

<objective>
Gerar a estrutura inicial do app Electron (TypeScript + React, via
electron-vite) de forma que seja **fisicamente impossível** repetir o
incidente que já destruiu `.git`, `docs/` e `.claude/` uma vez neste projeto:
o scaffolder roda inteiro dentro de um diretório temporário vazio fora do
repo, nunca aponta pra raiz do repo, e só depois seus arquivos são copiados
para dentro de `/home/leo/workspace/janja`. Nenhum comando usa `yes`,
`--force` ou `--yes` contra o scaffolder.

Purpose: sem esta base, nenhuma fase seguinte (F1-F9) tem onde colocar
código — F0 é a fase que "bloqueia tudo" no roadmap.
Output: `package.json`, `electron.vite.config.ts`, `tsconfig*.json` e a
árvore `src/main/`, `src/preload/`, `src/renderer/` (design §3), com
Electron pinado exatamente em `43.4.0`, prontos para `npm install && npm run
build` sem passos manuais.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/00-bootstrap-do-repo/00-RESEARCH.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Scaffold em diretório temporário e cópia segura para o repo</name>
  <files>package.json, electron.vite.config.ts, electron-builder.yml, tsconfig*.json, eslint.config.mjs, .gitignore, .editorconfig, .prettierrc.yaml, .prettierignore, .vscode/*, README.md, build/*, resources/*, src/main/*, src/preload/*, src/renderer/*</files>
  <action>
    **Passo 1 — criar diretório temporário vazio, fora do repo.**

    ```bash
    SCAFFOLD_DIR="/tmp/janja-scaffold-$$"
    mkdir -p "$SCAFFOLD_DIR"
    ```

    Confirmar que está vazio antes de prosseguir: `ls -A "$SCAFFOLD_DIR"` deve
    imprimir nada.

    **Passo 2 — rodar o scaffolder DENTRO do diretório temporário, nunca na
    raiz do repo.** Comando exato confirmado em `00-RESEARCH.md` §2 (não
    inventar variações, não adicionar `--force`/`--yes`, nunca usar
    `yes |`):

    ```bash
    cd "$SCAFFOLD_DIR" && npm create @quick-start/electron@latest janja -- --template react-ts --skip < /dev/null
    ```

    O `< /dev/null` é intencional: se qualquer prompt interativo aparecer
    (não deveria, pela análise em `00-RESEARCH.md` §2), o comando falha
    imediatamente com erro visível em vez de travar ou aceitar uma resposta
    às cegas. Se isso acontecer, **parar e investigar** — não tentar
    contornar com `yes` ou qualquer forma de auto-confirmação.

    **Passo 3 — validar a saída do scaffold antes de tocar no repo real.**

    ```bash
    test -f "$SCAFFOLD_DIR/janja/package.json"
    python3 -c "
    import json
    d = json.load(open('$SCAFFOLD_DIR/janja/package.json'))
    assert d['name'] == 'janja', f\"nome inesperado: {d['name']!r}\"
    assert len(d['name']) < 50
    print('OK — package.json com nome válido:', d['name'])
    "
    ```

    Se essa validação falhar (nome vazio, gigante, ou arquivo ausente), **não
    prosseguir para o passo 4**. Isso teria sido exatamente o sintoma do
    incidente anterior (nome = string de milhares de "y").

    **Passo 4 — copiar para o repo real, sem tocar em `.git`, `.planning/`,
    `docs/`, `.claude/`.** O diretório gerado (`$SCAFFOLD_DIR/janja/`) não
    contém nenhum desses nomes — copiar tudo dele para a raiz do repo é
    seguro por construção, mas confirmar antes mesmo assim:

    ```bash
    # Confirma que o scaffold não produziu nada com esses nomes (defesa extra)
    for protected in .git .planning docs .claude; do
      if [ -e "$SCAFFOLD_DIR/janja/$protected" ]; then
        echo "ABORTAR: scaffold gerou $protected — investigar antes de copiar"
        exit 1
      fi
    done

    # Copia sem sobrescrever silenciosamente (cp -n falha em vez de sobrescrever)
    cp -rn "$SCAFFOLD_DIR/janja/." /home/leo/workspace/janja/
    ```

    Se `cp -rn` reportar que pulou algum arquivo por já existir, investigar
    manualmente qual é (não deveria haver nenhum — o repo hoje não tem
    `package.json` nem `src/`) antes de decidir se é seguro sobrescrever.

    **Passo 5 — verificar integridade do repo pós-cópia.**

    ```bash
    cd /home/leo/workspace/janja
    test -d .git && test -d .planning && test -d docs && test -d .claude && echo "estrutura protegida intacta"
    git status --porcelain | grep '^D' && echo "ALERTA: há arquivos deletados" || echo "nenhum arquivo deletado"
    ```

    `git status --porcelain | grep '^D'` deve retornar vazio (grep sem match,
    exit code 1 é esperado e correto aqui).

    **Passo 6 — limpar o diretório temporário** (`rm -rf "$SCAFFOLD_DIR"`) só
    depois de confirmar que a cópia para o repo real terminou com sucesso.
  </action>
  <verify>
    `test -d /home/leo/workspace/janja/.git` retorna sucesso.
    `test -d /home/leo/workspace/janja/.planning` retorna sucesso.
    `test -d /home/leo/workspace/janja/docs` retorna sucesso.
    `test -d /home/leo/workspace/janja/.claude` retorna sucesso.
    `test -f /home/leo/workspace/janja/package.json` retorna sucesso.
    `test -d /home/leo/workspace/janja/src/main` e `src/preload` e `src/renderer` retornam sucesso.
    `git -C /home/leo/workspace/janja status --porcelain | grep -c '^D'` retorna `0`.
    `python3 -c "import json; print(json.load(open('/home/leo/workspace/janja/package.json'))['name'])"` imprime `janja`.
  </verify>
  <done>Scaffold completo copiado para a raiz do repo; .git/.planning/docs/.claude intactos; package.json tem nome "janja" válido; nenhum arquivo do repo foi deletado.</done>
</task>

<task type="auto">
  <name>Task 2: Pin exato do Electron, install e build smoke-test</name>
  <files>package.json, package-lock.json</files>
  <action>
    A partir da raiz real do repo (`/home/leo/workspace/janja`, nunca do
    diretório temporário, que já não existe mais):

    **Passo 1 — pin exato da versão do Electron**, confirmada em
    `00-RESEARCH.md` §1 (`43.4.0` é, hoje, a própria versão mais recente do
    Electron — não uma versão antiga arbitrária):

    ```bash
    npm pkg set devDependencies.electron=43.4.0
    ```

    Não editar o `package.json` manualmente com sed/editor de texto para
    isso — `npm pkg set` grava a string exata sem risco de erro de sintaxe
    JSON nem de adicionar `^`/`~` sem querer.

    Confirmar: `npm pkg get devDependencies.electron` deve imprimir
    `"43.4.0"` (com aspas, sem caret).

    **Passo 2 — instalar dependências.**

    ```bash
    npm install
    ```

    Isso dispara o `postinstall` do template (`electron-builder
    install-app-deps`) — não precisa de display, é só rebuild de módulos
    nativos.

    **Passo 3 — confirmar que a versão instalada bate com o pin.**

    ```bash
    node -e "console.log(require('electron/package.json').version)"
    ```

    Deve imprimir `43.4.0` exatamente.

    **Passo 4 — build smoke-test, sem precisar de display gráfico.** O
    scaffold já vem com o script `build` rodando typecheck antes:

    ```bash
    npm run build
    ```

    Isso compila os três sub-builds (main/preload/renderer) para `out/` via
    `electron-vite build` — prova que a estrutura gerada é coerente e
    compila de ponta a ponta, sem exigir GUI. Se falhar, **não é um problema
    de ambiente WSL2/display** (build não abre janela) — é um erro real de
    config ou tipo a investigar antes de prosseguir para os próximos planos
    da fase.
  </action>
  <verify>
    `npm pkg get devDependencies.electron` imprime `"43.4.0"`.
    `node -e "console.log(require('electron/package.json').version)"` imprime `43.4.0`.
    `npm run build` termina com exit code 0 e cria `out/main/index.js`,
    `out/preload/index.js` e `out/renderer/index.html`.
  </verify>
  <done>Electron pinado em 43.4.0 exato instalado e confirmado; npm run build passa sem erro a partir da raiz real do repo.</done>
</task>

</tasks>

<verification>
- `.git`, `.planning/`, `docs/`, `.claude/` existem e `git status --porcelain` não lista nenhum arquivo deletado (`^D`).
- `package.json` tem `"name": "janja"` e `"electron": "43.4.0"` (sem `^`/`~`) em `devDependencies`.
- `src/main/`, `src/preload/`, `src/renderer/` existem, batendo com a estrutura do design §3.
- `npm install && npm run build` completa sem erro a partir de um clone limpo do estado atual do repo.
</verification>

<success_criteria>
- Estrutura do app Electron existe na raiz do repo, gerada por um processo que nunca rodou o scaffolder dentro do próprio repo.
- Nada pré-existente (`.git`, `.planning/`, `docs/`, `.claude/`) foi tocado.
- Electron pinado exatamente em `43.4.0`, a versão mais recente disponível — não uma versão antiga.
- Repo compila (`npm run build`) sem precisar de nenhum passo manual além de `npm install`.
</success_criteria>

<output>
After completion, create `.planning/phases/00-bootstrap-do-repo/00-01-SUMMARY.md`.
</output>
