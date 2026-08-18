---
phase: 06-amigos-e-dms
plan: 07
type: execute
wave: 5
depends_on: ["06-04", "06-05", "06-06"]
files_modified:
  - src/renderer/src/components/shell/AppShell.tsx
  - src/renderer/src/components/friends/FriendsPanel.tsx
  - src/renderer/src/components/friends/DmSidebar.tsx
  - src/renderer/src/components/friends/DmConversationView.tsx
  - src/renderer/src/components/friends/DmMessageList.tsx
autonomous: true

must_haves:
  truths:
    - "Usuário clica em 'Mensagem' num amigo e entra direto numa conversa direta com ele, sem duplicar o canal em cliques repetidos"
    - "Usuário vê a lista de conversas diretas que já tem, na visão Início, e alterna entre elas"
    - "Usuário troca mensagens de texto numa conversa direta e o histórico carrega paginado"
  artifacts:
    - path: "src/renderer/src/components/friends/DmSidebar.tsx"
      provides: "Lista de conversas diretas + atalho para voltar ao painel de amigos"
      contains: "listMyDmChannels"
    - path: "src/renderer/src/components/friends/DmConversationView.tsx"
      provides: "Conversa direta real: histórico paginado + envio de mensagem"
      contains: "usePaginatedQuery"
  key_links:
    - from: "src/renderer/src/components/friends/FriendsPanel.tsx"
      to: "convex/dms.ts (getOrCreateDmChannel)"
      via: "botão Mensagem chama a mutation e navega para selectedDmChannelId"
      pattern: "getOrCreateDmChannel"
    - from: "src/renderer/src/components/friends/DmConversationView.tsx"
      to: "convex/dms.ts (listDmMessages, sendDmMessage)"
      via: "usePaginatedQuery + useMutation, reaproveitando MessageInput da Fase 3"
      pattern: "listDmMessages"
---

<objective>
Fechar SOCIAL-05: a partir do painel de amigos (plano 06-06), abrir uma
conversa direta real com um amigo e trocar mensagens, com histórico paginado
— usando o backend dos planos 06-04/06-05 e a navegação `view`/
`selectedDmChannelId` já criada no plano 06-06.

Purpose: sem este plano, a Fase 6 tem amigos mas não tem para onde ir
conversar com eles — SOCIAL-05 é o único requisito da fase que ainda não tem
nenhuma UI.
Output: sidebar de DMs + visão de conversa direta, integradas ao `AppShell`
existente.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/06-amigos-e-dms/06-RESEARCH.md
@src/renderer/src/components/shell/AppShell.tsx
@src/renderer/src/components/shell/ChannelSidebar.tsx
@src/renderer/src/components/shell/MessageList.tsx
@src/renderer/src/components/shell/MessageInput.tsx
@src/renderer/src/components/friends/FriendsPanel.tsx

# 06-RESEARCH.md §3: paginação real via usePaginatedQuery — tamanho de página
# pode variar entre chamadas, não assumir fixo.
#
# MessageList.tsx (Fase 3) resolve o autor de cada mensagem via
# `mockMembers.find(...)` — acoplado a dado mockado, não serve como está para
# mensagens reais. Numa DM só existem 2 participantes possíveis (eu e o
# outro), então NÃO é preciso um hook de "usuário atual": uma mensagem é
# "minha" sempre que `authorId !== otherUser.userId`. `MessageInput.tsx`, ao
# contrário, já é genérico (`onSend: (content: string) => void`) e é
# reaproveitado tal como está, sem alteração.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Botão Mensagem no painel de amigos</name>
  <files>src/renderer/src/components/friends/FriendsPanel.tsx</files>
  <action>
    Na linha de cada amigo da aba "amigos" (criada no plano 06-06), adicionar
    um segundo botão "Mensagem" (`variant="ghost"`, `size="icon-sm"`, ícone
    `MessageCircle` de lucide-react) ao lado do botão "Remover" já existente.
    Ao clicar, chamar `useMutation(api.dms.getOrCreateDmChannel)({
    friendUserId: userId })`; em sucesso, chamar
    `setSelectedDmChannelId(result)` do `useSelection()` (o `view` já é
    `'home'` nesse ponto, não precisa chamar `goHome()` de novo — só trocar
    qual conteúdo aparece na região central, que passa a ser responsabilidade
    da Task 3/4 deste plano). Envolver em `try/catch`; erro (ex.: se algum
    dado ficou inconsistente e a checagem de amizade da mutation falhar)
    mostra mensagem inline, mesmo padrão já usado nos outros botões deste
    componente.
  </action>
  <verify>`npm run typecheck` passa; `grep -n "getOrCreateDmChannel" src/renderer/src/components/friends/FriendsPanel.tsx` retorna a linha.</verify>
  <done>Clicar em Mensagem num amigo aciona a criação/recuperação do canal de DM e atualiza o estado de navegação.</done>
