---
phase: 04-servidores-e-canais
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - convex/schema.ts
  - convex/lib/membership.ts
  - convex/servers.ts
  - convex/servers.test.ts
autonomous: true

must_haves:
  truths:
    - "Usuário autenticado cria um servidor e imediatamente aparece como seu único membro e dono"
    - "listMyServers só retorna servidores dos quais o usuário chamador é membro, nunca todos os servidores do banco"
    - "Toda function de servidor desta fase pode checar 'este usuário é membro/dono deste servidor?' com uma consulta indexada, sem duplicar lógica de autorização"
  artifacts:
    - path: "convex/schema.ts"
      provides: "Tabelas servers, serverMembers, invites, channels somadas a users/presence já existentes (Fase 2)"
      contains: "serverMembers"
    - path: "convex/lib/membership.ts"
      provides: "requireIdentity, requireMembership, requireOwnership — helpers de autorização reaproveitados por todo o resto da fase"
      exports: ["requireIdentity", "requireMembership", "requireOwnership"]
    - path: "convex/servers.ts"
      provides: "Mutation createServer, query listMyServers, query amIOwner (usada pela UI de convite do plano 04-06 para decidir quais botões mostrar)"
      exports: ["createServer", "listMyServers", "amIOwner"]
  key_links:
    - from: "convex/servers.ts"
      to: "convex/lib/membership.ts"
      via: "requireIdentity(ctx) chamado dentro de createServer/listMyServers; requireMembership(ctx, serverId) chamado dentro de amIOwner"
      pattern: "requireIdentity"
    - from: "convex/schema.ts (serverMembers)"
      to: "índice by_server_user"
      via: "toda checagem de participação (SRV-06) usa withIndex('by_server_user', ...), nunca .filter() sobre a tabela inteira"
      pattern: "by_server_user"
---

<objective>
Criar a fundação de dados desta fase: as quatro tabelas que faltam no schema
(`servers`, `serverMembers`, `invites`, `channels` — `users`/`presence` já existem da Fase 2,
não tocar nelas), o helper de autorização centralizado que toda function de domínio desta fase
vai importar, e as duas primeiras funções reais: criar servidor e listar "meus servidores".

Purpose: sem isso, nenhum outro plano desta fase tem onde escrever — `invites.ts`,
`channels.ts` e `members.ts` (planos 04-02 a 04-04) todos dependem do schema e do helper de
autorização existirem primeiro, e do renderer (planos 04-05+) ter pelo menos `createServer`/
`listMyServers` para sair do estado "zero servidores".
Output: schema completo desta fase, `convex/lib/membership.ts`, `convex/servers.ts` com
`createServer`/`listMyServers` testados.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/04-servidores-e-canais/04-RESEARCH.md
@.planning/research/PITFALLS.md
@docs/superpowers/specs/2026-08-18-janja-discord-clone-design.md
@convex/schema.ts
@convex/presence.ts
@convex/presence.test.ts

# convex/schema.ts, no momento em que este plano foi escrito, contém SOMENTE users e presence
# (Fase 2). Releia o arquivo antes de editar — se a Fase 2 tiver adicionado algo a mais nesse
# meio tempo, preserve tudo que já existir e só ACRESCENTE as quatro tabelas abaixo.
#
# 04-RESEARCH.md §1 e §7: por que serverMembers tem dois índices (by_server_user composto +
# by_user single-field) e não três — um índice composto serve consultas por prefixo.
#
# 04-RESEARCH.md §2: não existe middleware de autorização no Convex — cada function checa por
# conta própria. Este plano cria o helper que centraliza essa checagem para o resto da fase.
#
# Escopo: SÓ servers/serverMembers/invites/channels + servers.ts (create, list). NÃO criar
# messages, channelReadState, voiceStates, dmChannels, dmMembers, friendRequests,
# friendships — fora de escopo desta fase (F5-F7).
</context>

<tasks>

