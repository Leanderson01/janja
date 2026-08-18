---
phase: 00-bootstrap-do-repo
plan: 04
type: execute
wave: 3
depends_on: ["00-02", "00-03"]
files_modified: []
autonomous: false

must_haves:
  truths:
    - "npm install && npm run dev abre uma janela Electron vazia (shell) sem crash, verificado visualmente pelo usuário"
    - "Abrir uma segunda instância do app não cria uma segunda janela — a existente ganha foco"
    - ".git, .planning/, docs/ e .claude/ continuam intactos ao final da fase inteira"
    - "npm run build passa a partir de um checkout limpo do estado final do repo"
  artifacts: []
  key_links: []
---

<objective>
Fechar Fase 0 com uma verificação automática final de integridade do repo +
uma checagem humana única do que só um humano pode confirmar de verdade:
que a janela realmente abre na tela e que abrir o app duas vezes realmente
resulta numa única janela em foco. Consolida os três critérios de sucesso da
fase (roadmap) num único checkpoint, em vez de espalhar verificação humana
pelos planos anteriores.

Purpose: os planos 00-01, 00-02 e 00-03 já verificam tudo que dá para
verificar via build/typecheck/grep sem GUI. O que falta — "a janela
realmente aparece", "a segunda instância realmente foca a primeira em vez de
abrir outra" — só um humano rodando no WSL2 real (com WSLg configurado)
consegue confirmar com certeza.
Output: confirmação humana de que os 3 critérios de sucesso do roadmap para
F0 estão satisfeitos, e reconfirmação automática de que nada foi perdido do
repo ao longo da fase.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/00-bootstrap-do-repo/00-01-SUMMARY.md
@.planning/phases/00-bootstrap-do-repo/00-02-SUMMARY.md
@.planning/phases/00-bootstrap-do-repo/00-03-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Reverificação automática de integridade e build limpo</name>
  <files></files>
  <action>
    A partir da raiz do repo (`/home/leo/workspace/janja`):

    1. Confirmar que a estrutura protegida sobreviveu à fase inteira (F0
       envolveu 3 planos anteriores mexendo em arquivos — reconfirmar depois
       de todos, não só depois do primeiro):
       ```bash
       test -d .git && test -d .planning && test -d docs && test -d .claude && echo "OK: estrutura protegida intacta"
       git status --porcelain | grep '^D' && echo "ALERTA: arquivos deletados" || echo "OK: nenhum arquivo deletado"
       ```

    2. Confirmar o pin exato do Electron continua correto (nenhum plano
       anterior deveria ter mexido nisso, mas confirmar em vez de assumir):
       ```bash
       npm pkg get devDependencies.electron
       ```
       Deve imprimir `"43.4.0"`.

    3. Rodar `npm install` limpo e `npm run build`, confirmando que o estado
       final da fase inteira (scaffold + Tailwind/shadcn + single-instance)
       compila junto sem conflito:
       ```bash
       npm install
       npm run build
       ```

    4. Checagem estática dos três marcos da fase, todos num único grep
       consolidado (cada um já foi verificado individualmente nos planos
       anteriores — isto é a reconfirmação final, não uma nova
       investigação):
       ```bash
       grep -q "requestSingleInstanceLock" src/main/index.ts && echo "OK: single-instance lock presente"
       grep -q "contextIsolation: true" src/main/index.ts && echo "OK: contextIsolation explícito"
       grep -q "components/ui/button" src/renderer/src/App.tsx && echo "OK: shadcn Button renderizado"
       ```
  </action>
  <verify>
    Todos os comandos do passo 1-4 executam sem erro e imprimem os `OK:`
    esperados; nenhum `ALERTA:` aparece.
  </verify>
  <done>Repo íntegro ao final da fase inteira; build limpo passa; os três marcos de código (lock, hardening, shadcn) confirmados presentes.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Fase 0 completa: app Electron + electron-vite (TypeScript, React,
    Tailwind v4, shadcn/ui) scaffolded de forma segura na raiz do repo, com
    Electron pinado em 43.4.0 exato, instância única ativa via
    `requestSingleInstanceLock` + handler `second-instance`, e
    `contextIsolation`/`nodeIntegration` declarados explicitamente.
  </what-built>
  <how-to-verify>
    No terminal WSL2, a partir da raiz do repo:

    1. `npm run dev` — confirmar que uma janela do Electron abre, mostrando
       o botão "janja" (shadcn) centralizado, sem erro no terminal e sem a
       janela travar em branco.
    2. Com o app do passo 1 ainda aberto, abrir um segundo terminal e rodar
       `npm run dev` novamente (ou, se o script `dev` não permitir rodar
       duas vezes em paralelo facilmente, testar equivalente com o binário
       buildado: `npm run build && npm run start` duas vezes). Confirmar que
       **não** abre uma segunda janela — a janela já aberta deve ganhar
       foco (vir para frente).
    3. Fechar ambos os processos (`Ctrl+C` nos terminais).
    4. Confirmar visualmente que `.git`, `.planning/`, `docs/` e `.claude/`
       continuam existindo no repo (`ls -la` na raiz).

    Nota: comportamento de foco de janela via DWM do Windows e o retorno de
    OAuth via `janja://` não são testados aqui — ficam para F2/F8 numa
    máquina Windows nativa (ver `README.md`, seção "Desenvolvimento no
    WSL2").
  </how-to-verify>
  <resume-signal>Digite "aprovado" se os 4 passos acima se comportaram como esperado, ou descreva o que não funcionou.</resume-signal>
</task>

</tasks>

<verification>
- Reconfirmação automática: `.git`/`.planning/`/`docs/`/`.claude/` intactos, `npm run build` limpo, marcos de código presentes.
- Confirmação humana: janela abre sem crash; segunda instância não duplica janela.
</verification>

<success_criteria>
Os três critérios de sucesso de F0 no roadmap estão satisfeitos:
1. Repo roda em modo dev (`electron-vite`) sem passos manuais além de `npm install`.
2. App abre uma janela Electron vazia (shell), sem crash.
3. Abrir o app uma segunda vez não cria nova janela — a instância existente ganha foco.
</success_criteria>

<output>
After completion, create `.planning/phases/00-bootstrap-do-repo/00-04-SUMMARY.md`.
</output>
