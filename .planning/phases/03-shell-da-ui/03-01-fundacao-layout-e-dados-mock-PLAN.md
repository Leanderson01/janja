---
phase: 03-shell-da-ui
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/renderer/src/data/mock-data.ts
  - src/renderer/src/state/selection-context.tsx
  - src/renderer/src/components/shell/AppShell.tsx
  - src/renderer/src/components/shell/ServerRail.tsx
  - src/renderer/src/components/shell/ChannelSidebar.tsx
  - src/renderer/src/components/shell/ConversationArea.tsx
  - src/renderer/src/components/shell/MemberList.tsx
  - src/renderer/src/App.tsx
autonomous: true

must_haves:
  truths:
    - "App renderiza as 4 regiões do shell (barra de servidores, sidebar de canais, área de conversa, lista de membros) com colunas laterais de largura fixa e área de conversa elástica"
    - "Clicar em um servidor na barra atualiza o servidor selecionado num contexto compartilhado, visível nos stubs das regiões dependentes"
    - "Dados mockados cobrem servers, channels, members, voiceParticipants e messages com tipos TypeScript explícitos, sem `any`"
  artifacts:
    - path: "src/renderer/src/data/mock-data.ts"
      provides: "Tipos e fixtures mockados de servers/channels/members/voiceParticipants/messages"
      contains: "export const mockServers"
    - path: "src/renderer/src/state/selection-context.tsx"
      provides: "Contexto React de seleção de servidor/canal ativo e estado de voz conectada"
      contains: "useSelection"
    - path: "src/renderer/src/components/shell/AppShell.tsx"
      provides: "Grid de 4 regiões: rail fixo, sidebar fixa, conversa elástica, membros fixo"
      min_lines: 25
    - path: "src/renderer/src/components/shell/ServerRail.tsx"
      provides: "Barra de servidores clicável com indicador visual de servidor ativo"
      min_lines: 20
  key_links:
    - from: "src/renderer/src/components/shell/ServerRail.tsx"
      to: "src/renderer/src/state/selection-context.tsx"
      via: "onClick de cada ícone chama setSelectedServerId(server.id)"
      pattern: "setSelectedServerId"
    - from: "src/renderer/src/components/shell/AppShell.tsx"
      to: "src/renderer/src/data/mock-data.ts"
      via: "SelectionProvider inicializado com o primeiro servidor/canal mockado"
      pattern: "mockServers\\[0\\]"
---

<objective>
Criar a fundação da Fase 3: o modelo de dados mockado que todas as regiões do
shell vão consumir, o contexto de seleção compartilhado (servidor/canal ativo,
canal de voz conectado), e o esqueleto de layout de 4 colunas que sobrevive a
redimensionamento — com stubs nas três regiões que os próximos planos
substituem por implementações completas.

Purpose: Sem essa fundação, os planos 02-04 (sidebar de canais, área de
conversa, lista de membros) não têm onde pendurar dados nem onde ler a seleção
ativa — e sem o layout resiliente a redimensionamento definido aqui uma única
vez, cada plano seguinte reinventaria (e possivelmente quebraria) o grid.
Output: `AppShell` funcional com as 4 regiões visíveis, `ServerRail` já
clicável, contexto de seleção implementado, e um arquivo único de dados
mockados cobrindo todas as entidades que F4-F8 vão eventualmente substituir
por Convex.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/03-shell-da-ui/03-RESEARCH.md
@docs/superpowers/specs/2026-08-18-janja-discord-clone-design.md

# F0 (bootstrap) roda em paralelo e pode não estar concluído quando este plano
# for executado. Este plano assume a estrutura padrão gerada pelo
# electron-vite (`src/main/`, `src/preload/`, `src/renderer/src/`), com
# Tailwind e shadcn/ui (`components.json`) já configurados no renderer. Se a
# estrutura real divergir (ex: renderer sem subpasta `src/`), adapte os
# caminhos deste plano e documente o desvio explicitamente na SUMMARY.