<task type="auto">
  <name>Task 1: Schema das 4 tabelas + helper de autorização</name>
  <files>convex/schema.ts, convex/lib/membership.ts</files>
  <action>
    Editar `convex/schema.ts`, preservando `users` e `presence` exatamente como estão, e
    acrescentando:
    ```ts
    servers: defineTable({
      name: v.string(),
      iconUrl: v.optional(v.string()),
      ownerId: v.id('users'),
    }),

    serverMembers: defineTable({
      serverId: v.id('servers'),
      userId: v.id('users'),
      nickname: v.optional(v.string()),
      joinedAt: v.number(),
    })
      .index('by_server_user', ['serverId', 'userId'])
      .index('by_user', ['userId']),

    invites: defineTable({
      code: v.string(),
      serverId: v.id('servers'),
      createdBy: v.id('users'),
      revoked: v.boolean(),
    })
      .index('by_code', ['code'])
      .index('by_server', ['serverId']),

    channels: defineTable({
      serverId: v.id('servers'),
      name: v.string(),
      type: v.union(v.literal('text'), v.literal('voice')),
      position: v.number(),
    }).index('by_server', ['serverId']),
    ```
    `servers` não precisa de índice além do padrão por `_id` — nenhuma consulta desta fase
    lista servidores por `ownerId` ou `name` (a listagem "meus servidores" sempre passa por
    `serverMembers.by_user`, Task 2).

    Criar `convex/lib/membership.ts`:
    ```ts
    import type { MutationCtx, QueryCtx } from '../_generated/server'
    import type { Doc, Id } from '../_generated/dataModel'

    type Ctx = QueryCtx | MutationCtx

    /** Resolve a identidade autenticada para o documento `users` correspondente. Lança se não
     * houver sessão, ou se a sessão não tiver um documento `users` (ensureUser deveria ter
     * rodado antes — Fase 2, 02-05). Mesmo padrão de convex/presence.ts. */
    export async function requireIdentity(ctx: Ctx): Promise<Doc<'users'>> {
      const identity = await ctx.auth.getUserIdentity()
      if (!identity) throw new Error('Não autenticado')

      const user = await ctx.db
        .query('users')
        .withIndex('by_workos_id', (q) => q.eq('workosId', identity.subject))
        .unique()
      if (!user) {
        throw new Error('Usuário sem documento em users — ensureUser deveria ter rodado antes')
      }
      return user
    }

    /** Ponto central de SRV-06: lança se o usuário autenticado não for membro do servidor.
     * Usa o índice composto by_server_user — nunca varre serverMembers inteira. */
    export async function requireMembership(
      ctx: Ctx,
      serverId: Id<'servers'>
    ): Promise<{ user: Doc<'users'>; membership: Doc<'serverMembers'> }> {
      const user = await requireIdentity(ctx)
      const membership = await ctx.db
        .query('serverMembers')
        .withIndex('by_server_user', (q) => q.eq('serverId', serverId).eq('userId', user._id))
        .unique()
      if (!membership) throw new Error('Não é membro deste servidor')
      return { user, membership }
    }

    /** Para ações restritas ao dono (SRV-02/SRV-04: gerar/revogar convite). Implica
     * requireMembership — o dono é sempre membro. */
    export async function requireOwnership(
      ctx: Ctx,
      serverId: Id<'servers'>
    ): Promise<{ user: Doc<'users'>; server: Doc<'servers'> }> {
      const { user } = await requireMembership(ctx, serverId)
      const server = await ctx.db.get(serverId)
      if (!server) throw new Error('Servidor não encontrado')
      if (server.ownerId !== user._id) throw new Error('Apenas o dono do servidor pode fazer isso')
      return { user, server }
    }
    ```
    Este arquivo não expõe nenhuma `query`/`mutation` — é uma biblioteca interna importada por
    `./lib/membership` a partir de `servers.ts` (Task 2), e depois por `invites.ts`,
    `channels.ts`, `members.ts` (planos seguintes). Não reexportar via `api`.
  </action>
  <verify>`npx tsc --noEmit -p tsconfig.convex.json` (ou `npm run typecheck:convex` se já existir esse script) não aponta erro nos dois arquivos; `convex/schema.ts` continua exportando exatamente as 6 tabelas (2 antigas + 4 novas), nenhuma removida.</verify>
  <done>Schema com as 4 tabelas desta fase e os 3 helpers de autorização prontos para importação.</done>
</task>

