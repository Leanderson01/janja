---
phase: 10-versao-web
plan: 08
type: execute
wave: 5
depends_on: ["10-05", "10-06"]
files_modified:
  - src/renderer/src/components/shell/ChannelSidebar.tsx
  - src/renderer/src/components/shell/OtherDeviceVoiceDialog.tsx
  - src/renderer/src/components/shell/OtherDeviceVoiceDialog.test.tsx
  - src/renderer/src/lib/other-device-voice.ts
  - src/renderer/src/lib/other-device-voice.test.ts
  - src/renderer/src/state/voice-context.tsx
autonomous: true

must_haves:
  truths:
    - "Antes de entrar num canal de voz onde a própria pessoa já aparece por outro dispositivo, o app avisa e exige confirmação"
    - "Confirmar entra normalmente; cancelar não entra e não altera nada"
    - "Quando o SFU derruba esta sessão por identidade duplicada, a pessoa lê o motivo em vez de ver a call sumir sem explicação"
    - "A decisão de avisar sai de uma função pura, testada, e não de lógica espalhada no componente"
    - "Nenhuma mudança em `convex/` — nenhum push do Convex é necessário para esta fase"
  artifacts:
    - path: "src/renderer/src/lib/other-device-voice.ts"
      provides: "decide se o aviso deve aparecer, a partir do que a sidebar já assina"
      exports: ["isSelfInVoiceElsewhere"]
    - path: "src/renderer/src/lib/other-device-voice.test.ts"
      provides: "prova dos quatro casos, incluindo o falso positivo mais provável"
      min_lines: 70
    - path: "src/renderer/src/components/shell/OtherDeviceVoiceDialog.tsx"
      provides: "confirmação antes do join, com o texto que diz o que vai acontecer"
      min_lines: 60
  key_links:
    - from: "src/renderer/src/components/shell/ChannelSidebar.tsx"
      to: "src/renderer/src/lib/other-device-voice.ts"
      via: "isSelfInVoiceElsewhere decidindo entre entrar direto e pedir confirmação"
      pattern: "isSelfInVoiceElsewhere"
    - from: "src/renderer/src/state/voice-context.tsx"
      to: "livekit-client"
      via: "DisconnectReason.DUPLICATE_IDENTITY virando mensagem legível"
      pattern: "DUPLICATE_IDENTITY"
---

<objective>
Tratar o caso que não existia antes desta fase: **a mesma pessoa em dois
clientes ao mesmo tempo.**

Purpose: nada no backend precisa mudar — sessão, presença, chat e não-lidas
convivem sem problema (`ensureUser` é idempotente por `workosId`, o heartbeat é
upsert por `userId`). **Voz é a exceção, e o estrago é maior do que parece.** O
`identity` do token do LiveKit é o `users._id` do Convex
(`convex/voiceToken.ts:80`); duas conexões simultâneas com o mesmo identity no
mesmo room fazem o SFU derrubar uma — o próprio repo documenta isso em
`voiceToken.ts:103-105`, e a lição nº 3 do HANDOFF nasceu desse sintoma. O
efeito colateral é o que machuca: o cliente derrubado gera um
`participant_left` no webhook, e o `reconcileParticipantLeft`
(`convex/voice.ts:193-205`) **apaga a linha de `voiceStates` do par
(channelId, userId)** — inclusive para o cliente que ficou. Resultado: a pessoa
continua falando e ouvindo, e **some da lista de participantes para todo
mundo**.

**Por que não sufixar o identity com um id de sessão** (a alternativa nomeada
pela pesquisa): além de obrigar a mudar o mapeamento
`participant.identity -> userId` do webhook (`convex/http.ts` +
`voiceToken.ts:210`) e reabrir o Pitfall 3, **ela não resolve o problema**.
`voiceStates` tem uma linha por `(channelId, userId)`; com duas sessões da
mesma pessoa no mesmo canal continuaria havendo UMA linha, e a saída de
qualquer uma delas continuaria apagando a linha da outra. Suportar duas sessões
de voz da mesma pessoa é mudança de produto (uma linha por sessão), não um
ajuste de identity. **Critério para reabrir:** só se "a mesma pessoa em dois
dispositivos na mesma call" virar requisito. Hoje não é.

Output: um aviso honesto antes do join, uma explicação quando o SFU derruba, e
zero linhas alteradas em `convex/`.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-versao-web/10-RESEARCH.md
@.planning/phases/10-versao-web/10-05-SUMMARY.md
@src/renderer/src/components/shell/ChannelSidebar.tsx
@src/renderer/src/state/voice-context.tsx

