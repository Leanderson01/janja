---
phase: 10-versao-web
plan: 07
type: execute
wave: 5
depends_on: ["10-05", "10-06"]
files_modified:
  - src/renderer/src/platform/contract.ts
  - src/renderer/src/platform/electron/capabilities.ts
  - src/renderer/src/platform/web/capabilities.ts
  - src/renderer/src/platform/capabilities.test.ts
  - src/renderer/src/lib/browser-support.ts
  - src/renderer/src/lib/browser-support.test.ts
  - src/renderer/src/components/shell/PlatformNotice.tsx
  - src/renderer/src/components/shell/PlatformNotice.test.tsx
  - src/renderer/src/components/shell/AppShell.tsx
  - src/renderer/src/components/shell/VoiceSettingsPopover.tsx
  - eslint.config.mjs
  - package.json
  - scripts/verify-web-bundle.mjs
autonomous: true

must_haves:
  truths:
    - "A interface diz o que a web NÃO faz: push-to-talk só com a janela em foco, sem seletor próprio de tela, sem instalação/bandeja/atualização automática"
    - "Cada frase dessas sai de uma ÚNICA fonte de verdade (o objeto capabilities), nunca de uma string duplicada por tela"
    - "Num navegador sem suporte a áudio de compartilhamento (não-Chromium), o app avisa em vez de degradar em silêncio"
    - "Numa janela estreita demais para o shell, o app diz para abrir num navegador de computador em vez de renderizar um layout quebrado"
    - "O lint impede que qualquer arquivo fora de `platform/electron/**` volte a falar com `window.auth|voice|screenshare|electron`"
    - "`build:web` falha se o bundle web contiver qualquer ponte do Electron"
  artifacts:
    - path: "src/renderer/src/lib/browser-support.ts"
      provides: "decisão pura sobre suporte do navegador e sobre largura mínima"
      exports: ["isScreenShareAudioSupported", "MIN_SUPPORTED_WIDTH"]
    - path: "src/renderer/src/components/shell/PlatformNotice.tsx"
      provides: "os avisos de paridade, alimentados por capabilities"
      min_lines: 70
    - path: "src/renderer/src/components/shell/PlatformNotice.test.tsx"
      provides: "prova de que os avisos aparecem no alvo web e NENHUM deles no Electron"
      min_lines: 80
  key_links:
    - from: "src/renderer/src/components/shell/PlatformNotice.tsx"
      to: "@platform/capabilities"
      via: "capabilities como única fonte de verdade dos textos"
      pattern: "@platform/capabilities"
    - from: "src/renderer/src/components/shell/VoiceSettingsPopover.tsx"
      to: "@platform/capabilities"
      via: "globalPushToTalk decidindo o texto do modo push-to-talk"
      pattern: "globalPushToTalk"
    - from: "eslint.config.mjs"
      to: "src/renderer/src/platform/electron"
      via: "no-restricted-syntax proibindo window.* fora dali"
      pattern: "no-restricted-syntax"
    - from: "package.json"
      to: "scripts/verify-web-bundle.mjs"
      via: "build:web chamando o verificador com --strict-bridges"
      pattern: "strict-bridges"
---

<objective>
Fazer o app dizer o que ele não faz — na própria interface, a partir de uma
fonte de verdade só — e trancar a porta por onde a costura poderia vazar de
volta.

Purpose: as perdas da web (push-to-talk sem foco, seletor próprio de tela,
áudio por processo, instância única, bandeja, atualização automática) **não são
escopo cortado: são limite de plataforma.** A diferença prática é que limite
não descoberto no meio de uma call é indistinguível de bug — a pessoa segura a
tecla, ninguém ouve, e a conclusão é "o app está quebrado". O ROADMAP já
antecipou isto como um requisito novo de "paridade declarada".

A segunda metade do plano é a que protege a fase depois que ela acabar: uma
regra de lint e um portão de build. A camada de plataforma inteira depende de
um invariante — nada de `window.*` fora de `platform/electron/**` — e
invariante sem guarda vira comentário obsoleto.