# Antes de começar, rode `cat package.json` na raiz do projeto para descobrir
# o gerenciador de pacotes (npm/pnpm/yarn) e os scripts disponíveis (dev,
# build, typecheck) — use o mesmo gerenciador em todos os comandos deste plano.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Modelo de dados mockado</name>
  <files>src/renderer/src/data/mock-data.ts</files>
  <action>
    Criar `mock-data.ts` com tipos TypeScript explícitos (sem `any`) e fixtures
    estáticas cobrindo as entidades que o schema real do Convex (design §5)
    eventualmente vai substituir — o objetivo é que os tipos aqui já tenham a
    forma que F4-F8 vão precisar, mesmo que os dados sejam inventados:

    ```ts
    export type Server = { id: string; name: string; iconUrl?: string }

    export type Channel = {
      id: string
      serverId: string
      name: string
      type: 'text' | 'voice'
      category: string           // ex: "TEXTO", "VOZ" — usado para agrupar na sidebar
      unreadCount: number        // 0 = sem badge
      firstUnreadMessageId?: string  // onde o divisor "novas mensagens" aparece
    }

    export type Member = {
      id: string
      serverId: string
      username: string
      tag: string                // 4 dígitos, ex: "0231" — junto formam USER#123
      avatarUrl?: string
      status: 'online' | 'offline'
    }

    export type VoiceParticipant = {
      channelId: string
      memberId: string
      speaking: boolean
      muted: boolean
      deafened: boolean
    }

    export type Message = {
      id: string
      channelId: string
      authorId: string          // referencia Member.id
      content: string
      createdAt: number         // epoch ms, usado para ordenar
    }
    ```

    Fixtures mínimas: pelo menos 2 `mockServers`. Para cada servidor, pelo
    menos 3 canais de texto (categoria "TEXTO", pelo menos um com
    `unreadCount > 0`) e 2 canais de voz (categoria "VOZ"). Pelo menos 5
    `mockMembers` por servidor, misturando `status: 'online'` e `'offline'`.
    `mockVoiceParticipants` populando pelo menos um canal de voz com 2-3
    membros, pelo menos um com `speaking: true` e pelo menos um com
    `muted: true`. `mockMessages` com 8-12 mensagens em pt-BR distribuídas em
    pelo menos 2 canais de texto diferentes, `createdAt` estritamente
    crescente por canal; escolha um `id` de mensagem no meio da lista de um
    canal para ser o `firstUnreadMessageId` do respectivo `Channel`, simulando
    onde o divisor de não lidas apareceria.

    Exportar tudo (`mockServers`, `mockChannels`, `mockMembers`,
    `mockVoiceParticipants`, `mockMessages`) como `const` tipadas, nunca
    `any`. Este arquivo é a única fonte de dados de todo o shell — os
    próximos planos só leem daqui, não duplicam fixtures.
  </action>
  <verify>Rodar o typecheck do projeto (`npm run typecheck` ou equivalente conforme package.json) sem erros relacionados a mock-data.ts. Abrir o arquivo e confirmar que todos os 5 tipos e todos os 5 exports existem, com pelo menos 2 servidores, 5+ canais no total, 5+ membros por servidor, participantes de voz e mensagens conforme descrito.</verify>
  <done>mock-data.ts existe, tipado, sem `any`, com fixtures suficientes para exercitar unread badge, divisor de não lidas, participante falando e participante mutado em pelo menos um cenário cada.</done>
</task>

<task type="auto">
  <name>Task 2: Contexto de seleção + esqueleto de layout de 4 regiões</name>
  <files>src/renderer/src/state/selection-context.tsx, src/renderer/src/components/shell/AppShell.tsx, src/renderer/src/components/shell/ChannelSidebar.tsx, src/renderer/src/components/shell/ConversationArea.tsx, src/renderer/src/components/shell/MemberList.tsx, src/renderer/src/App.tsx</files>
  <action>
    Criar `selection-context.tsx` com um `React.createContext` + hook
    `useSelection()` expondo:
    - `selectedServerId: string`, `setSelectedServerId(id: string): void`
    - `selectedChannelId: string`, `setSelectedChannelId(id: string): void`
    - `joinedVoiceChannelId: string | null`, `setJoinedVoiceChannelId(id: string | null): void`

    Exportar um `SelectionProvider` que recebe `children` e inicializa
    `selectedServerId`/`selectedChannelId` com `mockServers[0].id` e o
    primeiro canal de texto desse servidor (de `mock-data.ts`), e
    `joinedVoiceChannelId` como `null`. Declarar TODOS os campos acima agora,
    mesmo que só sejam consumidos pelos planos seguintes — isso evita que
    planos futuros (que rodam em paralelo, sem depender um do outro) precisem
    editar este mesmo arquivo e colidam.

    Criar `AppShell.tsx` implementando exatamente o padrão de layout do
    RESEARCH.md §3: container raiz `h-screen w-screen overflow-hidden flex`,
    envolto pelo `SelectionProvider`. Dentro: `ServerRail` (`flex-none
    w-[72px]`), `ChannelSidebar` (`flex-none w-60`), `ConversationArea`
    (`flex-1 min-w-0`), `MemberList` (`flex-none w-60`). Aplicar
    `bg-*`/`border-*` do Tailwind suficientes para as regiões serem
    visualmente distinguíveis (não precisa ser fiel à paleta do Discord nesta
    fase, só distinguível).

    Criar stubs mínimos e tipados para `ChannelSidebar.tsx`,
    `ConversationArea.tsx` e `MemberList.tsx` — cada um um componente função
    que ocupa `h-full` e renderiza um texto de placeholder. Para tornar a
    seleção de servidor verificável já nesta task (antes do Plano 02
    implementar a sidebar de verdade), o stub de `ChannelSidebar` deve chamar
    `useSelection()` e renderizar
    `Sidebar de canais — servidor selecionado: {selectedServerId}`.

    Editar `App.tsx` para renderizar só `<AppShell />` como raiz.
  </action>
  <verify>Rodar o servidor de dev do projeto (comando conforme package.json, ex: `npm run dev`) e confirmar que abre sem erro no console. As 4 regiões aparecem lado a lado. Redimensionar a janela do dev (ou o viewport, se for possível inspecionar via devtools do Electron) confirma que as colunas laterais mantêm a largura e só a área central muda.</verify>
  <done>AppShell renderiza as 4 regiões com as larguras corretas; SelectionProvider envolve a árvore; stub de ChannelSidebar reflete o selectedServerId atual; nenhum erro no console.</done>