<task type="auto">
  <name>Task 2: createServer + listMyServers, testados</name>
  <files>convex/servers.ts, convex/servers.test.ts</files>
  <action>
    Criar `convex/servers.ts`:
    ```ts
    import { mutation, query } from './_generated/server'
    import { v } from 'convex/values'
    import { requireIdentity, requireMembership } from './lib/membership'

    export const createServer = mutation({
      args: { name: v.string() },
      handler: async (ctx, { name }) => {
        const trimmed = name.trim()
        if (trimmed.length < 2 || trimmed.length > 50) {
          throw new Error('Nome do servidor deve ter entre 2 e 50 caracteres')
        }

        const user = await requireIdentity(ctx)
        const serverId = await ctx.db.insert('servers', { name: trimmed, ownerId: user._id })
        await ctx.db.insert('serverMembers', { serverId, userId: user._id, joinedAt: Date.now() })
        return serverId
      },
    })

    export const listMyServers = query({
      args: {},
      handler: async (ctx) => {
        const user = await requireIdentity(ctx)
        const memberships = await ctx.db
          .query('serverMembers')
          .withIndex('by_user', (q) => q.eq('userId', user._id))
          .collect()

        const servers = await Promise.all(memberships.map((m) => ctx.db.get(m.serverId)))
        return servers.filter((s): s is NonNullable<typeof s> => s !== null)
      },
    })

    export const amIOwner = query({
      args: { serverId: v.id('servers') },
      handler: async (ctx, { serverId }) => {
        const { user } = await requireMembership(ctx, serverId)
        const server = await ctx.db.get(serverId)
        return server?.ownerId === user._id
      },
    })
    ```
    `amIOwner` existe só para a UI (plano 04-06) decidir, sem gambiarra, se mostra os botões
    de "gerar novo código"/"revogar convite" — que continuam sendo aplicados no backend por
    `requireOwnership` dentro de `convex/invites.ts` (plano 04-02), essa query nunca é a fonte
    de verdade da autorização, só evita mostrar um botão que vai falhar. Por isso importa
    `requireMembership` também (não só `requireIdentity`) — ver import ajustado abaixo.

    Nenhuma checagem de "é membro?" é necessária em `createServer`/`listMyServers` além de
    `requireIdentity`: `createServer` sempre torna o chamador dono+membro (não há conceito de
    "criar servidor para outro usuário"), e `listMyServers` já filtra pelo índice `by_user` do
    próprio chamador — não existe caminho para vazar servidor de outra pessoa. `amIOwner` é
    diferente: opera sobre um `serverId` arbitrário vindo do cliente, então precisa confirmar
    participação (`requireMembership`) antes de revelar até mesmo o booleano de "é dono?" —
    não-membro não deveria aprender nada sobre um servidor, nem essa informação mínima
    (consistente com SRV-06).

    Criar `convex/servers.test.ts` seguindo exatamente o padrão de `convex/presence.test.ts`
    (`convexTest(schema, modules)`, `anyApi` de `convex/server`, `import.meta.glob('./**/*.ts')`):
    1. `createServer` sem identidade autenticada rejeita.
    2. `createServer({ name: 'Galera do Sinuca' })` autenticado: confirma que o `servers` criado
       tem `ownerId === user._id`, e que existe exatamente uma linha em `serverMembers` com
       `serverId`/`userId` correspondentes.
    3. Nome vazio/só espaços e nome com mais de 50 caracteres rejeitam (validação de Task 1).
    4. `listMyServers` com dois usuários (Ana cria servidor A, Bruno cria servidor B): a
       consulta de Ana como Ana retorna só A; como Bruno retorna só B — nunca os dois nem o do
       outro. Usar `t.withIdentity({ subject: '...' })` para simular cada um.
    5. `amIOwner`: dono do servidor recebe `true`; membro comum (não-dono) recebe `false`;
       não-membro chamando com o `serverId` de um servidor real rejeita (mesmo padrão de
       SRV-06 já exercido em `listChannels`/`getChannel`, plano 04-03).
  </action>
  <verify>`npx vitest run convex/servers.test.ts` passa. Nenhum teste depende de `convex/_generated/api` (usar `anyApi`).</verify>
  <done>`createServer`/`listMyServers`/`amIOwner` funcionam e estão cobertos por teste automatizado, incluindo o caso de isolamento entre usuários (base de SRV-06 para o resto da fase).</done>
</task>

</tasks>

<verification>
- `npm run typecheck:convex` (ou `tsc --noEmit -p tsconfig.convex.json`) passa sem erro nos 4 arquivos novos/editados.
- `npx vitest run convex/servers.test.ts` passa.
- `convex/schema.ts` tem exatamente 6 tabelas: users, presence (Fase 2, intocadas), servers, serverMembers, invites, channels (novas).
- Nenhuma outra tabela do design doc (messages, voiceStates, dmChannels, etc.) foi criada.
</verification>

<success_criteria>
SRV-01 satisfeito no nível de dados (criar servidor = virar dono+membro, verificável por
teste). Fundação pronta para os planos 04-02 a 04-04 (convites, canais, membros) e para o
primeiro plano de renderer (04-05) sair do estado "zero servidores".
</success_criteria>

<output>
After completion, create `.planning/phases/04-servidores-e-canais/04-01-SUMMARY.md`.
</output>
