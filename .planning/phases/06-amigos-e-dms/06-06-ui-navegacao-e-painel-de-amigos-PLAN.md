---
phase: 06-amigos-e-dms
plan: 06
type: execute
wave: 4
depends_on: ["06-02", "06-03"]
files_modified:
  - src/renderer/src/state/selection-context.tsx
  - src/renderer/src/components/shell/ServerRail.tsx
  - src/renderer/src/components/shell/AppShell.tsx
  - src/renderer/src/components/friends/FriendsPanel.tsx
  - src/renderer/src/lib/user-tag.ts
  - src/renderer/src/lib/user-tag.test.ts
  - components.json
  - src/renderer/src/components/ui/input.tsx
  - package.json
autonomous: true

must_haves:
  truths:
    - "Usuário navega entre a visão de servidor e uma visão 'Início' dedicada a amigos, a partir de um botão fixo na barra de servidores"
    - "Na visão Início, usuário busca outro usuário por USER#123 e envia um pedido de amizade"
    - "Na visão Início, usuário vê os pedidos de amizade recebidos e aceita ou recusa cada um"
    - "Na visão Início, usuário vê a lista de amigos com status online/offline e remove uma amizade"
  artifacts:
    - path: "src/renderer/src/state/selection-context.tsx"
      provides: "Estado view ('server'|'home'), goHome(), selectedDmChannelId/setSelectedDmChannelId — extensão do contexto da Fase 3, não um segundo contexto"
      contains: "goHome"
    - path: "src/renderer/src/components/friends/FriendsPanel.tsx"
      provides: "Painel Início: busca/adicionar amigo, pedidos recebidos, lista de amigos com presença"
      contains: "findUserByUsernameTag"
    - path: "src/renderer/src/lib/user-tag.ts"
      provides: "Parser puro de 'usuario#0001' para {username, tag} — testável sem Convex nem React"
      exports: ["parseUserTag"]
  key_links:
    - from: "src/renderer/src/components/friends/FriendsPanel.tsx"
      to: "convex/friends.ts (listFriends, listIncomingFriendRequests, sendFriendRequest, acceptFriendRequest, rejectFriendRequest)"
      via: "useQuery/useMutation de convex/react sobre api.friends.*"
      pattern: "api\\.friends\\."
    - from: "src/renderer/src/components/shell/AppShell.tsx"
      to: "src/renderer/src/state/selection-context.tsx (view)"
      via: "renderização condicional: view === 'home' mostra FriendsPanel sem ChannelSidebar/MemberList"
      pattern: "view === 'home'"
---

<objective>
Dar à Fase 6 sua primeira superfície de UI: um botão "Início" na barra de
servidores que leva a uma visão dedicada a amigos, onde o usuário busca por
`USER#123`, envia/aceita/recusa pedidos, e vê/remove amigos com presença —
tudo consumindo o backend real dos planos 06-02/06-03 (sem mock).

Purpose: SOCIAL-01, SOCIAL-02, SOCIAL-03, SOCIAL-04 e SOCIAL-06 só existem de
ponta a ponta quando alguém consegue clicar em algo. Este plano fecha essas
cinco; SOCIAL-05 (conversa direta) fica pro plano 06-07, que constrói em cima
da navegação `view`/`goHome` criada aqui.
Output: navegação Início funcional + painel de amigos completo, sem alterar o
comportamento existente da visão de servidor (Fase 3 continua intacta).
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/06-amigos-e-dms/06-RESEARCH.md
@src/renderer/src/state/selection-context.tsx
@src/renderer/src/components/shell/AppShell.tsx
@src/renderer/src/components/shell/ServerRail.tsx
@src/renderer/src/components/shell/MemberList.tsx

