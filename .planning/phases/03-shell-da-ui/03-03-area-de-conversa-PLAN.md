---
phase: 03-shell-da-ui
plan: 03
type: execute
wave: 2
depends_on: ["03-01"]
files_modified:
  - src/renderer/src/components/shell/ChannelHeader.tsx
  - src/renderer/src/components/shell/MessageList.tsx
  - src/renderer/src/components/shell/MessageInput.tsx
  - src/renderer/src/components/shell/ConversationArea.tsx
autonomous: true

must_haves:
  truths:
    - "Selecionar um canal de texto mostra suas mensagens mockadas na área de conversa, com cabeçalho exibindo o nome e ícone do canal"
    - "Um divisor 'novas mensagens' aparece na mensagem marcada como firstUnreadMessageId de pelo menos um canal"
    - "Selecionar um canal de voz troca a área de conversa para uma visão de participantes (grid de avatares) com um placeholder de área de compartilhamento de tela, em vez da lista de mensagens"
    - "Digitar e enviar uma mensagem no campo de texto a adiciona imediatamente à lista visível (echo local, sem persistência entre trocas de canal)"
  artifacts:
    - path: "src/renderer/src/components/shell/ConversationArea.tsx"
      provides: "Composição condicional: chat (texto) vs grid de participantes + placeholder de screenshare (voz), lida a partir do canal selecionado"
      min_lines: 35
    - path: "src/renderer/src/components/shell/MessageList.tsx"
      provides: "Lista rolável de mensagens mockadas com divisor de não lidas"
      min_lines: 25
    - path: "src/renderer/src/components/shell/MessageInput.tsx"
      provides: "Campo de texto + botão de enviar com callback onSend"
      min_lines: 15
    - path: "src/renderer/src/components/shell/ChannelHeader.tsx"
      provides: "Cabeçalho com ícone (texto/voz) e nome do canal selecionado"
      min_lines: 10
  key_links:
    - from: "src/renderer/src/components/shell/ConversationArea.tsx"
      to: "src/renderer/src/state/selection-context.tsx"
      via: "useSelection().selectedChannelId e joinedVoiceChannelId decidem qual visão renderizar"
      pattern: "selectedChannelId"
    - from: "src/renderer/src/components/shell/ConversationArea.tsx"
      to: "src/renderer/src/data/mock-data.ts"
      via: "filtra mockMessages por channelId e localiza firstUnreadMessageId para posicionar o divisor"
      pattern: "firstUnreadMessageId"
---

<objective>
Implementar a área de conversa completa — a região central e elástica do
shell — substituindo o stub do Plano 01: cabeçalho de canal, lista de
mensagens mockadas com divisor de não lidas (CHAT-05, antecipado), campo de
envio com eco local, e uma visão alternativa para canal de voz que já reserva
o espaço onde o compartilhamento de tela (F8) vai aparecer.

Purpose: É a região que prova o critério de sucesso #3 da fase — "navegar
entre canal muda a área de conversa sem exigir backend". Antecipar aqui o
divisor de não lidas e o slot de screenshare evita que F5 e F8 precisem
redesenhar esta região do zero.
Output: `ConversationArea` que renderiza chat para canais de texto e uma
visão de participantes + placeholder de compartilhamento para canais de voz,
inteiramente orientada pelo `selectedChannelId`/`joinedVoiceChannelId` do
contexto criado no Plano 01.
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

# Este plano roda em paralelo aos Planos 02 (sidebar de canais) e 04 (lista de
# membros) — todos dependem só do Plano 01. Não edite AppShell.tsx,
# mock-data.ts, selection-context.tsx nem ChannelSidebar.tsx/MemberList.tsx;
# este plano só cria/reescreve os quatro arquivos listados em
# files_modified.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Cabeçalho do canal</name>
  <files>src/renderer/src/components/shell/ChannelHeader.tsx</files>
  <action>
    Criar `ChannelHeader.tsx`: barra fixa (`flex-none h-12`, borda inferior)
    que usa `useSelection()` para ler `selectedChannelId`, busca o `Channel`
    correspondente em `mockChannels` (`mock-data.ts`), e mostra o ícone
    apropriado (`Hash` do `lucide-react` se `type === 'text'`, `Volume2` se
    `type === 'voice'`) seguido do nome do canal. Se nenhum canal for
    encontrado (estado impossível dado o Plano 01, mas trate mesmo assim),
    renderizar um fallback neutro em vez de quebrar.
  </action>
  <verify>Componente renderiza o ícone e nome corretos para um canal de texto e para um canal de voz mockados (testar manualmente trocando o `selectedChannelId` inicial ou aguardando a Task 3 integrar).</verify>
  <done>ChannelHeader mostra ícone + nome coerentes com o tipo do canal selecionado.</done>
</task>