</task>

<task type="auto">
  <name>Task 3: Barra de servidores funcional</name>
  <files>src/renderer/src/components/shell/ServerRail.tsx, src/renderer/src/components/shell/AppShell.tsx</files>
  <action>
    Garantir os componentes shadcn necessários (`avatar`, `tooltip`,
    `scroll-area`) estão instalados — rodar o comando de add do shadcn CLI
    para os que faltarem (ex: `npx shadcn@latest add avatar tooltip
    scroll-area`, ajustando ao gerenciador de pacotes do projeto). Se o
    projeto já os tiver (gerados no bootstrap F0), o comando é idempotente.

    Criar `ServerRail.tsx`: uma `ScrollArea` vertical listando `mockServers`
    (de `mock-data.ts`), cada um como um `Avatar` circular (`AvatarFallback`
    com as iniciais do nome do servidor, já que `iconUrl` é mockado como
    ausente na maioria das fixtures) dentro de um `Tooltip` que mostra o nome
    completo do servidor ao passar o mouse (envolver a árvore, ou pelo menos
    o ServerRail, em `TooltipProvider` se ainda não houver um na raiz do
    app — se precisar adicionar, coloque em `AppShell.tsx`, ao redor de todo
    o conteúdo). Cada ícone é clicável e chama
    `setSelectedServerId(server.id)` do `useSelection()`.

    Indicador de servidor ativo (característica visual do Discord): quando
    `server.id === selectedServerId`, aplicar um estilo diferenciado ao
    ícone — pode ser uma barra vertical à esquerda do avatar (`before:` do
    Tailwind com `position: relative` no wrapper) ou um contorno/anel
    diferenciado; qualquer abordagem é aceitável desde que seja visualmente
    clara qual servidor está selecionado no momento.

    Importar `ServerRail` em `AppShell.tsx` no lugar de qualquer placeholder
    de rail que a Task 2 tenha deixado (se a Task 2 já importou `ServerRail`
    diretamente, esta edição pode ser um no-op — confirme).
  </action>
  <verify>No app rodando, clicar em cada ícone de servidor diferente atualiza visualmente qual está marcado como ativo, e o texto do stub de ChannelSidebar (`servidor selecionado: {id}`) muda para o id do servidor clicado. Hover sobre um ícone mostra o tooltip com o nome do servidor.</verify>
  <done>ServerRail lista todos os mockServers, indica visualmente o ativo, tooltip funciona, e clicar propaga a seleção via contexto até o stub de ChannelSidebar.</done>
</task>

</tasks>

<verification>
- `npm run dev` (ou equivalente) abre o app sem erros de console.
- As 4 regiões do shell aparecem simultaneamente, com as 3 laterais/rail em
  largura fixa e a área de conversa elástica.
- Clicar em servidores diferentes na barra muda o texto do stub da sidebar de
  canais, provando que o contexto de seleção propaga corretamente.
- `mock-data.ts` tem tipos completos e fixtures suficientes para os Planos
  02-04 (canais com unread, participantes de voz falando/mutados, mensagem
  marcada como primeira não lida).
</verification>

<success_criteria>
- Fundação de dados e estado pronta: `mock-data.ts` e `selection-context.tsx`
  cobrem tudo que os Planos 02-04 vão precisar sem exigir que eles editem
  esses dois arquivos.
- Layout de 4 regiões implementado uma única vez em `AppShell.tsx`, seguindo
  o padrão flex resiliente a redimensionamento do RESEARCH.md.
- ServerRail funcional: navegação entre servidores mockados já funciona de
  ponta a ponta (clique → contexto → stub reflete a mudança).
</success_criteria>

<output>
After completion, create `.planning/phases/03-shell-da-ui/03-01-SUMMARY.md`.
Documentar explicitamente: (1) qualquer desvio da estrutura de pastas
assumida (`src/renderer/src/...`) caso F0 tenha gerado algo diferente; (2) a
forma final exportada por `selection-context.tsx` (nomes exatos dos campos),
já que os Planos 02-04 dependem dela; (3) confirmação de que `mock-data.ts`
cobre unread, divisor de não lidas, falando e mutado.
</output>
