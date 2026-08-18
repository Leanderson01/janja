---
phase: 07-voz
plan: 07
type: execute
wave: 5
depends_on: ["07-04", "07-05"]
files_modified:
  - src/renderer/src/lib/voice-preferences.ts
  - src/renderer/src/lib/voice-sounds.ts
  - src/renderer/src/components/shell/VoiceControlBar.tsx
  - src/renderer/src/components/shell/VoiceSettingsPopover.tsx
  - resources/sounds/voice-join.mp3
  - resources/sounds/voice-leave.mp3
autonomous: true

must_haves:
  truths:
    - "Som distinto toca quando o próprio usuário entra/sai de um canal de voz e quando outro participante entra/sai do canal em que o usuário está"
    - "Usuário desativa os sons de canal, e a preferência persiste entre reinícios"
  artifacts:
    - path: "src/renderer/src/lib/voice-sounds.ts"
      provides: "Hook que compara a lista de participantes do canal conectado entre renders e toca o som certo na diferença"
      exports: ["useVoiceJoinLeaveSounds"]
  key_links:
    - from: "src/renderer/src/lib/voice-sounds.ts"
      to: "convex/voice.ts voiceParticipantsByChannel (Plano 07-04)"
      via: "diff entre a lista anterior (useRef) e a lista atual do useQuery, restrito ao canal em joinedVoiceChannelId"
      pattern: "voiceParticipantsByChannel"
---

<objective>
Tocar um som quando alguém entra ou sai do canal de voz em que o usuário
está (diferenciando "eu entrei/saí" de "outra pessoa entrou/saiu"), com um
botão para desligar — sem duplicar lógica de conexão do LiveKit, só
observando a lista de participantes que o Plano 07-04 já expõe via Convex.

Purpose: fecha VOICE-17, o último requisito "de polimento perceptível" da
fase. Feito por último de propósito — depende do módulo de preferências do
Plano 07-05 e da query de participantes do Plano 07-04, e é a peça de menor
risco de toda a Fase 7.
Output: sons de entrada/saída funcionais, com toggle nas configurações de
voz.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/research/FEATURES.md
@src/renderer/src/lib/voice-preferences.ts
@src/renderer/src/components/shell/VoiceControlBar.tsx
@src/renderer/src/components/shell/VoiceSettingsPopover.tsx
@src/renderer/src/state/selection-context.tsx

# Este hook NÃO depende do Room do LiveKit — só do dado reativo do Convex
# (voiceStates) via a query do Plano 07-04. Isso é deliberado: mantém este
# plano sem tocar em voice-context.tsx, evitando mais uma edição sequencial
# naquele arquivo. A lista de sons já vem prevista como asset novo
# (resources/sounds/), não existia antes desta fase.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Toggle de som nas preferências + assets</name>
  <files>src/renderer/src/lib/voice-preferences.ts, resources/sounds/voice-join.mp3, resources/sounds/voice-leave.mp3</files>
  <action>
    Estender `VoicePreferences` (do Plano 07-05) com `soundsEnabled:
    boolean`, default `true` em `DEFAULT_VOICE_PREFERENCES`. Nenhuma outra
    mudança na forma do módulo — `loadVoicePreferences`/`saveVoicePreferences`
    já cobrem o campo novo automaticamente por fazerem merge parcial.

    Adicionar dois arquivos de áudio curtos (~200-400ms cada, características
    de "entrada"/"saída" claramente distintas — um tom ascendente para
    entrada, descendente para saída é o padrão mais comum em apps de voz) em
    `resources/sounds/`. Se não houver um asset de áudio pronto disponível
    neste ambiente de execução, gerar um tom sintético simples (`sox` ou
    equivalente disponível) em vez de deixar o arquivo ausente — o
    requisito é "som existe", não "som com qualidade de produção".
  </action>
  <verify>Os dois arquivos existem em `resources/sounds/` e têm duração audível maior que zero (`ffprobe`/`file` confirmando não estarem corrompidos/vazios).</verify>
  <done>Preferência `soundsEnabled` existe com default `true`; dois assets de áudio distintos existem no repositório.</done>
</task>

