---
phase: 04-servidores-e-canais
plan: 06
type: execute
wave: 4
depends_on: ["04-05", "04-02", "04-03"]
files_modified:
  - src/renderer/src/components/shell/ChannelSidebar.tsx
  - src/renderer/src/components/shell/ChannelHeader.tsx
  - src/renderer/src/components/shell/ConversationArea.tsx
  - src/renderer/src/components/shell/VoiceControlBar.tsx
  - src/renderer/src/components/shell/CreateChannelDialog.tsx
  - src/renderer/src/components/shell/InviteDialog.tsx
autonomous: true

must_haves:
  truths:
    - "Sidebar de canais mostra os canais reais do servidor selecionado, não mais os canais mockados da Fase 3"
    - "Membro do servidor cria um canal de texto ou de voz pela UI e o vê aparecer na sidebar imediatamente"
    - "Cabeçalho e área de conversa mostram nome/tipo reais do canal selecionado, sem crash quando não há canal nenhum"
    - "Dono do servidor consegue ver, copiar, gerar novamente e revogar o código de convite pela UI"
  artifacts:
    - path: "src/renderer/src/components/shell/CreateChannelDialog.tsx"
      provides: "Dialog para criar canal de texto/voz (SRV-05)"
      contains: "createChannel"
    - path: "src/renderer/src/components/shell/InviteDialog.tsx"
      provides: "Dialog de gestão de convite: ver/copiar código ativo, gerar novo, revogar (SRV-02, SRV-04) — ações de dono condicionadas por amIOwner"
      contains: "amIOwner"
  key_links:
    - from: "src/renderer/src/components/shell/ChannelSidebar.tsx"
      to: "convex/channels.ts (listChannels)"
      via: "useQuery(api.channels.listChannels, { serverId })"
      pattern: "listChannels"
    - from: "src/renderer/src/components/shell/ChannelHeader.tsx"
      to: "convex/channels.ts (getChannel)"
      via: "useQuery(api.channels.getChannel, { channelId })"
      pattern: "getChannel"
    - from: "src/renderer/src/components/shell/InviteDialog.tsx"
      to: "convex/invites.ts (generateInvite, revokeInvite, getActiveInvite)"
      via: "useMutation/useQuery apontando para convex/invites.ts, gated por useQuery(api.servers.amIOwner)"
      pattern: "generateInvite"
---

<objective>
Trocar a fonte de dados de canais (sidebar, cabeçalho, área de conversa, controle de voz) de
`mock-data.ts` para as queries reais do Convex (`convex/channels.ts`, plano 04-03), e entregar
as duas últimas peças de UI que faltam para SRV-02/04/05 serem observáveis por um humano:
criar canal e gerenciar o convite do servidor.

Purpose: sem este plano, `selectedChannelId` (já real desde 04-05) não tem nenhum componente
lendo canal de verdade — a sidebar continuaria mostrando os 5 canais mockados de
"Galera do Sinuca" independente de qual servidor real está selecionado, o que seria pior que
não ter feito nada (dado errado parecendo certo).
Output: sidebar de canais, cabeçalho e área de conversa 100% orientados a dado real de canal;
criação de canal e gestão de convite funcionando pela UI.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/04-servidores-e-canais/04-RESEARCH.md
@.planning/phases/04-servidores-e-canais/04-01-schema-e-fundacao-de-servidores-PLAN.md
@.planning/phases/04-servidores-e-canais/04-02-convites-de-servidor-PLAN.md
@.planning/phases/04-servidores-e-canais/04-03-canais-de-servidor-PLAN.md
@.planning/phases/04-servidores-e-canais/04-05-navegacao-real-de-servidores-PLAN.md
@.planning/phases/03-shell-da-ui/03-VERIFICACAO.md
@src/renderer/src/components/shell/ChannelSidebar.tsx
@src/renderer/src/components/shell/ChannelHeader.tsx
@src/renderer/src/components/shell/ConversationArea.tsx
@src/renderer/src/components/shell/VoiceControlBar.tsx
@src/renderer/src/state/selection-context.tsx