</task>

<task type="auto">
  <name>Task 2: DmSidebar — lista de conversas diretas</name>
  <files>src/renderer/src/components/friends/DmSidebar.tsx</files>
  <action>
    Criar `DmSidebar.tsx`, mesmo padrão visual de `ChannelSidebar.tsx`
    (`ScrollArea` + linhas com `cn()` para estado selecionado):
    - Linha fixa no topo: "Amigos" (ícone `Users` de lucide-react), sempre
      visível, marcada como ativa quando `selectedDmChannelId === null`; ao
      clicar, `setSelectedDmChannelId(null)` (volta ao `FriendsPanel` sem
      sair de `view === 'home'`).
    - `Separator` (componente já instalado).
    - `useQuery(api.dms.listMyDmChannels)`: uma linha por conversa (Avatar +
      `username#tag` do `otherUser`), marcada como ativa quando
      `channel.dmChannelId === selectedDmChannelId`; ao clicar,
      `setSelectedDmChannelId(channel.dmChannelId)`. Lista vazia: nenhuma
      linha extra além de "Amigos" (sem mensagem de erro, é um estado normal
      para quem ainda não abriu nenhuma conversa).
    - Enquanto `listMyDmChannels` está `undefined` (carregando), não
      renderizar nada abaixo do separador (evita "piscar" um estado vazio
      antes do real).
  </action>
  <verify>`npm run typecheck` passa; `grep -n "listMyDmChannels" src/renderer/src/components/friends/DmSidebar.tsx` retorna a linha.</verify>
  <done>Sidebar de DMs navega entre conversas existentes e volta ao painel de amigos.</done>
</task>