Output: um componente de avisos alimentado por `capabilities`, o texto do
push-to-talk saindo da mesma fonte, e duas guardas automáticas.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-versao-web/10-RESEARCH.md
@.planning/phases/10-versao-web/10-05-SUMMARY.md
@.planning/phases/10-versao-web/10-06-SUMMARY.md
@src/renderer/src/platform/contract.ts
@src/renderer/src/platform/web/capabilities.ts
@src/renderer/src/components/shell/AppShell.tsx
@src/renderer/src/components/shell/VoiceSettingsPopover.tsx
@scripts/verify-web-bundle.mjs
@eslint.config.mjs

# A janela do desktop assume >= 900px de largura (src/main/index.ts:20). O
# navegador não tem mínimo — e é daí que vem a decisão de produto do Task 1.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Paridade declarada — uma fonte de verdade, três avisos</name>
  <files>src/renderer/src/platform/contract.ts, src/renderer/src/platform/electron/capabilities.ts, src/renderer/src/platform/web/capabilities.ts, src/renderer/src/platform/capabilities.test.ts, src/renderer/src/lib/browser-support.ts, src/renderer/src/lib/browser-support.test.ts, src/renderer/src/components/shell/PlatformNotice.tsx, src/renderer/src/components/shell/PlatformNotice.test.tsx, src/renderer/src/components/shell/AppShell.tsx, src/renderer/src/components/shell/VoiceSettingsPopover.tsx</files>
  <action>
    **`lib/browser-support.ts`** (puro, testável, sem DOM implícito):
    - `isScreenShareAudioSupported(nav = navigator): boolean` — o áudio do
      `getDisplayMedia` é **Chromium-only**; Firefox e Safari ignoram a parte
      de áudio inteiramente. Detectar por capacidade sempre que possível
      (`'getDisplayMedia' in nav.mediaDevices` é necessário mas não
      suficiente); onde não houver capacidade detectável, usar
      `nav.userAgentData?.brands` procurando "Chromium" e, só como último
      recurso, o `userAgent`. **Comentar a escolha:** detecção por UA é frágil
      e este é um dos poucos casos em que ela é o único caminho — a alternativa
      (deixar a pessoa compartilhar e descobrir que ninguém ouviu) é pior.
    - `MIN_SUPPORTED_WIDTH = 800` — decisão de produto, registrada aqui com o
      porquê: o shell foi desenhado com `minWidth: 900` na janela do Electron
      (`src/main/index.ts:20`), e o navegador não tem mínimo nenhum. **Para a
      v1 a decisão é avisar, não tentar layout responsivo** — responsividade do
      shell inteiro é uma fase, não uma tarefa. 800 e não 900 porque o
      navegador tem cromo próprio e vale dar alguma folga antes de bloquear.
    Testes: os dois, com objetos injetados (nunca dependendo do jsdom real).

    **`capabilities`, nos dois alvos:** acrescentar ao contrato e às duas
    implementações um campo `limitations: string[]` — as frases em português,
    prontas, na ordem em que devem aparecer. Web:
    - "Push-to-talk só funciona com esta janela em foco."
    - "Quem escolhe o que compartilhar é o navegador, não o Hydra."
    - "Compartilhar uma janela não leva som; escolha uma aba ou a tela inteira."
    - "Sem instalação, bandeja ou atualização automática — a web já é sempre a
      última versão."
    Electron: `limitations: []`.
    **A regra que justifica o campo existir**, e que precisa estar em
    comentário no `contract.ts`: nunca uma string duplicada em cada tela. Toda
    frase sobre o que a plataforma não faz sai daqui. Duas cópias divergem, e a
    que ficar errada vai ser a que alguém lê no meio de uma call.
    Estender `capabilities.test.ts`: as duas implementações continuam com o
    mesmo conjunto de chaves, `web.limitations.length >= 4`,
    `electron.limitations.length === 0`.

    **`components/shell/PlatformNotice.tsx`** (novo) — três avisos, todos
    derivados, nenhum hardcoded por plataforma:
    1. **Largura**: se `window.innerWidth < MIN_SUPPORTED_WIDTH`, ocupar a tela
       com uma mensagem curta pedindo para abrir num navegador de computador.
       Ouvir `resize` para sumir quando a janela crescer. `data-testid="notice-narrow"`.
    2. **Navegador sem suporte**: se `capabilities.screenShareAudio === 'browser-surface'`
       e `!isScreenShareAudioSupported()`, uma faixa dispensável dizendo que
       este navegador não envia o áudio do compartilhamento e recomendando
       Chrome ou Edge. `data-testid="notice-browser"`.
    3. **Limitações**: renderizar `capabilities.limitations` num lugar
       discreto e alcançável (não um modal no boot — ninguém lê). Sugestão:
       uma seção "Nesta versão" dentro do popover/menu já existente do
       usuário, ou um `<details>` no rodapé do painel de configurações de voz.
       Escolher UM lugar e comentar a escolha. `data-testid="notice-limitations"`.
       **No Electron a lista é vazia e nada renderiza** — de novo por dado, não
       por ramo de plataforma.
    Montar em `AppShell.tsx` com uma linha de import e uma de JSX.

    **`VoiceSettingsPopover.tsx`**: onde o modo push-to-talk é escolhido,
    quando `!capabilities.globalPushToTalk`, acrescentar a frase curta "só com
    esta janela em foco" ao lado da opção. Ler de `capabilities.limitations[0]`
    é tentador e **está errado** — o texto ali é uma frase de contexto, não a
    lista; usar o booleano `globalPushToTalk` para decidir e escrever a frase
    curta no local. Comentar essa distinção, senão a próxima pessoa duplica a
    lista.

    **`PlatformNotice.test.tsx`** (jsdom): com `capabilities` mockado como web,
    (1) aviso de largura aparece com `innerWidth` pequeno e some ao crescer;
    (2) aviso de navegador aparece quando o suporte é falso e não aparece
    quando é verdadeiro; (3) as quatro limitações aparecem; e — o teste que
    importa para a não-regressão — (4) **com `capabilities` mockado como
    electron, NENHUM dos três avisos renderiza.**
  </action>
  <verify>
    `npx vitest run src/renderer/src/components/shell/PlatformNotice.test.tsx src/renderer/src/lib/browser-support.test.ts src/renderer/src/platform/capabilities.test.ts` — todos passando, incluindo o caso electron-vazio.
    `grep -rn "só funciona com esta janela em foco" src/renderer/src | wc -l` = 1 (a frase existe em UM lugar só).
    `npm run typecheck` + `npm run typecheck:web-target` exit 0; `npx vitest run` sem regressão sobre a baseline da fase (644 testes em 38 arquivos, mais os acrescentados pelos planos 01-06); `npm run build` exit 0.
  </verify>
  <done>Existe uma fonte de verdade para o que a plataforma não faz, ela alimenta a interface, e está provado que no Electron ela não produz ruído nenhum.</done>