# Este plano roda depois do 04-05 (selection-context já reescrito, servers/channels reais,
# Dialog/Input já existem em @/components/ui/). Reler o resultado de 04-05 antes de codar —
# em particular a forma exata de SelectionContextValue (servers, selectedServerId/ChannelId
# podem ser null).
#
# 03-VERIFICACAO.md marca explicitamente como "slot para F5/F7, não para esta fase": badge de
# contagem de não lidas por canal (F5), divisor de novas mensagens (F5), avatares de
# participantes de voz aninhados sob o canal (F7), anel de fala/ícone de mute (F7). Este plano
# REMOVE a renderização desses elementos quando ela depende de mockVoiceParticipants/
# channel.unreadCount (que não existem no modelo real de canal desta fase) — não é regressão,
# é alinhar a UI ao que o backend desta fase realmente fornece. F5/F7 os reintroduzem com dado
# real quando chegar a vez deles.
#
# mockMessages/mockVoiceParticipants continuam existindo em mock-data.ts e mockChannels segue
# usado APENAS como acaso inofensivo dentro de ConversationArea (mensagens ecoadas
# localmente/grid de voz mockado não têm de onde vir ainda — ver Task 2) — não apagar
# mock-data.ts nesta fase.
#
# Caminho de import de api/Id/Doc: mesma orientação do plano 04-05 — conferir alias
# @convex/* em tsconfig.web.json antes de assumir caminho relativo, e recalcular a contagem de
# `../` para cada arquivo (todos os arquivos deste plano estão na mesma profundidade de
# src/renderer/src/components/shell/, então o mesmo caminho relativo serve para todos eles,
# mas será diferente do de selection-context.tsx).
</context>

<tasks>

<task type="auto">
  <name>Task 1: ChannelSidebar e VoiceControlBar sobre dado real</name>
  <files>src/renderer/src/components/shell/ChannelSidebar.tsx, src/renderer/src/components/shell/VoiceControlBar.tsx</files>
  <action>
    Reescrever `src/renderer/src/components/shell/ChannelSidebar.tsx`:
    - Se `selectedServerId === null` (zero servidores — estado possível vindo do plano 04-05):
      renderizar um estado vazio simples ("Crie ou entre em um servidor para começar") em vez
      do layout de categorias, sem chamar `listChannels` (não tem `serverId` pra passar).
    - Caso contrário: `const channels = useQuery(api.channels.listChannels, { serverId: selectedServerId })`.
      Enquanto `channels === undefined`, manter a estrutura mas sem itens (não é um estado de
      erro, é carregamento — a subscription resolve rápido).
    - Agrupar por `category` como antes, mas `category` não existe mais no modelo real de
      canal (só `type: 'text' | 'voice'`) — trocar o agrupamento por categoria mockada por
      agrupamento fixo em duas seções, "TEXTO" (canais `type === 'text'`) e "VOZ" (canais
      `type === 'voice'`), na mesma ordem visual de antes. Omitir uma seção inteira se estiver
      vazia (ex: servidor sem nenhum canal de voz ainda não mostra o cabeçalho "VOZ").
    - `TextChannelRow`: remover a prop/renderização de `unreadCount`/`Badge` — o modelo real de
      canal desta fase não tem esse campo (é do `channelReadState` da F5, que não existe
      ainda). Não inventar um valor fixo nem esconder com `0` — apenas não renderizar o
      `Badge` de jeito nenhum neste plano.
    - `VoiceChannelRow`: remover a busca/renderização de `mockVoiceParticipants` — sem
      `voiceStates` real (F7), não há participante nenhum para mostrar. O canal de voz aparece
      na lista, clicável, sem a lista de avatares abaixo dele.
    - Acrescentar um cabeçalho fixo no topo da região rolável, antes das categorias: nome do
      servidor selecionado (de `useSelection().servers` filtrando por `selectedServerId`) +
      dois botões pequenos (`icon-sm`, ver `button.tsx`): um "Convidar" (ícone `UserPlus` de
      `lucide-react`, abre `InviteDialog`) e um "Criar canal" (ícone `Plus`, abre
      `CreateChannelDialog`). Layout: `h-12 flex items-center justify-between px-3
      border-b border-border` (mesma altura de `ChannelHeader.tsx` para consistência visual).
    - `VoiceControlBar` continua renderizado como rodapé fixo fora da área rolável, sem
      mudança de posição.

    Corrigir `src/renderer/src/components/shell/VoiceControlBar.tsx`: `mockChannels.find(...)`
    não localiza mais nada útil (canais reais não existem em `mock-data.ts`). Trocar por:
    ```tsx
    const connectedChannel = useQuery(
      api.channels.getChannel,
      joinedVoiceChannelId ? { channelId: joinedVoiceChannelId } : 'skip'
    )
    const isConnected = joinedVoiceChannelId !== null && connectedChannel != null
    ```
    Usar `getChannel` (não `listChannels`) deliberadamente: o canal de voz conectado pode
    pertencer a um servidor diferente do que está selecionado no momento na sidebar (o usuário
    pode navegar para outro servidor enquanto segue conectado à voz de outro — mesmo
    comportamento do Discord real), então a busca não pode depender de `selectedServerId`.
  </action>
  <verify>`npm run typecheck:web` passa; `ChannelSidebar.tsx` não importa mais `mockChannels`/`mockMembers`/`mockVoiceParticipants`/`Channel` de `@/data/mock-data`; `VoiceControlBar.tsx` não importa mais `mockChannels`.</verify>
  <done>Sidebar de canais e barra de controle de voz refletem canais reais, com estados vazios tratados sem crash.</done>