# O backend que este plano NÃO toca — leitura obrigatória para entender o
# estrago, e para confirmar que a query usada já existe
@convex/voice.ts
@convex/voiceToken.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: A decisão, como função pura, sobre dados que a sidebar já assina</name>
  <files>src/renderer/src/lib/other-device-voice.ts, src/renderer/src/lib/other-device-voice.test.ts</files>
  <action>
    **Nenhuma query nova no Convex.** Esta é a restrição de desenho do plano, e
    o motivo é concreto: uma função nova em `convex/` só existe no deployment
    depois de um `npx convex deploy`, que nenhum agente pode rodar aqui — e um
    cliente chamando função inexistente falha em runtime, **para o desktop
    também**. O dado necessário já está no ar: `ChannelSidebar` assina
    `api.voice.voiceParticipantsByChannel` por canal de voz
    (linha ~524) e `api.users.me` já é usada em quatro telas. Cada linha
    devolvida por `enrichVoiceStates` carrega `channelId` e `userId`
    (`convex/voice.ts:277-296`).

        export function isSelfInVoiceElsewhere(input: {
          /** `users._id` da pessoa logada, ou null enquanto carrega. */
          myUserId: string | null
          /** Linhas de voiceStates visíveis agora (qualquer canal). */
          participants: Array<{ channelId: string; userId: string }>
          /** Canal ao qual ESTE cliente está conectado agora, ou null. */
          joinedChannelId: string | null
          /** Canal em que a pessoa acabou de clicar. */
          targetChannelId: string
        }): boolean

    Regra, e cada `false` é uma armadilha evitada:
    - `false` se `myUserId` for `null` (ainda carregando — **nunca bloquear o
      join por dado ausente**; o pior caso do falso negativo é o
      comportamento de hoje, e o do falso positivo é um diálogo no caminho de
      quem não fez nada de errado).
    - `false` se `joinedChannelId !== null` — **este é o falso positivo mais
      provável e o mais importante de matar**: se este mesmo cliente já está
      numa call, a própria linha dele aparece na lista. Avisar aí seria o app
      alertando sobre si mesmo.
    - `true` somente se existir linha com `userId === myUserId` (em qualquer
      `channelId`, inclusive o alvo) e `joinedChannelId === null`.

    Teste, um por regra, mais o caso "outra pessoa está no canal" -> `false`.

    **Registrar no comentário do arquivo a lacuna conhecida, sem maquiar:**
    a sidebar só assina os canais do servidor SELECIONADO. Se a outra sessão
    estiver num canal de voz de OUTRO servidor, este aviso não dispara, e a
    rede de segurança é a Task 2. Fechar essa lacuna exigiria uma query nova
    por `by_user` — **o critério para fazê-la é o checkpoint do Plano 10-09
    mostrar que o caso acontece de verdade**, e não a sensação de
    incompletude.
  </action>
  <verify>`npx vitest run src/renderer/src/lib/other-device-voice.test.ts` — 5 testes passando; `npm run typecheck` + `npm run typecheck:web-target` exit 0; `git diff --stat convex/` **vazio**.</verify>
  <done>A decisão de avisar é pura, testada, e usa só dado que já está no ar.</done>
</task>

