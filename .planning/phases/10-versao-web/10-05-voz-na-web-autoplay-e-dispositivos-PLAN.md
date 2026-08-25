---
phase: 10-versao-web
plan: 05
type: execute
wave: 4
depends_on: ["10-04"]
files_modified:
  - src/renderer/src/state/voice-context.tsx
  - src/renderer/src/components/shell/AudioPlaybackGate.tsx
  - src/renderer/src/components/shell/AudioPlaybackGate.test.tsx
  - src/renderer/src/components/shell/AppShell.tsx
  - src/renderer/src/components/shell/VoiceSettingsPopover.tsx
  - src/renderer/src/lib/audio-output-support.ts
  - src/renderer/src/lib/audio-output-support.test.ts
autonomous: true

must_haves:
  truths:
    - "Quando o navegador bloqueia a reprodução de áudio, a interface diz isso e oferece um clique que destrava — em vez de a pessoa entrar na call e não ouvir ninguém sem saber por quê"
    - "O clique de destravar chama `room.startAudio()` de dentro de um gesto do usuário, e o aviso some quando `canPlaybackAudio` volta a ser verdadeiro"
    - "No Electron, o aviso nunca aparece — `canPlaybackAudio` é verdadeiro desde o início e nada muda no comportamento de hoje"
    - "O seletor de saída de áudio some quando o navegador não implementa `setSinkId`, em vez de mentir que funciona"
    - "Abrir o popover de configurações de voz não dispara um pedido de permissão de microfone por acidente — o pedido é explícito e a lista mostra por que os nomes dos dispositivos podem vir vazios"
  artifacts:
    - path: "src/renderer/src/components/shell/AudioPlaybackGate.tsx"
      provides: "aviso 'clique para ouvir' ligado a AudioPlaybackStatusChanged e a room.startAudio()"
      min_lines: 60
    - path: "src/renderer/src/lib/audio-output-support.ts"
      provides: "função pura que decide se o seletor de saída pode aparecer"
      exports: ["isAudioOutputSelectable"]
    - path: "src/renderer/src/components/shell/AudioPlaybackGate.test.tsx"
      provides: "prova de que o aviso aparece bloqueado, some ao destravar e chama startAudio uma vez"
      min_lines: 70
  key_links:
    - from: "src/renderer/src/state/voice-context.tsx"
      to: "livekit-client"
      via: "RoomEvent.AudioPlaybackStatusChanged alimentando um estado do contexto"
      pattern: "AudioPlaybackStatusChanged"
    - from: "src/renderer/src/components/shell/AudioPlaybackGate.tsx"
      to: "room.startAudio"
      via: "onClick — precisa ser gesto do usuário"
      pattern: "startAudio\\(\\)"
    - from: "src/renderer/src/components/shell/VoiceSettingsPopover.tsx"
      to: "src/renderer/src/lib/audio-output-support.ts"
      via: "isAudioOutputSelectable escondendo o seletor de saída"
      pattern: "isAudioOutputSelectable"
---

<objective>
Fechar o defeito que a web expõe e que o desktop escondia: **o app anexa
tracks remotas e nunca trata a política de autoplay do navegador.**

Purpose: `voice-context.tsx:1010` chama `track.attach()` e confia que o
elemento vai tocar. No Electron, toca. No navegador, a política de autoplay
pode recusar, e o `livekit-client` tem exatamente para isso o
`room.canPlaybackAudio`, o evento `AudioPlaybackStatusChanged` e o
`room.startAudio()` — que **precisa ser chamado de dentro de um gesto do
usuário** (verificado no SDK instalado, `Room.d.ts:202-214`,
`events.d.ts:256-259`). Sem isso, o modo de falha é o pior possível para um app
de voz: "entrei na call e não ouço ninguém", sem erro, sem pista. O caso comum
funciona por acaso (clicar em "entrar no canal" já é um gesto) — mas
**reconexão, recarregar a aba com a call ativa e restaurar sessão não são**, e
recarregar a aba é a coisa mais natural que alguém faz num navegador.

Este não é trabalho "da versão web": é um defeito do app que a web torna
visível, e é tratado como trabalho de primeira classe.

Output: um portão de reprodução de áudio ligado ao evento certo, o seletor de
saída de áudio que não mente, e o pedido de permissão de microfone deixando de
ser efeito colateral de abrir um popover.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-versao-web/10-RESEARCH.md
@.planning/phases/10-versao-web/10-04-SUMMARY.md
@src/renderer/src/platform/contract.ts