</task>

<task type="auto">
  <name>Task 2: ChannelHeader e ConversationArea sobre dado real</name>
  <files>src/renderer/src/components/shell/ChannelHeader.tsx, src/renderer/src/components/shell/ConversationArea.tsx</files>
  <action>
    Reescrever `src/renderer/src/components/shell/ChannelHeader.tsx`: trocar
    `mockChannels.find(...)` por
    `const channel = useQuery(api.channels.getChannel, selectedChannelId ? { channelId: selectedChannelId } : 'skip')`.
    Três estados a tratar explicitamente (o componente já tinha um fallback para "nenhum canal
    selecionado" na Fase 3 — mantenha o texto, só ajuste a condição):
    - `selectedChannelId === null` → "Nenhum canal selecionado" (zero canais no servidor, ou
      zero servidores).
    - `channel === undefined` (query ainda carregando, `selectedChannelId` não-nulo) → mesmo
      texto de fallback é aceitável (transição rápida, não vale um spinner dedicado).
    - `channel === null` (id não existe mais / não-membro — não deveria acontecer no fluxo
      normal, mas `getChannel` retorna `null` para id inexistente) → mesmo fallback.
    - `channel` presente → mesma renderização de ícone (`Hash`/`Volume2` por `channel.type`) +
      `channel.name`, igual à Fase 3.

    Reescrever `src/renderer/src/components/shell/ConversationArea.tsx`: trocar
    `mockChannels.find(c => c.id === selectedChannelId)` pela mesma query
    `useQuery(api.channels.getChannel, ...)` de `ChannelHeader.tsx` (subscrição duplicada é
    esperada e barata — mesmo padrão do plano 04-05 para `servers`). Ajustes:
    - `channel` pode ser `undefined` (carregando) ou `null` (sem seleção/inexistente) — tratar
      os dois como o "Nenhum canal selecionado" que já existia, sem diferenciar visualmente por
      ora.
    - `TextChannelView`: parar de passar `firstUnreadMessageId` (esse campo não existe no
      canal real desta fase — é `channelReadState`, F5). Deixar o parâmetro como estava no
      componente (continua opcional) e simplesmente não fornecer valor — o divisor de não
      lidas fica invisível até F5 existir, que é o comportamento correto agora.
    - `mockMessages`/`mockVoiceParticipants` continuam sendo usados dentro de
      `TextChannelView`/`VoiceChannelView` exatamente como estavam (filtrando por
      `channel.id`/`channel._id`) — como nenhum id mockado bate com um `Id<'channels'>` real do
      Convex, os dois filtros sempre retornam vazio, e a UI já trata "lista vazia"/"nenhum
      participante" graciosamente (comportamento correto: sem chat real ainda é F5, sem voz
      real ainda é F7). Não é necessário (nem desejável) apagar esse código nesta fase — só
      passar o `channelId`/`channel.type` reais para ele continuar funcionando como stub.
  </action>
  <verify>`npm run typecheck:web` passa; `ChannelHeader.tsx`/`ConversationArea.tsx` não importam mais `mockChannels`/`Channel` de `@/data/mock-data`; selecionar um canal real de texto mostra "Nenhum participante"/lista vazia sem erro no console (esperado nesta fase), e um canal de voz real mostra "Nenhum participante conectado".</verify>
  <done>Cabeçalho e área de conversa mostram nome/tipo reais do canal selecionado; chat e grid de voz seguem como stubs coerentes (F5/F7), sem crash.</done>
</task>

