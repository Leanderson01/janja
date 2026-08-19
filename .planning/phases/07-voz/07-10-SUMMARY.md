---
phase: 07-voz
plan: 10
subsystem: voice
tags: [livekit-client, react, strictmode, concurrency, race-condition]

# Dependency graph
requires:
  - phase: 07-03
    provides: "VoiceProvider (Room real do livekit-client), AUDIO_CAPTURE_OPTIONS centralizado, fila serializada de transições (transitionChainRef)"
provides:
  - "Reivindicação síncrona de alvo (lastEnqueuedTargetRef) em VoiceProvider — fecha a janela de corrida que permitia duas conexões LiveKit reais ao mesmo canal com a mesma identity"
affects: ["07-08 (verificação final humana em Windows — este é o defeito que o log de dois usuários expôs durante esse teste)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reivindicação de intenção síncrona (ref setado ANTES de qualquer await) como guarda de deduplicação de efeito, complementar — não substituta — a uma fila serializada baseada em promise chaining. A fila garante ORDEM de execução; a reivindicação síncrona garante que uma segunda invocação para o MESMO alvo nem chegue a ser enfileirada, o que a fila sozinha não resolve quando a primeira tentativa falha antes de marcar o estado 'conectado' de referência."

key-files:
  created: []
  modified:
    - "src/renderer/src/state/voice-context.tsx"

key-decisions:
  - "Mantive o guard `room.state !== ConnectionState.Disconnected` já existente (adicionado numa tentativa anterior, com um comentário admitindo explicitamente não ser a correção da causa raiz) como segunda camada de defesa, em vez de removê-lo — é barato, correto, e cobre qualquer outra via hipotética que chame `room.connect()` fora desta fila. Atualizei o comentário para não afirmar mais que a causa raiz é desconhecida, já que agora está fechada por `lastEnqueuedTargetRef`."
  - "Não toquei a desconexão de higiene no cleanup do efeito de listeners (`deps=[]`, dispara só em unmount/HMR real, nunca em uma troca normal de canal) — confirmei que `joinedVoiceChannelId` nasce sempre `null` em `SelectionProvider` (useState puro, sem persistência), então esse cleanup nunca corre concorrente com uma conexão real em andamento durante o fluxo de entrar num canal. Interferir ali seria escopo maior que o defeito relatado, e o arquivo continua com esse comportamento pré-existente intacto."

patterns-established:
  - "Quando uma fila serializada (promise chaining) protege ORDEM mas o passo de cada item da fila só marca sucesso ao final (nunca no início), uma segunda invocação para o mesmo item pode reexecutar do zero se a primeira falhar antes de marcar esse sucesso — mesmo com a fila perfeitamente serializada. A correção não é 'serializar melhor', é impedir que a segunda invocação chegue a entrar na fila."

# Metrics
duration: ~40min
completed: 2026-08-19
---

# Phase 07 Plan 10: Correção de Corrida de Conexão Dupla ao LiveKit Summary

**`lastEnqueuedTargetRef`: reivindicação síncrona (antes de qualquer `await`) do alvo de conexão em `VoiceProvider`, fechando a janela em que uma segunda invocação do efeito de transição (StrictMode double-invoke em desenvolvimento, ou qualquer outro disparo espúrio) reconectava do zero ao mesmo canal sempre que a primeira tentativa não chegasse a marcar `activeChannelRef` — produzindo duas sessões LiveKit reais com a mesma identity.**

## O defeito

Um teste com dois usuários gerou, no console de um deles, TODO o ciclo de conexão
duplicado: dois tokens distintos de `joinVoiceChannel`, dois `signal connecting`,
dois `connected to LiveKit Server`, duas `connection state changed: connecting ->
connected`, e dois `disconnect from room`. Como as duas conexões usam a MESMA
identity (`users._id`), o SFU do LiveKit derruba a sessão mais antiga assim que a
segunda entra — o áudio funciona ou não dependendo de qual sobreviveu, o que bate
com a descrição do usuário ("do nada começou a funcionar"), a assinatura de uma
corrida. A outra máquina mostrou uma única conexão e funcionou de primeira.

## Causa raiz

`VoiceProvider` já tinha uma fila serializada (`transitionChainRef`, uma promise
encadeada) para garantir que um `leave` anterior sempre termine antes do próximo
`join` começar. Essa fila **funciona corretamente para ordem de execução** — uma
segunda invocação do efeito de transição sempre roda DEPOIS da primeira terminar
completamente (verificado experimentalmente: `.then()` encadeado num `async
function` só dispara depois que a promise anterior se resolve por inteiro, mesmo
que ambas as invocações do corpo do efeito aconteçam de forma síncrona e
consecutiva, como no double-invoke de desenvolvimento do `<StrictMode>`).

O problema é outro: a única guarda contra trabalho duplicado dentro da fila era
`if (activeChannelRef.current === target) return` — e `activeChannelRef.current`
só é marcado **depois que `joinVoiceChannel` + `room.connect()` +
`setMicrophoneEnabled` resolvem com sucesso**. Se a primeira tentativa (invocação
1) falhar por qualquer motivo ANTES desse ponto — rede instável, uma
interferência externa no `Room`, qualquer coisa — o `catch` da tentativa 1
engole o erro e devolve a intenção (`setJoinedVoiceChannelId(null)`), mas
**nunca marca `activeChannelRef`**. Quando a segunda invocação enfileirada (o
double-invoke do StrictMode gera exatamente duas, para o MESMO alvo, no mesmo
render) chega sua vez na fila, ela vê `activeChannelRef.current !== target`
— exatamente como se nada tivesse acontecido — e tenta o join inteiro DE NOVO,
do zero: novo `joinVoiceChannel` (segundo token), novo `room.connect()` (segunda
conexão real). Uma tentativa anterior já havia adicionado uma trava
(`room.state !== ConnectionState.Disconnected`) bem no ponto de dano, com um
comentário admitindo explicitamente "não consegui explicar a divergência a
partir do log, então esta checagem não é a correção da causa raiz". Essa trava
não fecha a janela: se a tentativa 1 já tiver falhado e o `room` já estiver de
volta a `Disconnected` quando a tentativa 2 chega, a checagem deixa passar.

**Isto não é um bug do StrictMode** — StrictMode só expôs, de forma determinística
e reproduzível em desenvolvimento, um defeito real: nada no código impedia duas
invocações concorrentes/sequenciais do mesmo efeito, para o mesmo alvo, de
tentarem se conectar de forma independente. Uma máquina mais lenta, ou qualquer
outra fonte de uma segunda invocação, produziria o mesmo resultado sem
StrictMode.

## A correção

Adicionado `lastEnqueuedTargetRef` (`useRef<Id<'channels'> | null>(null)`),
atualizado de forma **síncrona, antes de qualquer `await`**, logo no início do
corpo do efeito de transição:

```ts
if (lastEnqueuedTargetRef.current === target) return
lastEnqueuedTargetRef.current = target
```

- **Mesmo alvo, segunda invocação:** vira um no-op imediato — nem chega a
  enfileirar um passo na `transitionChainRef`. Isto fecha a janela inteira:
  não existe mais nenhum caminho em que uma segunda tentativa reconecte do
  zero, porque ela nunca é agendada.
- **Alvo diferente:** sempre reivindica e enfileira normalmente, mesmo com uma
  transição anterior ainda em andamento — a fila serializada continua
  garantindo que o passo mais novo só roda depois do anterior terminar
  (sucesso ou falha), e a lógica de leave-then-join já existente cuida de
  deixar o `Room` conectado ao alvo mais recente. Trocar de canal rapidamente
  continua funcionando exatamente como antes.
- **Sem marcador travado após falha:** no `catch` do join, se a falha
  aconteceu antes de `activeChannelRef` ser marcado (o caso normal — ele só é
  setado depois que `room.connect`/`setMicrophoneEnabled` resolvem), o código
  agora também libera `lastEnqueuedTargetRef.current = null`. Sem isso, uma
  nova tentativa de entrar no MESMO canal (usuário clicando de novo) seria
  descartada pela guarda síncrona, deixando o usuário permanentemente incapaz
  de se conectar depois de uma primeira falha.
- A trava anterior (`room.state !== ConnectionState.Disconnected`) foi
  **mantida** como segunda camada de defesa (barata, correta, cobre qualquer
  via hipotética fora desta fila), só com o comentário atualizado — ela não
  afirma mais que a causa raiz é desconhecida.

## Propriedade verificada

"Intenção entra, conexão correspondente sai": para qualquer sequência de
invocações do efeito de transição (mesmo alvo repetido, alvos diferentes em
sucessão rápida, ou qualquer combinação), o estado final do `Room` sempre
converge para o ÚLTIMO `joinedVoiceChannelId` reivindicado, e nunca existe mais
de uma tentativa de `room.connect()` em voo para o mesmo alvo simultaneamente.
Isto foi verificado por leitura cuidadosa do fluxo completo (reivindicação
síncrona -> fila serializada -> guarda de estado real -> liberação de
reivindicação em falha), não por execução (ambiente sem áudio/janela).

## Verificação executada

- `npm run typecheck` — limpo (node, web, convex).
- `npm run build` — build completo sem erros.
- `npx vitest run` — **173/173 testes passam**, nenhuma regressão (mesmo total
  de antes da mudança; este arquivo não tem testes unitários próprios,
  dependência de um `Room` real do LiveKit não é mockável neste conjunto).

## O que os dois usuários precisam observar no Windows para confirmar

1. Cada pessoa entra num canal de voz (clique normal, sem nada especial).
2. Abrir o console/DevTools do Electron em AMBAS as máquinas durante a entrada.
3. **Confirmar exatamente UM** de cada, por entrada no canal:
   - `signal connecting`
   - `connected to LiveKit Server`
   - `connection state changed: connecting -> connected`
   - Um único token retornado por `joinVoiceChannel` (visível se algum log de
     rede/network tab for inspecionado, ou pela ausência de uma segunda
     conexão nos logs)
4. **Nenhum** `disconnect from room` deve aparecer logo depois de conectar
   (isso indicaria a sessão sendo derrubada pelo dedup de identity do SFU —
   sintoma exato do bug original).
5. Áudio deve fluir nos dois sentidos desde a primeira tentativa, sem o
   comportamento "do nada começou a funcionar" relatado antes.
6. Repetir trocando de canal rapidamente (clicar em outro canal de voz logo
   após entrar no primeiro) — confirmar que o usuário termina conectado ao
   ÚLTIMO canal clicado, sem ficar preso em nenhum estado intermediário.

## Issues Encountered

- Nenhuma reprodução automatizada foi possível neste ambiente (WSL2, sem
  janela do Electron, sem dispositivo de áudio, sem uma segunda instância do
  app para simular dois usuários). A correção foi validada por: (a) prova
  experimental isolada do comportamento de encadeamento de promises que
  fundamenta a fila serializada (confirma que a fila ordena corretamente, mas
  não impedia a reconexão-do-zero após falha), e (b) leitura completa e
  cuidadosa do fluxo do efeito de transição contra a propriedade "intenção
  entra, conexão correspondente sai" para os casos: double-invoke com mesmo
  alvo, alvos diferentes em sucessão, e falha na primeira tentativa.

## Next Phase Readiness

**Pronto:** correção aplicada, tipando/buildando/testando limpo (173/173),
arquivo permanece de posse única de `voice-context.tsx`, nenhum outro arquivo
tocado, nenhum commit criado (orquestrador decide).

**Requer verificação humana:** o roteiro acima, com dois usuários reais no
Windows — é o único ambiente onde o defeito original foi observado e onde a
correção pode ser confirmada com áudio e uma segunda pessoa online.

*Phase: 07-voz*
*Completed: 2026-08-19*