# 06-RESEARCH.md §7: este plano ESTENDE o contexto e o AppShell existentes da
# Fase 3, não cria um sistema de navegação paralelo. MemberList.tsx é a
# referência de estilo mais próxima (grupos online/offline, Avatar+AvatarBadge,
# ScrollArea) — reaproveitar as mesmas classes Tailwind, não reinventar.
#
# Assumir que, no momento em que este plano executa, a Fase 2 já publicou
# ConvexProviderWithAuth envolvendo <AppShell /> em algum ponto acima de
# App.tsx (planos 02-07/02-08) — não é responsabilidade deste plano montar o
# provider, só consumir `useQuery`/`useMutation` de `convex/react` dentro dos
# componentes novos, assumindo que `ctx.auth.getUserIdentity()` resolve no
# backend para o usuário logado de verdade.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Estado de navegação Início + botão na barra de servidores</name>
  <files>src/renderer/src/state/selection-context.tsx, src/renderer/src/components/shell/ServerRail.tsx, src/renderer/src/components/shell/AppShell.tsx</files>
  <action>
    Estender `SelectionContextValue` em `selection-context.tsx` (não criar um
    segundo contexto — ver `06-RESEARCH.md §7`):

    ```ts
    export type SelectionContextValue = {
      view: 'server' | 'home'
      selectedServerId: string
      setSelectedServerId: (id: string) => void
      selectedChannelId: string
      setSelectedChannelId: (id: string) => void
      joinedVoiceChannelId: string | null
      setJoinedVoiceChannelId: (id: string | null) => void
      goHome: () => void
      selectedDmChannelId: string | null
      setSelectedDmChannelId: (id: string | null) => void
    }
    ```

    Dentro de `SelectionProvider`:
    - `const [view, setView] = useState<'server' | 'home'>('server')`
    - `const [selectedDmChannelId, setSelectedDmChannelId] = useState<string | null>(null)`
    - `setSelectedServerId` passa a ser um wrapper que também chama
      `setView('server')` (clicar em qualquer servidor sai do modo Início —
      mesmo padrão de efeito colateral único já usado no arquivo, não separar
      em dois setters que o chamador precisa lembrar de coordenar):
      ```ts
      function selectServer(id: string): void {
        setSelectedServerIdState(id)
        setView('server')
      }
      ```
      (renomear o `useState` interno para `setSelectedServerIdState` e expor
      `selectServer` como `setSelectedServerId` no value do contexto — a
      assinatura pública não muda, só o comportamento por trás dela).
    - `goHome()`: `setView('home')` e `setSelectedDmChannelId(null)` (entrar
      no Início sempre volta pro painel de amigos, nunca deixa uma DM
      "grudada" de uma visita anterior).
    - Adicionar todos os novos campos ao objeto memoizado e ao array de
      dependências do `useMemo` existente.

    Em `ServerRail.tsx`: adicionar um botão fixo acima da lista de servidores
    existente (`mockServers.map(...)`), separado por um `Separator`
    (componente já instalado). Usar o ícone `Home` de `lucide-react` e o
    mesmo padrão visual de `ServerIcon` (círculo, tooltip lateral) só que sem
    imagem — um `Avatar`/`AvatarFallback` com o ícone dentro, ou um `Button`
    circular simples; seguir o que já existe em `Avatar`/`Tooltip` do
    arquivo, não importar nada novo. Marcar como ativo (mesmo indicador de
    barra vertical já usado em `ServerIcon`) quando `view === 'home'`. Ao
    clicar, chamar `goHome()` do `useSelection()`.

    Em `AppShell.tsx`: ler `view` de `useSelection()`. Quando
    `view === 'server'`, renderizar exatamente como hoje (`ChannelSidebar` +
    `ConversationArea` + `MemberList`). Quando `view === 'home'`, renderizar
    `ServerRail` (inalterado) + `FriendsPanel` (deste plano, Task 3) ocupando
    o espaço central, **sem** `ChannelSidebar` nem `MemberList` — o plano
    06-07 troca essa segunda região por `DmSidebar`/`DmConversationView`
    condicionalmente; por ora, `view === 'home'` sempre mostra `FriendsPanel`
    direto, sem sidebar própria.
  </action>
  <verify>
    `npm run typecheck` passa.
    `grep -n "goHome" src/renderer/src/state/selection-context.tsx src/renderer/src/components/shell/ServerRail.tsx` retorna linhas nos dois arquivos.
    Navegação manual (não automatizável em WSL2 — só confirmar que compila e a lógica de estado está correta por leitura de código neste momento; verificação visual real é o plano 06-08).
  </verify>
  <done>Clicar no botão Início troca a visão sem quebrar a navegação de servidor existente; typecheck e build passam.</done>
</task>