<task type="auto">
  <name>Task 3: CreateChannelDialog e InviteDialog</name>
  <files>src/renderer/src/components/shell/CreateChannelDialog.tsx, src/renderer/src/components/shell/InviteDialog.tsx</files>
  <action>
    Criar `src/renderer/src/components/shell/CreateChannelDialog.tsx`: `Dialog` simples com um
    `Input` de nome (1-50 caracteres, mesma regra de `convex/channels.ts`) e uma escolha de
    tipo (dois botões "Texto"/"Voz" com estado local, sem precisar de um componente de
    Radio/Select dedicado — dois `Button` com `variant={type === 'text' ? 'default' :
    'outline'}` alternando). Chama `useMutation(api.channels.createChannel)` com
    `{ serverId: selectedServerId, name, type }` — recebe `serverId` como prop do chamador
    (`ChannelSidebar`, Task 1), não lê `useSelection()` diretamente (evita acoplamento
    desnecessário e deixa claro, olhando a assinatura do componente, que ele não funciona sem
    um servidor selecionado). Erro de validação/autorização exibido como texto
    `text-destructive`, mesmo padrão de `CreateOrJoinServerDialog.tsx` (plano 04-05). Sucesso:
    fecha o dialog e reseta o form — não precisa navegar para o canal criado (a sidebar já
    reflete o novo canal via subscription reativa; navegar automaticamente é um "nice to have"
    fora do escopo mínimo de SRV-05).

    Criar `src/renderer/src/components/shell/InviteDialog.tsx`, recebendo `serverId` como prop
    (mesma razão de design do `CreateChannelDialog`):
    - `const isOwner = useQuery(api.servers.amIOwner, { serverId })` (plano 04-01) — controla
      só a exibição condicional dos botões de gerar/revogar, nunca a autorização de fato (isso
      é sempre imposto no backend por `requireOwnership`, plano 04-02).
    - `const invite = useQuery(api.invites.getActiveInvite, { serverId })` — `undefined`
      enquanto carrega, `null` se não houver convite ativo, ou o documento do convite.
    - Se `invite` existir: mostrar o código (`invite.code`, fonte monoespaçada) com um botão
      "Copiar" (`navigator.clipboard.writeText(invite.code)`, feedback textual temporário tipo
      "Copiado!" por 2s via `useState`+`setTimeout`).
    - Se `invite` for `null` e `isOwner`: mostrar botão "Gerar código de convite" chamando
      `useMutation(api.invites.generateInvite)`.
    - Se `invite` for `null` e não-owner: mensagem "Peça ao dono do servidor para gerar um
      convite" — sem nenhum botão de ação.
    - Se `invite` existir e `isOwner`: mostrar também "Gerar novo código" (chama
      `generateInvite` de novo — só funciona de fato depois de revogar o atual, já que
      `generateInvite` é idempotente por design; deixar o botão sempre visível para o dono é
      aceitável, o clique não faz nada de novo se já houver um ativo, mas simplifica a UI não
      precisar saber disso) e "Revogar convite" (chama `revokeInvite`).
    - Todos os erros de mutation exibidos como texto `text-destructive`, mesmo padrão dos
      outros dialogs desta fase.
  </action>
  <verify>`npm run typecheck:web` passa; `npm run build` passa. Fluxo manual (dev, uma conta): abrir `InviteDialog` como dono sem convite ainda gerado → botão "Gerar código" aparece e funciona → código exibido e copiável → "Revogar" some o código → `getActiveInvite` volta a `null`.</verify>
  <done>Criar canal e gerenciar convite (ver, copiar, gerar, revogar) funcionam pela UI, com os botões de dono corretamente escondidos para não-donos.</done>
</task>

</tasks>

<visual_verifications>

### 1. Sidebar de canais mostra canais reais do servidor selecionado
- **URL:** tela principal do app (pós-login, servidor com ao menos um canal)
- **Viewport:** desktop
- **Expected:** Lista de canais reais (criados pela UI, não mais "geral"/"memes"/"avisos" mockados), agrupados em TEXTO/VOZ; botões "Convidar" e "Criar canal" visíveis no topo da sidebar
- **Context:** Task 1 substituiu a fonte de dados da sidebar de canais

### 2. Diálogo de convite mostra código real e ações de dono
- **URL:** tela principal do app, dialog de convite aberto (dono do servidor)
- **Viewport:** desktop
- **Expected:** Código de 8 caracteres visível, botão "Copiar" funcional, botões "Gerar novo código"/"Revogar" visíveis só para o dono
- **Context:** Task 3 criou InviteDialog

</visual_verifications>

<verification>
- `npm run typecheck` (node + web + convex) e `npm run build` passam.
- Nenhum dos 6 arquivos deste plano importa `Channel`/`mockChannels` de `@/data/mock-data` (exceto o uso intencional e documentado de `mockMessages`/`mockVoiceParticipants` dentro de `ConversationArea.tsx`, que continua existindo como stub para F5/F7).
- Criar um canal de texto e um de voz pela UI faz os dois aparecerem na sidebar sem reload manual.
- Botões "Gerar novo código"/"Revogar convite" não aparecem para um membro não-dono.
</verification>

<success_criteria>
SRV-02, SRV-04 e SRV-05 observáveis por um humano usando o app: criar canal de texto/voz e
gerenciar convite (ver, copiar, gerar, revogar) funcionam de ponta a ponta pela UI, com a
sidebar/cabeçalho/área de conversa refletindo dado real de canal em vez do mock da Fase 3.
</success_criteria>

<output>
After completion, create `.planning/phases/04-servidores-e-canais/04-06-SUMMARY.md`.
</output>
