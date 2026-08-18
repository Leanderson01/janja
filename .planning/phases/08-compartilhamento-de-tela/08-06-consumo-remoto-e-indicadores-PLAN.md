---
phase: 08-compartilhamento-de-tela
plan: 06
type: execute
wave: 5
depends_on: ["08-01", "08-04", "08-05"]
files_modified:
  - src/renderer/src/components/shell/ConversationArea.tsx
  - src/renderer/src/components/shell/ChannelSidebar.tsx
  - src/renderer/src/components/shell/MemberList.tsx
autonomous: true

must_haves:
  truths:
    - "Outros participantes da call veem o vídeo da tela compartilhada renderizado na área de conversa, substituindo o placeholder da Fase 3"
    - "Quando quem compartilha para ou cai, os outros voltam ao layout normal automaticamente, sem nenhum frame congelado — a região de vídeo desaparece assim que a track é desinscrita"
    - "Sidebar e lista de membros mostram um indicador visual de quem está compartilhando, mesmo para quem não está no canal de voz"
  artifacts:
    - path: "src/renderer/src/components/shell/ConversationArea.tsx"
      provides: "Renderização real de tracks de tela compartilhada (locais e remotas) via RoomEvent.TrackSubscribed/TrackUnsubscribed, substituindo o placeholder 'chega em F8'"
      contains: "TrackSubscribed"
  key_links:
    - from: "src/renderer/src/components/shell/ConversationArea.tsx"
      to: "livekit-client track.attach()/track.detach()"
      via: "elemento <video> criado/removido pelo próprio SDK, nunca <video src> manual"
      pattern: "track.attach"
    - from: "src/renderer/src/components/shell/ChannelSidebar.tsx"
      to: "convex/voice.ts voiceParticipantsByChannel (07-04)"
      via: "campo sharing já presente na linha de voiceStates retornada pela query — nenhuma query nova"
      pattern: "participant.sharing"
---

<objective>
Fechar o lado de quem assiste: renderizar de verdade a tela compartilhada na
área de conversa (local e remota), garantir que ela some sozinha quando o
compartilhamento para ou o apresentador cai, e mostrar um indicador de quem
está compartilhando nas duas telas que a Fase 3 já reservou para presença de
voz (sidebar, lista de membros) — mesmo para quem não entrou no canal.

Purpose: fecha SHARE-02 e a parte "sem frame congelado" de SHARE-06 do lado
do cliente que recebe (a parte que evita a linha órfã no Convex já foi
resolvida em 08-01; esta é a parte que o dado efêmero do LiveKit resolve
sozinho, no mesmo espírito do Plano 07-04 para fala/qualidade de conexão).
Output: `ConversationArea.tsx` mostra vídeo real; `ChannelSidebar.tsx` e
`MemberList.tsx` mostram um ícone de "compartilhando" onde aplicável.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/08-compartilhamento-de-tela/08-RESEARCH.md
@.planning/phases/07-voz/07-04-presenca-e-participantes-PLAN.md
@src/renderer/src/components/shell/ConversationArea.tsx
@src/renderer/src/components/shell/ChannelSidebar.tsx
@src/renderer/src/components/shell/MemberList.tsx
@src/renderer/src/state/voice-context.tsx
@convex/voice.ts