<task type="auto">
  <name>Task 2: Parser puro de USER#123</name>
  <files>src/renderer/src/lib/user-tag.ts, src/renderer/src/lib/user-tag.test.ts</files>
  <action>
    RED — `user-tag.test.ts`: casos para uma função ainda inexistente:
    ```ts
    import { describe, expect, it } from 'vitest'
    import { parseUserTag } from './user-tag'

    describe('parseUserTag', () => {
      it('aceita "leo#0001" e retorna username/tag normalizados', () => {
        expect(parseUserTag('leo#0001')).toEqual({ username: 'leo', tag: '0001' })
      })
      it('normaliza maiúsculas e espaços nas bordas', () => {
        expect(parseUserTag('  Leo#0001  ')).toEqual({ username: 'leo', tag: '0001' })
      })
      it('rejeita sem "#"', () => {
        expect(parseUserTag('leo0001')).toBeNull()
      })
      it('rejeita tag com menos de 4 dígitos', () => {
        expect(parseUserTag('leo#1')).toBeNull()
      })
      it('rejeita tag não-numérica', () => {
        expect(parseUserTag('leo#abcd')).toBeNull()
      })
      it('rejeita username vazio', () => {
        expect(parseUserTag('#0001')).toBeNull()
      })
    })
    ```
    Confirmar que falham (arquivo `user-tag.ts` ainda não existe).

    GREEN — `user-tag.ts`:
    ```ts
    export type ParsedUserTag = { username: string; tag: string }

    // Espelha a normalização de username em convex/users.ts
    // (baseUsernameFromEmail): minúsculo, sem espaços nas bordas. A tag é
    // sempre 4 dígitos — mesmo formato de convex/lib/tag.ts.
    export function parseUserTag(input: string): ParsedUserTag | null {
      const trimmed = input.trim()
      const match = /^(.+)#(\d{4})$/.exec(trimmed)
      if (!match) return null
      const username = match[1].trim().toLowerCase()
      if (username.length === 0) return null
      return { username, tag: match[2] }
    }
    ```
    Rodar os testes até passarem.
  </action>
  <verify>`npx vitest run src/renderer/src/lib/user-tag.test.ts` passa com os 6 casos.</verify>
  <done>Parser de USER#123 puro, testado, pronto para o formulário de busca da Task 3.</done>
</task>