<task type="auto">
  <name>Task 2: Lista de mensagens (com divisor) e campo de envio</name>
  <files>src/renderer/src/components/shell/MessageList.tsx, src/renderer/src/components/shell/MessageInput.tsx</files>
  <action>
    Garantir componentes shadcn necessários (`scroll-area`, `avatar`,
    `separator`, `textarea`, `button`) instalados.

    Criar `MessageList.tsx` recebendo via props `messages: Message[]` (já
    filtradas e ordenadas por `createdAt` pelo componente pai) e
    `firstUnreadMessageId?: string`. Renderizar dentro de uma `ScrollArea`
    (`flex-1 min-h-0 overflow-y-auto`, seguindo o padrão `min-h-0` do
    RESEARCH.md §3): para cada mensagem, um `Avatar` pequeno do autor
    (resolver `authorId` em `mockMembers`), nome (`username#tag`), horário
    formatado, e o conteúdo. Imediatamente ANTES da mensagem cujo `id ===
    firstUnreadMessageId`, renderizar um divisor visualmente distinto: uma
    linha horizontal com um rótulo centralizado "NOVAS MENSAGENS" (cor de
    destaque, ex: vermelho/laranja como no Discord real). Se `messages` está
    vazio, renderizar um estado vazio simples ("Nenhuma mensagem ainda").

    Criar `MessageInput.tsx` recebendo via props `onSend: (content: string)
    => void`. Um `Textarea` (shadcn) com um `Button` de enviar (ícone `Send`
    do `lucide-react`) ao lado ou dentro do campo. Enter sem Shift também
    envia (comportamento padrão de chat). Ao enviar: chama `onSend(content)`
    com o texto atual, limpa o campo. Não valida nem persiste nada — é eco
    puramente local, o estado das mensagens enviadas vive no componente pai
    (`ConversationArea`, Task 3).
  </action>
  <verify>MessageList renderiza uma lista de mensagens de exemplo com o divisor aparecendo na posição correta e o estado vazio funcionando quando a lista é `[]`. MessageInput dispara `onSend` com o texto correto ao clicar no botão e ao pressionar Enter (sem Shift), e limpa o campo depois.</verify>
  <done>MessageList mostra mensagens ordenadas com divisor de não lidas opcional; MessageInput captura texto e propaga via onSend, incluindo atalho de Enter.</done>
</task>

<task type="auto">
  <name>Task 3: Composição da área de conversa (texto vs voz)</name>
  <files>src/renderer/src/components/shell/ConversationArea.tsx</files>
  <action>
    Reescrever `ConversationArea.tsx` (substituindo o stub do Plano 01) como
    `<div className="h-full flex flex-col">` com `ChannelHeader` (Task 1) no
    topo (`flex-none`).

    Usar `useSelection()` para ler `selectedChannelId` e resolver o `Channel`
    em `mockChannels`. Se `channel.type === 'text'`: manter um estado local
    `sentMessages: Message[]` (inicia vazio, reseta — via `key={channel.id}`
    no elemento raiz do corpo, ou um `useEffect` que limpa ao trocar de
    canal — escolha uma abordagem e documente na SUMMARY); compor a lista
    final a exibir como `[...mockMessages.filter(m => m.channelId ===
    channel.id), ...sentMessages]` ordenada por `createdAt` (mensagens
    locais recebem `createdAt: Date.now()` no momento do envio); renderizar
    `MessageList` (`flex-1 min-h-0`) passando essa lista e o
    `firstUnreadMessageId` do canal, e `MessageInput` (`flex-none`) no
    rodapé, cujo `onSend` cria a nova mensagem local (com `id` gerado, ex.
    `crypto.randomUUID()`) e a adiciona a `sentMessages`.

    Se `channel.type === 'voice'`: renderizar uma visão alternativa
    (`flex-1 min-h-0 flex flex-col items-center justify-center gap-4`) com:
    (a) um grid de avatares grandes (~80px) de cada `VoiceParticipant`
    mockado deste canal (mesmo padrão de anel de falando / ícone de mute do
    Plano 02, reaproveitando a mesma lógica de leitura de
    `mockVoiceParticipants`); (b) abaixo, um painel placeholder claramente
    identificado (ícone `MonitorUp` do `lucide-react` + texto "Área de
    compartilhamento de tela — chega em F8") ocupando o espaço restante, para
    que F8 tenha onde plugar sem redesenhar o layout.
  </action>
  <verify>No app rodando: com um canal de texto selecionado, mensagens mockadas aparecem, o divisor "novas mensagens" está visível na posição esperada, digitar e enviar uma mensagem a adiciona ao final da lista imediatamente. Trocar para um canal de voz (via clique na sidebar, se o Plano 02 já rodou, ou manualmente via contexto) troca a área de conversa inteira para o grid de participantes + placeholder de screenshare, sem lista de mensagens nem campo de texto visíveis.</verify>
  <done>ConversationArea alterna corretamente entre visão de chat e visão de voz conforme o tipo do canal selecionado; envio local de mensagem funciona; placeholder de screenshare está presente e identificável para F8.</done>
</task>

</tasks>

<verification>
- Canal de texto selecionado: cabeçalho, mensagens ordenadas, divisor de não
  lidas na posição correta, envio local funcional.
- Canal de voz selecionado: grid de participantes com indicadores de
  falando/mutado, placeholder de screenshare visível, nenhum elemento de chat
  de texto presente.
- Trocar de canal (texto → texto, texto → voz, voz → texto) atualiza a área
  de conversa imediatamente, sem exigir reload.
</verification>

<success_criteria>
- Área de conversa cobre o critério de sucesso #3 da fase: navegar entre
  canais fictícios muda a área de conversa sem nenhum backend.
- Slots para F5 (divisor de não lidas) e F8 (screenshare) já existem visual e
  estruturalmente, mesmo que com dados/placeholder mockados.
</success_criteria>

<output>
After completion, create `.planning/phases/03-shell-da-ui/03-03-SUMMARY.md`.
</output>