</task>

<task type="auto">
  <name>Task 2: As duas guardas — lint contra `window.*` e portão de bundle no build</name>
  <files>eslint.config.mjs, package.json, scripts/verify-web-bundle.mjs</files>
  <action>
    **`eslint.config.mjs`** — acrescentar um bloco novo (sem tocar nos
    existentes):

        {
          files: ['src/renderer/src/**/*.{ts,tsx}'],
          ignores: ['src/renderer/src/platform/electron/**'],
          rules: {
            'no-restricted-syntax': ['error', {
              selector: "MemberExpression[object.name='window'][property.name=/^(auth|voice|screenshare|electron)$/]",
              message: 'A ponte do Electron só pode ser tocada dentro de src/renderer/src/platform/electron/**. Fora dali, use o contrato: @platform/auth, @platform/ptt, @platform/screenshare. Ver .planning/phases/10-versao-web/10-RESEARCH.md §3.'
            }]
          }
        }

    A mensagem de erro é metade do valor da regra: ela precisa dizer o que
    fazer, não só o que é proibido. **Conferir o seletor rodando o lint** — se
    ele não pegar nada, testar de propósito acrescentando `window.auth` num
    arquivo qualquer, ver o erro, e desfazer. Uma guarda que não morde é pior
    que nenhuma, porque dá a sensação de estar protegido (lição nº 3 do
    HANDOFF, em outra forma).

    **`scripts/verify-web-bundle.mjs`** — a afirmação 3, hoje um aviso, passa a
    ser erro por padrão. Inverter a flag: sem argumento, `window.auth`,
    `window.voice`, `window.screenshare`, `window.electron` e `uiohook` no
    bundle são **erro** (exit 1); manter uma flag `--warn-bridges` para o caso
    de alguém precisar inspecionar. Atualizar o cabeçalho do arquivo dizendo
    que a migração terminou no Plano 10-03 e que a partir daqui qualquer
    ocorrência é regressão. Acrescentar aos marcadores
    `screenshare-pcm-player` (o worklet de PCM da Fase 8.6, que não pode
    existir no alvo web).

    **`package.json`**: `build:web` passa a ser

        "build:web": "npm run typecheck:web && npm run typecheck:web-target && vite build --config vite.config.web.ts && npm run verify:web-bundle"

    Mesma forma e mesma justificativa do `build:win`, que encadeia
    `verify:build-env`, `verify:renderer-runtime`, `verify:native-audio` e
    `verify:no-secrets`. **O deploy na Vercel roda `npm run build:web`**, então
    a guarda passa a valer também lá — um bundle contaminado não sobe.

    Depois de escrever tudo: rodar `npm run lint` e `npm run build:web` e
    **ler a saída**. O lint precisa terminar sem achados novos sobre a linha de
    base; o `build:web` precisa terminar verde com o verificador tendo
    afirmado, e não avisado.
  </action>
  <verify>
    `npm run lint` exit 0 e sem achados novos sobre a baseline.
    Teste negativo obrigatório: inserir temporariamente `window.auth` em `src/renderer/src/App.tsx`, rodar `npm run lint`, confirmar o erro com a mensagem certa, e **desfazer** (o `git diff` de `App.tsx` tem que ficar vazio ao final).
    `npm run build:web` exit 0 e a saída mostra o verificador aprovando as quatro afirmações.
    Teste negativo do verificador: rodar `npm run verify:web-bundle` contra um `dist-web` com uma string `window.auth` injetada num `.js` e confirmar exit 1; restaurar rodando `npm run build:web`.
    `npm run build` (desktop) exit 0 — o `build:win` não foi tocado.
  </verify>
  <done>As duas guardas existem, foram provadas mordendo, e o portão do bundle roda também no deploy da Vercel.</done>