<task type="auto">
  <name>Task 3: DmMessageList + DmConversationView</name>
  <files>src/renderer/src/components/friends/DmMessageList.tsx, src/renderer/src/components/friends/DmConversationView.tsx</files>
  <action>
    Criar `DmMessageList.tsx` — mesmo estilo visual de
    `src/renderer/src/components/shell/MessageList.tsx` (mesmas classes:
    `ScrollArea`, linha com `Avatar`+nome+hora+conteúdo, `hover:bg-accent/50`,
    `timeFormatter` `Intl.DateTimeFormat('pt-BR', {hour: '2-digit', minute:
    '2-digit'})`), mas sem `UnreadDivider` (fora de escopo de SOCIAL-05 — não
    existe requisito de não-lidas para DM nesta fase) e sem depender de
    `mockMembers`. Props:
    ```ts
    type DmMessageListProps = {
      messages: Array<{ _id: string; authorId: string; content: string; createdAt: number }>
      otherUser: { userId: string; username: string; tag: string }
    }
    ```
    Uma mensagem é "minha" quando `message.authorId !== otherUser.userId`
    (única regra possível numa DM de 2 participantes — ver nota em
    `<context>`). Renderiza "Você" para mensagens minhas, `username#tag` do
    `otherUser` para as dele. Lista vazia: "Nenhuma mensagem ainda — diga
    oi!".

    Criar `DmConversationView.tsx`:
    ```ts
    type DmConversationViewProps = { dmChannelId: string }
    ```
    - `const dmChannels = useQuery(api.dms.listMyDmChannels)` e localizar
      `otherUser` do canal atual (`dmChannels?.find(c => c.dmChannelId ===
      dmChannelId)?.otherUser`) — mesma query já usada por `DmSidebar`, o
      Convex reaproveita a subscription, não duplica rede.
    - `const { results, status, loadMore } = usePaginatedQuery(api.dms.listDmMessages, { dmChannelId }, { initialNumItems: 30 })`
      — `results` vem em ordem decrescente (mais recente primeiro, decisão
      do plano 06-05); inverter (`[...results].reverse()`) antes de passar
      pra `DmMessageList`, que espera ordem crescente (mesma convenção de
      `MessageList.tsx`).
    - Botão "Carregar mensagens antigas" no topo da lista, visível só quando
      `status === 'CanLoadMore'`, chamando `loadMore(30)`.
    - `useMutation(api.dms.sendDmMessage)` acoplado ao `MessageInput`
      existente (`import { MessageInput } from
      '@/components/shell/MessageInput'` — reaproveitado sem alteração,
      já é genérico): `onSend={(content) => sendDmMessage({ dmChannelId, content })}`,
      dentro de `try/catch` (erro visível numa linha de texto acima do
      input, mesmo padrão dos outros formulários desta fase).
    - Enquanto `otherUser` ainda não resolveu (`undefined`), mostrar
      "Carregando conversa...".
    Layout: `h-full flex flex-col`, cabeçalho simples com o nome do
    `otherUser` (mesma altura/estilo de `ChannelHeader.tsx`, `h-12` +
    `border-b`), depois `DmMessageList` em `flex-1 min-h-0`, depois
    `MessageInput`.
  </action>
  <verify>
    `npm run typecheck` e `npm run build` passam.
    `grep -n "usePaginatedQuery" src/renderer/src/components/friends/DmConversationView.tsx` retorna a linha.
    `grep -n "MessageInput" src/renderer/src/components/friends/DmConversationView.tsx` confirma reaproveitamento do componente da Fase 3.
  </verify>
  <done>Conversa direta real: histórico paginado (mais antigo carregável sob demanda) + envio de mensagem funcionando sobre o backend do plano 06-05.</done>
</task>

<task type="auto">
  <name>Task 4: Wiring final em AppShell</name>
  <files>src/renderer/src/components/shell/AppShell.tsx</files>
  <action>
    Ajustar o branch `view === 'home'` criado no plano 06-06: no lugar da
    coluna que hoje mostra só `FriendsPanel`, renderizar `DmSidebar` na
    posição da segunda coluna (onde `ChannelSidebar` fica na visão de
    servidor, mesma largura `w-60`) e, na região central, alternar entre
    `FriendsPanel` (quando `selectedDmChannelId === null`) e
    `DmConversationView` (passando `dmChannelId={selectedDmChannelId}`,
    quando não for `null`). Continuar sem `MemberList` na visão Início
    (decisão já registrada no plano 06-06/`06-RESEARCH.md §7`).
  </action>
  <verify>
    `npm run build` passa.
    Leitura de código confirma que a visão de servidor (`view === 'server'`) não foi tocada por este plano.
  </verify>
  <done>AppShell alterna corretamente entre as 4 combinações (servidor / início-painel-amigos / início-lista-vazia-de-dm / início-conversa-aberta) sem quebrar a visão de servidor.</done>
</task>

</tasks>

<verification>
- `npm run build` passa.
- `npm run typecheck` passa.
- Nenhum arquivo da visão de servidor (`ChannelSidebar.tsx`, `ConversationArea.tsx`, `MemberList.tsx`, `MessageList.tsx`, `MessageInput.tsx`, `VoiceControlBar.tsx`, `ChannelHeader.tsx`) foi modificado por este plano — só `AppShell.tsx` (ponto de composição) e os arquivos novos/de `FriendsPanel.tsx`.
</verification>

<success_criteria>
SOCIAL-05 completo de ponta a ponta: abrir conversa a partir de um amigo,
navegar entre conversas existentes, trocar mensagens, histórico paginado —
tudo sobre dados reais do Convex. Com isso, SOCIAL-01 a SOCIAL-06 têm UI
funcional, faltando só a verificação humana com duas contas (plano 06-08).
</success_criteria>

<output>
After completion, create `.planning/phases/06-amigos-e-dms/06-07-SUMMARY.md`.
</output>