# Mesma distinção que 07-04 já estabeleceu, aplicada aqui: o VÍDEO em si
# (quem está compartilhando AGORA, o frame renderizado) só existe pra quem
# está conectado ao mesmo Room — dado efêmero do LiveKit, nunca do Convex.
# O ÍCONE de "está compartilhando" na sidebar/member list (pra quem não
# entrou no canal) vem de voiceStates.sharing (Convex, escrito pelo Plano
# 08-05) — dado de aplicação, sempre disponível independente de estar
# conectado. As duas fontes convivem: quem está DENTRO do canal vê o vídeo
# de verdade; quem está FORA só vê o ícone.
#
# Decisão de MVP explícita: se mais de uma pessoa compartilhar
# simultaneamente no mesmo canal, renderizar todas em grid simples (mesma
# disposição flex-wrap já usada em VoiceParticipantGrid) — sem UI de
# "destacar um stream", sem foco exclusivo. Nenhum requisito pede isso, e
# não há sinal de que o grupo vá compartilhar em paralelo com frequência.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Renderização real na área de conversa</name>
  <files>src/renderer/src/components/shell/ConversationArea.tsx</files>
  <action>
    Em `VoiceChannelView` (dentro de `ConversationArea.tsx`), substituir o
    placeholder estático (`MonitorUp` + "Área de compartilhamento de tela —
    chega em F8") por uma região que renderiza vídeo real, só quando
    `channelId === joinedVoiceChannelId` (mesma regra de 07-04: dado
    efêmero do LiveKit só existe para quem está conectado àquele Room
    específico — um canal só visualizado, não conectado, continua mostrando
    o placeholder ou nada, nunca tenta ler tracks que não existem
    localmente).

    Usar `useVoice()` (estendido neste plano ou já suficiente desde 08-02,
    conforme o que existir) para expor uma lista de tracks de tela ativas
    no `room` conectado: escutar
    `room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {...})`
    e `room.on(RoomEvent.TrackUnsubscribed, (track) => {...})`, filtrando
    `track.source === Track.Source.ScreenShare` (vídeo — a track de áudio,
    `Track.Source.ScreenShareAudio`, se anexa sozinha a um elemento de
    áudio invisível via `track.attach()` sem precisar de UI própria, já que
    o objetivo é só ser ouvida). Manter um estado
    `Map<string, { participantIdentity: string; element: HTMLVideoElement }>`
    (chave = `track.sid`) no `voice-context.tsx` (ou localmente no
    componente, o que exigir menos prop drilling — decidir pela mesma
    convenção já usada para `speakingUserIds`/`connectionQualities` em
    07-04, que vive em `voice-context.tsx`).

    **Cobrir também a própria track local** (o presenter também está "no
    canal", e a Fase 3 não distingue visualmente presenter de espectador
    nesta grade) — usar
    `room.localParticipant.on(ParticipantEvent.LocalTrackPublished/LocalTrackUnpublished, ...)`
    ou o mesmo `RoomEvent.TrackPublished`/`TrackUnpublished` que já dispara
    para tracks locais dependendo da versão do SDK (confirmar no
    `08-RESEARCH.md`/typings instalados qual dispara para tracks locais;
    se `TrackSubscribed` só cobrir remotas, usar o par
    `LocalTrackPublished`/`LocalTrackUnpublished` — já usado em 08-02 —
    para a própria track).

    Renderizar cada entrada do `Map` como um `<video ref={...}>` dentro de
    um grid simples (`flex-wrap`, mesmo padrão do `VoiceParticipantGrid`
    já existente neste arquivo) — usar `track.attach()` para obter o
    elemento e anexá-lo via `ref` callback (chamando
    `containerEl.appendChild(track.attach())` no mount da entrada,
    `track.detach().forEach(el => el.remove())` no cleanup), **nunca**
    `<video src={...}>` manual (`08-RESEARCH.md` §6 — é o único jeito de o
    SDK conseguir aplicar `switchActiveDevice('audiooutput', ...)` depois,
    e de os elementos serem limpos corretamente ao desinscrever).

    Se o `Map` estiver vazio (ninguém compartilhando no canal conectado),
    mostrar o mesmo placeholder de antes (ícone `MonitorUp` +
    "Ninguém está compartilhando a tela" em vez do texto antigo "chega em
    F8", que deixou de ser verdade).
  </action>
  <verify>`npm run typecheck` passa. `grep -n "chega em F8" src/renderer/src/components/shell/ConversationArea.tsx` não retorna nada — placeholder desatualizado removido.</verify>
  <done>Área de conversa renderiza vídeo real de tracks de tela (locais e remotas) quando conectado ao canal, e volta ao placeholder assim que a última track de tela é desinscrita — sem frame congelado.</done>
</task>

<task type="auto">
  <name>Task 2: Indicador de compartilhamento na sidebar e na lista de membros</name>
  <files>src/renderer/src/components/shell/ChannelSidebar.tsx, src/renderer/src/components/shell/MemberList.tsx</files>
  <action>
    Em `ChannelSidebar.tsx` (`VoiceChannelRow`, já lendo
    `voiceParticipantsByChannel` desde 07-04): para cada participante com
    `participant.sharing === true`, adicionar um ícone pequeno (`MonitorUp`
    de `lucide-react`, mesmo ícone já usado no placeholder da Task 1) ao
    lado do badge de mute existente — mesma posição relativa ao avatar, só
    mais um badge. Não requer nenhuma query nova: o campo `sharing` já vem
    na linha de `voiceStates` que a query de 07-04 retorna (schema desde
    07-01, escrito desde o Plano 08-05).

    Em `MemberList.tsx` (`MemberAvatar`/`VoiceState`, já lendo
    `voiceParticipantsByServer` desde 07-04): mesmo tratamento — se o tipo
    `VoiceState` usado neste arquivo ainda não inclui `sharing` (07-04 pode
    não ter propagado o campo se só usava `speaking`/`muted`), estender o
    tipo local e o mapeamento que popula `voiceStateFor` para incluir
    `sharing` a partir do dado já retornado pela query (sem query nova).
    Renderizar o mesmo ícone `MonitorUp` como badge adicional, distinto
    visualmente do badge de mute existente (posição diferente no avatar,
    ex. canto superior direito vs inferior direito já usado por mute).
  </action>
  <verify>`npm run typecheck` passa. Inspeção manual: nenhuma nova chamada a `useQuery` foi adicionada nos dois arquivos — o campo `sharing` reaproveita a query já existente de 07-04.</verify>
  <done>Sidebar e lista de membros mostram um ícone de compartilhamento para participantes com `sharing: true`, visível mesmo para quem não está conectado ao canal.</done>
</task>

</tasks>

<verification>
- `ConversationArea.tsx` não usa mais `<video src={...}>` manual — só
  `track.attach()`/`track.detach()`.
- Nenhuma query nova adicionada a `ChannelSidebar.tsx`/`MemberList.tsx` — o
  campo `sharing` vem da query já existente de 07-04.
- O placeholder "chega em F8" não existe mais em nenhum arquivo do projeto.
</verification>

<success_criteria>
SHARE-02 está completo, e a parte de "sem frame congelado" de SHARE-06 está
implementada do lado de quem assiste — reagindo a eventos do LiveKit em
tempo real, sem depender de round-trip ao Convex para a experiência visual
imediata (o Convex, via 08-01, cobre a consistência para quem não está
conectado).
</success_criteria>

<output>
After completion, create `.planning/phases/08-compartilhamento-de-tela/08-06-SUMMARY.md`
</output>
