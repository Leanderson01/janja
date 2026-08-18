---
phase: 03-shell-da-ui
plan: 02
type: execute
wave: 2
depends_on: ["03-01"]
files_modified:
  - src/renderer/src/components/shell/VoiceControlBar.tsx
  - src/renderer/src/components/shell/ChannelSidebar.tsx
autonomous: true

must_haves:
  truths:
    - "Sidebar de canais mostra os canais de texto e voz do servidor selecionado, agrupados por categoria"
    - "Canal de texto com unreadCount > 0 exibe um badge de contagem; clicar num canal de texto o seleciona sem alterar estado de voz"
    - "Canal de voz aninha avatares dos participantes mockados abaixo do nome do canal, com anel de 'falando' e ícone de mute quando aplicável; clicar no canal de voz entra nele (join) e clicar de novo sai (leave)"
    - "Rodapé da sidebar mostra os controles de voz do próprio usuário (mute/deafen) e o estado de conexão (não conectado / conectado a {canal})"
  artifacts:
    - path: "src/renderer/src/components/shell/ChannelSidebar.tsx"
      provides: "Lista de canais por categoria, badge de não lidas, avatares aninhados em canais de voz, navegação/join via contexto"
      min_lines: 40
    - path: "src/renderer/src/components/shell/VoiceControlBar.tsx"
      provides: "Rodapé fixo com mute/deafen local e estado de conexão de voz derivado do contexto"
      min_lines: 25
  key_links:
    - from: "src/renderer/src/components/shell/ChannelSidebar.tsx"
      to: "src/renderer/src/state/selection-context.tsx"
      via: "clique em canal de texto chama setSelectedChannelId; clique em canal de voz chama setSelectedChannelId + setJoinedVoiceChannelId (toggle)"
      pattern: "setJoinedVoiceChannelId"
    - from: "src/renderer/src/components/shell/VoiceControlBar.tsx"
      to: "src/renderer/src/state/selection-context.tsx"
      via: "useSelection().joinedVoiceChannelId determina texto/estado exibido no rodapé"
      pattern: "joinedVoiceChannelId"
---

<objective>
Implementar a sidebar de canais completa — a região que substitui o stub
criado no Plano 01: lista de canais de texto e voz do servidor selecionado,
agrupados por categoria, com badge de não lidas (CHAT-06, antecipado), voz
mostrando participantes atuais aninhados sob o canal (assinatura visual do
Discord, ver FEATURES.md), e o rodapé fixo de controles de voz do próprio
usuário.

Purpose: É a região onde o usuário navega entre canais e decide se entra num
canal de voz — sem ela, `ConversationArea` (Plano 03) não tem como ser
navegada de verdade. Antecipar aqui os slots de F5 (badge de não lidas) e F7
(avatares de voz, mute, estado de conexão) evita retrabalho de CSS quando
essas fases substituírem os dados mockados por reais.
Output: `ChannelSidebar` navegável (troca `selectedChannelId`) e capaz de
"entrar"/"sair" de um canal de voz (`joinedVoiceChannelId`), com
`VoiceControlBar` refletindo esse estado no rodapé.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/03-shell-da-ui/03-RESEARCH.md
@.planning/phases/03-shell-da-ui/03-01-SUMMARY.md
@src/renderer/src/data/mock-data.ts
@src/renderer/src/state/selection-context.tsx
@src/renderer/src/components/shell/AppShell.tsx

# Este plano roda em paralelo aos Planos 03 (área de conversa) e 04 (lista de
# membros) — todos dependem só do Plano 01. Não edite AppShell.tsx,
# mock-data.ts nem selection-context.tsx (já existem e são a fundação
# compartilhada); este plano só cria/reescreve os dois arquivos listados em
# files_modified.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Rodapé de controles de voz</name>
  <files>src/renderer/src/components/shell/VoiceControlBar.tsx</files>
  <action>
    Garantir os componentes shadcn necessários (`button`, `tooltip`) estão
    instalados (rodar o comando de add do shadcn CLI se faltarem). Garantir
    `lucide-react` disponível para os ícones `Mic`, `MicOff`, `Headphones`,
    `PhoneOff` (ou `LogOut`, se `PhoneOff` não existir no set instalado).

    Criar `VoiceControlBar.tsx`: componente de rodapé (`flex-none`, altura
    fixa, ex. `h-14`) que usa `useSelection()` para ler `joinedVoiceChannelId`.
    Estado local (não vai para o contexto compartilhado — é cosmético nesta
    fase): `muted: boolean`, `deafened: boolean`, ambos iniciando `false`.
    Botões de mic e headphones (ícone muda conforme o estado local) que
    alternam `muted`/`deafened` ao clicar; ativar `deafened` também força
    `muted = true` (mesma semântica descrita no design §8: "deafen implica
    mute"); desativar `muted` enquanto `deafened` também desativa `deafened`
    (evita o estado "falando no vácuo", mesma decisão do design).

    Quando `joinedVoiceChannelId` é `null`, mostrar um texto neutro tipo "Não
    conectado a nenhum canal de voz" (os botões de mute/deafen podem ficar
    desabilitados ou simplesmente ocultos neste estado — escolha uma
    abordagem e aplique consistentemente). Quando `joinedVoiceChannelId` tem
    valor, buscar o nome do canal em `mockChannels` (de `mock-data.ts`) e
    mostrar "Conectado a {nome do canal}" mais um botão para sair (chama
    `setJoinedVoiceChannelId(null)` do `useSelection()`).
  </action>
  <verify>Componente compila e renderiza os dois estados (conectado/não conectado) manipulando manualmente `joinedVoiceChannelId` durante o dev (ou, após a Task 2 estar pronta, via clique real num canal de voz). Clicar em mute/deafen alterna os ícones e respeita a regra deafen-implica-mute.</verify>
  <done>VoiceControlBar mostra estado de conexão de voz correto para os dois casos, mute/deafen funcionam localmente com a semântica do design, e o botão de sair limpa joinedVoiceChannelId.</done>