</task>

</tasks>

<verification>
**O que passou a ser verificável NESTE ambiente (WSL2):**
- Que a paridade é declarada a partir de uma fonte só (teste + `grep` de
  frase única).
- Que no Electron os avisos não existem (teste com `capabilities` mockado) —
  esta é a prova de não-regressão visual sem precisar de tela.
- Que a costura não pode mais vazar (lint e verificador, os dois provados
  mordendo).

**O que continua exigindo o Chrome do Windows:**
- Que os avisos são legíveis e estão em lugar que alguém encontra — teste
  prova que renderizam, não que fazem sentido. Vai no roteiro do Plano 10-09.
- O aviso de largura, em janela estreita de verdade.
- O aviso de navegador sem suporte, num Firefox de verdade (o teste usa
  objeto injetado).

**Prova de que o desktop não regrediu:**
1. Teste explícito de que `capabilities.limitations` é vazio no Electron e que
   `PlatformNotice` não renderiza nada lá.
2. `npm run lint`, `npm run typecheck`, `npm run build`, `npx vitest run` e
   `verify:renderer-runtime` verdes.
3. Nenhuma mudança no `build:win` nem nos quatro verificadores que ele
   encadeia — conferir com `git diff package.json` que só a linha de
   `build:web` mudou.
</verification>

<success_criteria>
- `capabilities.limitations` é a única fonte das frases; nenhuma duplicada.
- `PlatformNotice` renderiza os três avisos no alvo web e nada no Electron,
  provado por teste.
- Regra de lint ativa, com mensagem acionável, provada mordendo e desfeita.
- `verify:web-bundle` é erro por padrão e está encadeado no `build:web`.
- `npm run lint` sem achados novos; `npm run build` e `npm run build:web`
  verdes.
</success_criteria>

<output>
Ao terminar, criar `.planning/phases/10-versao-web/10-07-SUMMARY.md`, com as
frases finais de `limitations` copiadas literalmente (elas viram texto de
produto e o checkpoint do Plano 10-09 vai conferi-las na tela) e o registro do
teste negativo das duas guardas.
</output>