# O efeito que anexa as tracks remotas e nunca tratou autoplay (linhas ~995-1035)
@src/renderer/src/state/voice-context.tsx
@src/renderer/src/components/shell/VoiceSettingsPopover.tsx
@src/renderer/src/components/shell/AppShell.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: O portão de reprodução de áudio — "clique para ouvir"</name>
  <files>src/renderer/src/state/voice-context.tsx, src/renderer/src/components/shell/AudioPlaybackGate.tsx, src/renderer/src/components/shell/AudioPlaybackGate.test.tsx, src/renderer/src/components/shell/AppShell.tsx</files>
  <action>
    **Em `voice-context.tsx`**, acrescentar ao contexto um estado
    `canPlaybackAudio: boolean`, inicializado com `room.canPlaybackAudio` e
    atualizado por um efeito que escuta
    `RoomEvent.AudioPlaybackStatusChanged`:

        useEffect(() => {
          const onChange = () => setCanPlaybackAudio(room.canPlaybackAudio)
          onChange()
          room.on(RoomEvent.AudioPlaybackStatusChanged, onChange)
          return () => { room.off(RoomEvent.AudioPlaybackStatusChanged, onChange) }
        }, [room])

    E expor `startAudio: () => Promise<void>` no valor do contexto, delegando a
    `room.startAudio()`. **Comentário obrigatório:** `startAudio` só funciona
    chamado de dentro de um gesto do usuário — quem chama tem que ser um
    `onClick`, nunca um efeito. Um `void room.startAudio()` num `useEffect`
    parece a correção óbvia e é exatamente a que não funciona.

    Não mexer em mais nada de `voice-context.tsx`. Em particular, **não** tocar
    no efeito de `attach()` nem no de volume por participante — os dois são
    irmãos com ordem garantida entre si (o comentário longo em ~1035-1060
    explica), e reordená-los é reintroduzir "o volume que eu ajustei voltou
    sozinho".

    **`components/shell/AudioPlaybackGate.tsx`** (novo): componente que não
    renderiza nada quando `canPlaybackAudio` é verdadeiro. Quando é falso E há
    intenção de estar num canal de voz, renderiza um aviso clicável, no mesmo
    vocabulário visual do resto (Fase 8.5): texto curto em português — algo
    como "O navegador bloqueou o áudio. Clique para ouvir." — e o `onClick`
    chamando `startAudio()` do contexto.
    - `data-testid="audio-playback-gate"` para o teste alcançá-lo.
    - Se `startAudio()` rejeitar, logar e **manter o aviso na tela** — sumir
      com o aviso sem ter destravado seria trocar um problema silencioso por
      outro.
    - Não montar quando `capabilities.target === 'electron'`? **Não fazer
      isso.** O componente já não aparece porque `canPlaybackAudio` é
      verdadeiro; um ramo por plataforma aqui seria o `if (isElectron)` que a
      arquitetura da fase existe para não ter. Escrever isso em comentário.

    **`AppShell.tsx`**: montar `<AudioPlaybackGate />` num lugar visível
    durante uma call, ao lado do que já existe (a mesma região do
    `<screenShare.Extras />` serve). Uma linha de import e uma de JSX.

    **`AudioPlaybackGate.test.tsx`** (jsdom + `@/test/jsdom-setup`), com o
    contexto de voz mockado: (1) com `canPlaybackAudio: true` não renderiza
    nada; (2) com `false` e intenção de voz, renderiza o aviso; (3) clicar
    chama `startAudio` exatamente uma vez; (4) quando `canPlaybackAudio` vira
    `true`, o aviso some; (5) `startAudio` rejeitando mantém o aviso.
  </action>
  <verify>
    `npx vitest run src/renderer/src/components/shell/AudioPlaybackGate.test.tsx` — 5 testes passando.
    `grep -n "AudioPlaybackStatusChanged" src/renderer/src/state/voice-context.tsx` retorna a linha do efeito.
    `npm run typecheck` + `npm run typecheck:web-target` exit 0; `npx vitest run` sem regressão.
  </verify>
  <done>O bloqueio de autoplay virou um estado observável e um clique que o destrava; no Electron o componente é invisível por construção, não por ramo de código.</done>
</task>