<task type="auto">
  <name>Task 3: FriendsPanel — buscar/adicionar, pedidos, lista de amigos</name>
  <files>src/renderer/src/components/friends/FriendsPanel.tsx, components.json, src/renderer/src/components/ui/input.tsx, package.json</files>
  <action>
    Instalar o componente `input` do shadcn (único componente novo desta
    fase, ver `06-RESEARCH.md §6`):
    ```bash
    npx shadcn@latest add input
    ```
    Se falhar por detecção de framework (mesmo bug já documentado em
    `00-RESEARCH.md §3.5` para o componente `button`), criar
    `src/renderer/src/components/ui/input.tsx` manualmente copiando o
    registry oficial `new-york-v4/ui/input.tsx` (mesmo processo de fallback
    já usado no plano 00-02).

    Criar `src/renderer/src/components/friends/FriendsPanel.tsx`. Estrutura:
    - Um toggle de 3 estados no topo (`'amigos' | 'pedidos' | 'adicionar'`),
      `useState` local, renderizado como três `Button` (`variant="ghost"` no
      inativo, `variant="secondary"` no ativo) lado a lado — mesmo padrão
      manual de alternância já usado em `VoiceControlBar.tsx` (sem componente
      de Tabs, ver `06-RESEARCH.md §6`). Iniciar em `'amigos'`.

    - **Aba "amigos"**: `useQuery(api.friends.listFriends)`. Enquanto
      `undefined` (carregando), mostrar um texto simples "Carregando...".
      Agrupar em ONLINE/OFFLINE exatamente como `MemberList.tsx` agrupa
      `mockMembers` (mesmo texto de cabeçalho `ONLINE — N`/`OFFLINE — N`,
      mesma classe `opacity-60` no grupo offline). Cada linha: `Avatar` +
      `AvatarBadge` (verde se `online`, cinza se não — mesma convenção de
      `MemberList.tsx`), `username#tag`, e um botão "Remover" (`variant="ghost"`,
      `size="icon-sm"`, ícone `UserMinus` de lucide-react) que chama
      `useMutation(api.friends.removeFriendship)({ friendUserId: userId })`.
      Lista vazia (nenhum amigo ainda): texto "Nenhum amigo ainda — use a aba
      Adicionar para buscar por USER#123".

    - **Aba "pedidos"**: `useQuery(api.friends.listIncomingFriendRequests)`.
      Cada linha: avatar + `username#tag` de quem enviou + dois botões
      (`Check` verde para aceitar, `X` vermelho para recusar), chamando
      `useMutation(api.friends.acceptFriendRequest)({ requestId })` e
      `useMutation(api.friends.rejectFriendRequest)({ requestId })`. Envolver
      cada chamada em `try/catch` — se a mutation rejeitar (ex.: outro
      cliente já resolveu o pedido), mostrar o erro numa linha de texto
      abaixo do botão em vez de deixar a Promise rejeitada sem tratamento.
      Lista vazia: "Nenhum pedido pendente".

    - **Aba "adicionar"**: formulário com `Input` (placeholder
      `"usuario#0001"`) + `Button` "Buscar". Estado local:
      `rawInput` (string), `submitted` (`{username, tag} | null`). No
      submit, chamar `parseUserTag(rawInput)` (Task 2); se `null`, mostrar
      erro inline "Formato inválido — use usuario#0001" e não consultar
      nada; se válido, `setSubmitted(parsed)`. Consultar
      `useQuery(api.users.findUserByUsernameTag, submitted ?? 'skip')`
      (padrão oficial do Convex para pular a query até ter argumentos
      válidos — não chamar a query com argumentos vazios/placeholder).
      Quando o resultado chega:
      - `undefined` com `submitted` setado: "Buscando...".
      - `null`: "Nenhum usuário encontrado com esse USER#123".
      - objeto: mostrar um cartão com avatar/nome + botão "Enviar pedido de
        amizade", que chama `useMutation(api.friends.sendFriendRequest)({
        username: submitted.username, tag: submitted.tag })` dentro de
        `try/catch`; em sucesso, limpar `rawInput`/`submitted` e mostrar uma
        mensagem de confirmação transitória (`useState` de texto, sem
        `setTimeout` — some na próxima busca/navegação, é suficiente para o
        MVP); em erro (ex.: "Vocês já são amigos", "Pedido já enviado"),
        mostrar a mensagem de erro da mutation (`error.message`) na mesma
        linha, sem travar o formulário.

    Todas as três abas usam `ScrollArea` (componente já instalado) como
    contêiner rolável, mesmo padrão de `MemberList.tsx`/`ChannelSidebar.tsx`.
  </action>
  <verify>
    `npm run typecheck` e `npm run build` passam.
    `grep -n "'skip'" src/renderer/src/components/friends/FriendsPanel.tsx` confirma o padrão de query condicional.
    `grep -rn "api.friends\." src/renderer/src/components/friends/FriendsPanel.tsx` mostra as 5 funções consumidas (listFriends, listIncomingFriendRequests, removeFriendship, acceptFriendRequest, rejectFriendRequest) mais `api.users.findUserByUsernameTag`.
  </verify>
  <done>Painel Início completo: busca/adicionar amigo, pedidos recebidos com aceitar/recusar, lista de amigos com presença e remoção — tudo sobre dados reais do Convex, nenhum mock.</done>
</task>

</tasks>

<verification>
- `npm run build` passa (prova que Tailwind, alias `@`, e os novos componentes compilam juntos).
- `npx vitest run src/renderer/src/lib/user-tag.test.ts` passa.
- A visão de servidor (Fase 3) continua funcionando sem alteração de comportamento — `AppShell.tsx` só ganhou um branch novo, não reescreveu o existente.
</verification>

<success_criteria>
SOCIAL-01, SOCIAL-02, SOCIAL-03, SOCIAL-04 e SOCIAL-06 têm UI funcional sobre
dados reais, navegável a partir de um botão dedicado na barra de servidores,
sem quebrar a visão de servidor da Fase 3. SOCIAL-05 (conversa direta) fica
para o plano 06-07.
</success_criteria>

<output>
After completion, create `.planning/phases/06-amigos-e-dms/06-06-SUMMARY.md`.
</output>