</task>

<task type="auto">
  <name>Task 2: Lista de canais com categorias, badges e participantes de voz</name>
  <files>src/renderer/src/components/shell/ChannelSidebar.tsx</files>
  <action>
    Garantir os componentes shadcn necessários (`scroll-area`, `badge`,
    `avatar`, `separator`) estão instalados. Garantir ícones `Hash`
    (canal de texto) e `Volume2` (canal de voz) disponíveis via
    `lucide-react`.

    Reescrever `ChannelSidebar.tsx` (substituindo o stub do Plano 01) como
    `<div className="h-full flex flex-col">`: uma `ScrollArea` (`flex-1
    min-h-0 overflow-y-auto`) com a lista de canais, e `<VoiceControlBar />`
    (da Task 1) como filho `flex-none` no rodapé.

    Dentro da `ScrollArea`: usar `useSelection()` para ler `selectedServerId`,
    filtrar `mockChannels` por esse `serverId`, agrupar por `category`
    (ex: "TEXTO", "VOZ") com um label de categoria (texto pequeno, maiúsculo,
    `text-muted-foreground`) e um `Separator` entre grupos.

    Canal de texto: ícone `Hash` + nome + (se `unreadCount > 0`) um `Badge`
    com o número; texto do nome em peso mais forte (`font-semibold`) quando
    `unreadCount > 0`, imitando a ênfase visual do Discord para canais não
    lidos. Toda a linha é clicável e chama
    `setSelectedChannelId(channel.id)`. Realce visual (fundo diferente) na
    linha cujo `channel.id === selectedChannelId`.

    Canal de voz: ícone `Volume2` + nome, clicável — clique chama
    `setSelectedChannelId(channel.id)` E alterna `joinedVoiceChannelId`: se já
    é este canal, `setJoinedVoiceChannelId(null)` (sai); senão,
    `setJoinedVoiceChannelId(channel.id)` (entra). Abaixo do nome, indentado,
    renderizar avatares pequenos (~24px) de cada `VoiceParticipant` mockado
    cujo `channelId` bate com este canal (via `mockVoiceParticipants` de
    `mock-data.ts`, resolvendo o `memberId` para o `Member` correspondente em
    `mockMembers` para pegar nome/avatar). Aplicar `ring-2 ring-green-500`
    (ou cor equivalente de destaque) no avatar quando `speaking === true`, e
    um pequeno ícone de mic-cortado sobreposto (canto inferior direito, estilo
    badge) quando `muted === true`.
  </action>
  <verify>No app rodando: canais aparecem agrupados por categoria para o servidor selecionado; trocar de servidor na barra (Plano 01) atualiza a lista de canais mostrada; canal com unreadCount > 0 mostra badge; clicar num canal de texto o realça e não altera o rodapé de voz; clicar num canal de voz realça o canal, faz VoiceControlBar mostrar "Conectado a {canal}", e mostra avatares aninhados com anel de falando/ícone de mute conforme os dados mockados; clicar de novo no mesmo canal de voz volta VoiceControlBar para "Não conectado".</verify>
  <done>ChannelSidebar navega entre canais de texto, entra/sai de canal de voz via clique, mostra badge de não lidas e participantes de voz aninhados com indicadores de falando/mutado.</done>
</task>

</tasks>

<verification>
- Trocar de servidor (barra de servidores) atualiza a lista de canais exibida.
- Canal de texto com `unreadCount > 0` mostra badge; clicar seleciona sem
  afetar o estado de voz.
- Canal de voz mostra participantes aninhados com anel de falando e ícone de
  mute batendo com os dados mockados; clicar entra/sai (toggle) e o rodapé de
  voz reflete a mudança imediatamente.
</verification>

<success_criteria>
- Sidebar de canais funcional de ponta a ponta: categorias, badges de não
  lidas, navegação de canal de texto, join/leave de canal de voz com avatares
  aninhados, e rodapé de controles de voz sincronizado com o contexto.
</success_criteria>

<output>
After completion, create `.planning/phases/03-shell-da-ui/03-02-SUMMARY.md`.
</output>