<task type="auto">
  <name>Task 2: Dispositivos de áudio no navegador — permissão explícita e saída que não mente</name>
  <files>src/renderer/src/lib/audio-output-support.ts, src/renderer/src/lib/audio-output-support.test.ts, src/renderer/src/components/shell/VoiceSettingsPopover.tsx</files>
  <action>
    **`lib/audio-output-support.ts`** (novo, função pura e testável):

        export function isAudioOutputSelectable(
          proto: object = HTMLMediaElement.prototype
        ): boolean {
          return 'setSinkId' in proto
        }

    O comentário explica o que está em jogo: `room.switchActiveDevice('audiooutput', id)`
    depende de `HTMLMediaElement.setSinkId`, que é **Chromium-only**. No
    Firefox e no Safari escolher a saída de áudio simplesmente não faz nada —
    e um seletor que não faz nada é pior do que seletor nenhum, porque a
    pessoa conclui que o problema é o fone. VOICE-13 continua satisfeito no
    Electron e no Chrome; nos outros, o app diz que não dá.
    Teste correspondente: com um objeto sem `setSinkId` -> `false`; com um que
    tem -> `true`.

    **`VoiceSettingsPopover.tsx`** — três mudanças, e nenhuma outra:

    1. **Esconder o seletor de SAÍDA quando `!isAudioOutputSelectable()`**, com
       uma linha de texto no lugar dizendo que este navegador não permite
       escolher a saída de áudio e que ela segue a do sistema.

    2. **O pedido de permissão deixa de ser efeito colateral.** Hoje o efeito
       chama `Room.getLocalDevices('audioinput' | 'audiooutput')` ao abrir o
       popover, e o SDK instalado passa `requestPermissions = true` por padrão
       (`livekit-client.esm.mjs:32925-32927`) — ou seja, **abrir o popover
       dispara o prompt do navegador**. No Electron isso é invisível (permissão
       implícita); na web é um prompt do nada, e negar deixa a lista com
       rótulos vazios ("Dispositivo 1, 2, 3") para sempre.
       Mudar para: chamar `getLocalDevices(kind, false)` (sem pedir permissão)
       e, se a lista vier com rótulos vazios ou vazia, mostrar um botão
       explícito — "Permitir acesso ao microfone para ver os nomes dos
       dispositivos" — que aí sim chama a versão que pede permissão e recarrega
       a lista. **Conferir a assinatura de `getLocalDevices` no `.d.ts`
       instalado antes de escrever**; se o segundo parâmetro não existir na
       versão instalada, usar `navigator.mediaDevices.enumerateDevices()`
       direto para a listagem passiva e manter `Room.getLocalDevices` só no
       caminho do botão. Registrar no SUMMARY qual dos dois caminhos foi usado
       e por quê.

    3. Manter intacto todo o resto do arquivo — em especial o medidor de nível
       e a lógica de `ownsTrack` no cleanup. Parar a track do provider ao
       fechar o painel mataria o VAD da sessão inteira; é o erro exato que o
       comentário de lá existe para evitar.
  </action>
  <verify>
    `npx vitest run src/renderer/src/lib/audio-output-support.test.ts` passa.
    `grep -n "isAudioOutputSelectable" src/renderer/src/components/shell/VoiceSettingsPopover.tsx` retorna o uso.
    `npm run typecheck` + `npm run typecheck:web-target` exit 0; `npx vitest run` sem regressão; `npm run build` (desktop) exit 0.
  </verify>
  <done>O seletor de saída só aparece onde funciona, e o prompt de microfone virou uma ação com nome em vez de um efeito colateral de abrir um painel.</done>
</task>

</tasks>

<verification>
**O que passou a ser verificável no Chrome do Windows via `localhost:5173`
(destravado pelo Plano 10-04) — e não era antes:**
- Que o aviso de autoplay aparece de verdade: entrar numa call, recarregar a
  aba (F5) e ver o aviso. Sem o Plano 10-04, isso exigia um build empacotado.
- Que o prompt de microfone acontece quando se pede, e não ao abrir o popover.
- Que os nomes dos dispositivos aparecem depois de conceder a permissão.

**O que continua exigindo mais de uma pessoa (e Windows nativo para o
desktop):**
- Que a voz de fato sai e chega — o teste prova o contrato do portão de
  autoplay, nunca que existe som. Duas pessoas, no roteiro do Plano 10-09.
- Push-to-talk no alvo web numa call real (a trava de `blur` está provada por
  teste desde o Plano 10-02; que ela produz silêncio audível, não).
- Todo o comportamento do desktop: `.planning/CHECKPOINT-WINDOWS.md` continua
  em aberto e nada aqui o substitui.

**Prova de que o desktop não regrediu:**
1. Os 644 testes + os novos passando; `npm run typecheck` e `npm run build`
   verdes; `verify:renderer-runtime` verde.
2. **O argumento de desenho, que vale mais que o comando:** o
   `AudioPlaybackGate` não tem ramo por plataforma. Ele some no Electron
   porque `room.canPlaybackAudio` é verdadeiro lá — o mesmo código, resultado
   diferente. Não existe caminho novo no desktop para regredir.
3. A única mudança de comportamento que o desktop enxerga é o pedido de
   permissão do popover deixar de ser automático — e no Electron a permissão
   é implícita, então a lista continua vindo com rótulos. **Verificar isso
   explicitamente no checkpoint do Plano 10-09** (item: abrir o popover de voz
   no app instalado e conferir que os nomes dos dispositivos ainda aparecem).
</verification>

<success_criteria>
- `AudioPlaybackStatusChanged` observado e `startAudio()` chamado a partir de
  um `onClick`, nunca de um efeito.
- Aviso com `data-testid="audio-playback-gate"` provado nos cinco cenários.
- `isAudioOutputSelectable` puro, testado, e usado para esconder o seletor de
  saída.
- Permissão de microfone pedida por ação nomeada, não por abrir o popover.
- Zero mudança em `attach()`, no efeito de volume por participante, no VAD e na
  fila de transições.
</success_criteria>

<output>
Ao terminar, criar `.planning/phases/10-versao-web/10-05-SUMMARY.md`,
registrando qual caminho foi usado para listar dispositivos sem pedir permissão
(`getLocalDevices` com segundo parâmetro ou `enumerateDevices` direto) e por quê.
</output>