<task type="auto">
  <name>Task 2: Hook de diff de participantes + integração</name>
  <files>src/renderer/src/lib/voice-sounds.ts, src/renderer/src/components/shell/VoiceControlBar.tsx, src/renderer/src/components/shell/VoiceSettingsPopover.tsx</files>
  <action>
    `voice-sounds.ts`: `useVoiceJoinLeaveSounds()` — dentro do hook,
    `useSelection()` para `joinedVoiceChannelId`, e
    `useQuery(api.voice.voiceParticipantsByChannel, joinedVoiceChannelId ? { channelId: joinedVoiceChannelId } : 'skip')`
    (padrão de "query condicional" do Convex — não chamar a query quando
    não há canal conectado). Um `useRef<Set<string>>` guarda o conjunto de
    `userId`s da renderização anterior. A cada mudança na lista atual,
    calcular a diferença: IDs que entraram (estavam ausentes, agora
    presentes) e IDs que saíram (estavam presentes, agora ausentes).

    Regras de reprodução, checando sempre `loadVoicePreferences().soundsEnabled`
    antes de tocar qualquer coisa:
    - Um ID que entrou e é o **próprio usuário** (comparar contra o
      `userId` do usuário autenticado, disponível via o mesmo hook de auth
      que o resto do app já usa) → tocar `voice-join.mp3` uma vez (esse é o
      efeito de "eu entrei").
    - Qualquer outro ID que entrou → tocar `voice-join.mp3` também, mas
      **nunca sobrepor dois toques do mesmo som no mesmo tick de diff** — se
      3 pessoas entrarem "ao mesmo tempo" (mesmo batch de atualização
      reativa do Convex), tocar uma vez só, não 3 vezes seguidas.
    - Mesma lógica para saída com `voice-leave.mp3`.
    - **Guarda contra o efeito da reconciliação por webhook** (Plano 07-02):
      se um `userId` sai e volta a entrar dentro de uma janela curta (~2s),
      é provável reconexão/flutuação de rede, não uma saída real — suprimir
      o som de saída nesse caso específico (aceitar como limitação
      documentada, não uma garantia formal: a demora do webhook de fato
      remover a linha pode ainda gerar um som de "saída" tardio isolado em
      alguns casos de crash; é um custo de UX aceitável frente à
      complexidade de resolver perfeitamente, documentar no SUMMARY).
    - No primeiro `useQuery` (transição de "sem dado"/"canal null" para "com
      dado"), **não tocar som nenhum** para os participantes já presentes —
      só a partir da segunda leitura em diante contam como "entrada"
      detectável (senão, entrar num canal com 3 pessoas já dentro tocaria 3
      sons de entrada de uma vez, o que é ruído, não sinal).

    Reproduzir via `new Audio(soundUrl).play()` (import do asset como URL,
    padrão Vite: `import joinSound from '@/../../resources/sounds/voice-join.mp3?url'`
    ou o caminho de import que o `electron-vite` já resolver — confirmar
    contra outros imports de asset existentes no projeto, ex. `icon.png?asset`
    em `src/main/index.ts`, e usar a convenção equivalente do lado
    renderer).

    Chamar `useVoiceJoinLeaveSounds()` de dentro de `VoiceControlBar.tsx`
    (mesmo componente que já é o "centro de controles de voz" — não criar
    um novo ponto de montagem).

    Adicionar um toggle "Sons de canal" em `VoiceSettingsPopover.tsx`
    (Plano 07-05), lendo/escrevendo `soundsEnabled` do mesmo jeito que os
    outros campos do painel.
  </action>
  <verify>Verificação humana no Plano 07-08: dois clientes reais, um entra/sai do canal, o outro ouve o som certo uma vez por evento, e desligar o toggle silencia completamente.</verify>
  <done>Sons tocam nas transições reais de entrada/saída, sem duplicar, sem tocar para o estado inicial já presente, e respeitam o toggle persistido.</done>
</task>

</tasks>

<verification>
- `loadVoicePreferences().soundsEnabled = false` silencia completamente ambos os sons.
- Nenhum som toca para participantes já presentes no primeiro carregamento da query.
</verification>

<success_criteria>
VOICE-17 implementado com toggle persistente, sem ruído de falso-positivo no
carregamento inicial nem duplicação em entradas simultâneas.
</success_criteria>

<output>
After completion, create `.planning/phases/07-voz/07-07-SUMMARY.md`
</output>