<task type="auto">
  <name>Task 2: A confirmação antes do join e a explicação quando o SFU derruba</name>
  <files>src/renderer/src/components/shell/OtherDeviceVoiceDialog.tsx, src/renderer/src/components/shell/OtherDeviceVoiceDialog.test.tsx, src/renderer/src/components/shell/ChannelSidebar.tsx, src/renderer/src/state/voice-context.tsx</files>
  <action>
    **`OtherDeviceVoiceDialog.tsx`** — diálogo de confirmação sobre os
    primitivos que o projeto já usa (`radix-ui` via `components/ui/`, mesmo
    padrão de `EditProfileDialog`). Texto que diz o que vai acontecer, não o
    que aconteceu:

    > Você já está num canal de voz em outro dispositivo. Entrar aqui vai
    > desconectar o outro.

    Dois botões: "Entrar mesmo assim" e "Cancelar". `data-testid` nos dois e no
    diálogo. Fechar por Esc ou clique fora equivale a cancelar — **e o teste
    precisa provar isso**, porque um caminho de fechamento que não cancela
    deixa o clique original pendurado (a mesma classe de defeito dos 9 caminhos
    de `callback()` do seletor de tela, Pitfall 2 da Fase 8).

    **`ChannelSidebar.tsx`** — em `handleVoiceChannelClick` (linha ~128), o
    ramo de "entrar/trocar de canal" passa por `isSelfInVoiceElsewhere`:
    - `false` -> comportamento atual, sem mudança nenhuma
      (`setSelectedChannelId` + `setJoinedVoiceChannelId`, nessa ordem — o
      comentário longo de lá explica por que a ordem importa com o palco);
    - `true` -> guardar o canal pretendido em estado local e abrir o diálogo;
      confirmar executa exatamente o mesmo par de chamadas; cancelar limpa o
      estado e **não faz nada**.
    - O ramo "clicou no canal em que já estou" (`showStage()`) fica **intocado**
      — ele nem chega perto do join.
    Reunir as linhas de `voiceStates` que a sidebar já tem para alimentar
    `participants`; se hoje elas vivem no componente-filho por canal (linha
    ~524), levantar o mínimo necessário para o componente que trata o clique
    **sem** duplicar assinaturas — `useQuery` do Convex com os mesmos
    argumentos é deduplicado pelo cliente, então uma assinatura a mais do mesmo
    canal não custa rede; duplicar a lógica de leitura, sim, custa.

    **`voice-context.tsx`** — no handler de `RoomEvent.Disconnected` (ou
    acrescentando um, se hoje só houver o de estado de conexão), quando o
    `reason` for `DisconnectReason.DUPLICATE_IDENTITY`, mostrar um
    `toast` explicando:

    > Sua conexão de voz foi encerrada porque você entrou nesta call em outro
    > dispositivo.

    e logar `console.warn` com o canal e o motivo. **Não tentar reconectar** —
    reconectar aqui é um laço: as duas sessões se derrubariam alternadamente,
    para sempre. Escrever isso em comentário, porque "tentar de novo" é
    exatamente o reflexo errado neste ponto.
    **Não** mexer na fila serializada de transições, na reivindicação síncrona
    de alvo (07-10) nem em nenhum outro caminho de `Disconnected`: um `reason`
    novo tratado, nada mais.

    **`OtherDeviceVoiceDialog.test.tsx`** (jsdom): (1) confirmar chama o
    callback de entrada uma vez; (2) cancelar não chama; (3) Esc não chama;
    (4) o texto exibido contém "outro dispositivo".
  </action>
  <verify>
    `npx vitest run src/renderer/src/components/shell/OtherDeviceVoiceDialog.test.tsx` — 4 testes passando.
    `npx vitest run src/renderer/src/components/shell/ChannelSidebar.test.tsx` — os 11 testes existentes continuam passando **sem alteração de asserção** (o caminho sem aviso é o caminho de hoje).
    `grep -n "DUPLICATE_IDENTITY" src/renderer/src/state/voice-context.tsx` retorna o tratamento.
    `git diff --stat convex/` vazio.
    `npm run typecheck` + `npm run typecheck:web-target` + `npm run lint` exit 0; `npx vitest run` sem regressão; `npm run build` e `npm run build:web` exit 0.
  </verify>
  <done>O join arriscado pede confirmação, o cliente derrubado explica o motivo, e o caminho normal de entrar num canal continua idêntico ao de hoje.</done>
</task>

</tasks>

<verification>
**O que passou a ser verificável NESTE ambiente (WSL2):**
- A decisão de avisar (função pura, 5 casos) e o diálogo (4 casos), incluindo o
  falso positivo que mais assustaria: o app avisando sobre a própria sessão.
- Que os 11 testes de `ChannelSidebar` sobreviveram sem alteração de asserção
  — a prova de que o caminho comum não mudou.

**O que só se prova com os dois clientes rodando (Plano 10-09, ~10 min,
sozinho — e é o teste que mais provavelmente acha bug):**
- Que o aviso aparece de verdade quando o desktop está numa call e a web tenta
  entrar no mesmo canal.
- Que confirmar realmente derruba o outro cliente, e que o cliente derrubado
  mostra a mensagem de identidade duplicada.
- **O estrago que este plano NÃO corrige:** depois da derrubada, a linha de
  `voiceStates` do par `(canal, usuário)` é apagada pelo webhook, e a pessoa
  pode continuar ouvindo e falando enquanto some da lista para todo mundo. O
  aviso reduz a chance de acontecer; ele não impede quem confirmar. **Observar
  e registrar exatamente isso no checkpoint** — se acontecer, é o dado que
  justifica (ou não) a mudança de produto de uma linha de `voiceStates` por
  sessão.

**Prova de que o desktop não regrediu:**
1. `git diff --stat convex/` vazio — **nenhum push do Convex é necessário nesta
   fase inteira.** O deployment que as dez pessoas usam não muda.
2. Os 11 testes de `ChannelSidebar` intactos; os 644 passando; typecheck, lint
   e build verdes.
3. O aviso é dado, não plataforma: no desktop ele aparece pela mesma regra, e
   isso é correto — entrar pelo desktop enquanto a web está numa call tem
   exatamente a mesma consequência. **Este é o único ponto da fase em que o
   desktop ganha comportamento novo de propósito**, e o checkpoint do Plano
   10-09 tem um item só para ele.
</verification>

<success_criteria>
- `isSelfInVoiceElsewhere` puro e testado, com o falso positivo de "já estou
  nesta call" coberto.
- Diálogo com confirmar/cancelar/Esc provados.
- `DUPLICATE_IDENTITY` tratado com mensagem e sem reconexão automática.
- `convex/` com diff vazio.
- Testes existentes de `ChannelSidebar` sem alteração de asserção.
</success_criteria>

<output>
Ao terminar, criar `.planning/phases/10-versao-web/10-08-SUMMARY.md`, com a
lacuna conhecida (outro servidor) escrita por extenso e o critério objetivo que
decidiria implementar a query `by_user` no Convex numa fase futura.
</output>
