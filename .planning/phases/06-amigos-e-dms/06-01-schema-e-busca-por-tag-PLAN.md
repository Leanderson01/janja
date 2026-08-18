---
phase: 06-amigos-e-dms
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - convex/schema.ts
  - convex/users.ts
  - convex/users.test.ts
autonomous: true

must_haves:
  truths:
    - "As 5 tabelas novas (friendRequests, friendships, dmChannels, dmMembers, dmMessages) existem no schema publicado, com os índices exatos decididos em 06-RESEARCH.md §8"
    - "Buscar um usuário por USER#123 (username + tag) resolve por índice, nunca por varredura"
    - "Buscar um USER#123 inexistente retorna null, nunca lança exceção nem quebra a query"
  artifacts:
    - path: "convex/schema.ts"
      provides: "5 tabelas novas: friendRequests, friendships, dmChannels, dmMembers, dmMessages"
      contains: "by_pair"
    - path: "convex/users.ts"
      provides: "Query pública findUserByUsernameTag(username, tag) — reusa o índice by_username_tag já publicado, não reimplementa ensureUser nem a geração de tag"
      contains: "findUserByUsernameTag"
  key_links:
    - from: "convex/users.ts (findUserByUsernameTag)"
      to: "convex/schema.ts (users.by_username_tag)"
      via: "ctx.db.query('users').withIndex('by_username_tag', ...)"
      pattern: "by_username_tag"
---

<objective>
Publicar o schema que sustenta toda a Fase 6 (SOCIAL-01 a SOCIAL-06) e entregar a
primeira peça de SOCIAL-01: dado um identificador `USER#123`, resolver para no
máximo um usuário via índice.

Purpose: todas as mutations/queries dos próximos 4 planos (pedidos de amizade,
lista de amigos, canais de DM, mensagens de DM) dependem dessas 5 tabelas
existirem primeiro — este plano é a única coisa em Wave 1, todo o resto do
paralelismo da fase depende de terminar aqui antes.
Output: `convex/schema.ts` com as 5 tabelas novas publicadas no deployment do
Convex, e `convex/users.ts` com uma nova query de busca, testada.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/06-amigos-e-dms/06-RESEARCH.md
@docs/superpowers/specs/2026-08-18-janja-discord-clone-design.md

# 06-RESEARCH.md §1 confirma que convex/users.ts já existe (plano 02-05, Fase 2
# executando em paralelo) com a mutation `ensureUser` e o índice
# `users.by_username_tag` já publicado. NÃO editar `ensureUser` nem
# `convex/lib/tag.ts` — só adicionar uma query nova ao mesmo arquivo.
#
# 06-RESEARCH.md §2 e §8 têm a decisão exata de índices para as 5 tabelas —
# copiar dali, não reprojetar.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Schema das 5 tabelas de amigos/DM</name>
  <files>convex/schema.ts</files>
  <action>
    Ler `convex/schema.ts` atual primeiro (tem `users` e `presence`, publicados
    pela Fase 2 — não remover nem alterar essas duas tabelas). Adicionar as 5
    tabelas abaixo, exatamente com estes campos e índices (decisão já
    verificada contra a documentação oficial do Convex em `06-RESEARCH.md §2` e
    `§8` — não adicionar nem remover índices):

    ```ts
    friendRequests: defineTable({
      fromUserId: v.id('users'),
      toUserId: v.id('users'),
      createdAt: v.number()
    })
      .index('by_from_to', ['fromUserId', 'toUserId'])
      .index('by_to', ['toUserId']),

    friendships: defineTable({
      userA: v.id('users'),
      userB: v.id('users'),
      createdAt: v.number()
    })
      .index('by_pair', ['userA', 'userB'])
      .index('by_userB', ['userB']),

    dmChannels: defineTable({
      createdAt: v.number()
    }),

    dmMembers: defineTable({
      dmChannelId: v.id('dmChannels'),
      userId: v.id('users')
    })
      .index('by_user', ['userId'])
      .index('by_channel_user', ['dmChannelId', 'userId']),

    dmMessages: defineTable({
      dmChannelId: v.id('dmChannels'),
      authorId: v.id('users'),
      content: v.string(),
      createdAt: v.number()
    })
      .index('by_dm_channel', ['dmChannelId'])
    ```

    Note que `friendRequests` **não tem campo `status`** — decisão deliberada
    registrada em `06-RESEARCH.md §2`: a existência do documento já significa
    "pendente"; aceitar apaga o pedido e insere `friendships`, recusar só
    apaga. Não adicionar esse campo de volta.

    Note que `dmChannels` **não guarda `userA`/`userB`** — a relação
    canal↔usuário vive inteiramente em `dmMembers` (hard constraint da tarefa:
    join table, não array), inclusive para descobrir se já existe uma DM entre
    dois usuários (planos 06-04/06-05 fazem essa checagem via `dmMembers`, não
    aqui).

    Depois de editar, publicar o schema:
    ```bash
    npx convex dev --once
    ```
    Isso empurra o schema para o deployment já provisionado (checkpoint 02-04
    da Fase 2) e regenera `convex/_generated/`, incluindo `api.ts` (usado pelos
    planos de UI mais adiante, ainda não existe no disco).

    **Se o comando falhar por falta de credenciais** (`.env.local` ausente ou
    `CONVEX_DEPLOYMENT` não configurado): isso é uma dependência não satisfeita
    da Fase 2 (checkpoint 02-04), não um bug deste plano. Não inventar
    credenciais nem pular a publicação — parar e reportar como bloqueio no
    SUMMARY, listando exatamente o erro do comando.
  </action>
  <verify>
    `npx convex dev --once` termina com exit code 0 e a saída lista os 5 novos
    índices publicados (mesmo formato de tabela mostrado em
    `02-04-SUMMARY.md`).
    `grep -n "by_pair\|by_from_to\|by_channel_user\|by_dm_channel" convex/schema.ts`
    retorna as 4 linhas.
  </verify>
  <done>Schema publicado com as 5 tabelas novas e seus índices exatos; convex/_generated/ regenerado.</done>
</task>

<task type="auto">
  <name>Task 2: Query findUserByUsernameTag (busca por USER#123)</name>
  <files>convex/users.ts, convex/users.test.ts</files>
  <action>
    RED — adicionar a `convex/users.test.ts` existente (não recriar o arquivo,
    só acrescentar um novo `describe`) casos de teste para uma query ainda não
    implementada:

    ```ts
    describe('users.findUserByUsernameTag', () => {
      it('retorna o usuário quando (username, tag) existe', async () => { ... })
      it('retorna null quando o par não existe', async () => { ... })
      it('retorna null quando o username existe mas a tag não bate', async () => { ... })
    })
    ```
    Seed via `t.run(ctx => ctx.db.insert('users', {...}))` (mesmo padrão já
    usado nos testes existentes de `ensureUser`), sem precisar de identidade
    autenticada — esta é uma busca pública (qualquer usuário logado pode
    procurar outro por `USER#123`, é o próprio propósito de SOCIAL-01).
    Confirmar que os testes falham (a query ainda não existe).

    GREEN — adicionar ao final de `convex/users.ts` (sem tocar em
    `ensureUser` nem `baseUsernameFromEmail`):
    ```ts
    import { mutation, query } from './_generated/server'
    import { v } from 'convex/values'

    export const findUserByUsernameTag = query({
      args: { username: v.string(), tag: v.string() },
      handler: async (ctx, args) => {
        const user = await ctx.db
          .query('users')
          .withIndex('by_username_tag', (q) =>
            q.eq('username', args.username).eq('tag', args.tag)
          )
          .unique()
        if (!user) return null
        // Nunca devolver workosId a outro usuário — é um identificador
        // interno do provedor de auth, não parte da identidade pública
        // USER#123.
        return {
          _id: user._id,
          username: user.username,
          tag: user.tag,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl
        }
      }
    })
    ```
    Rodar os testes até passarem.
  </action>
  <verify>`npx vitest run convex/users.test.ts` passa, incluindo os 3 novos casos.</verify>
  <done>findUserByUsernameTag resolve por índice, nunca varredura, e nunca vaza workosId.</done>
</task>

</tasks>

<verification>
- `npx vitest run convex` passa (todos os arquivos, incluindo os já existentes de presence/tag/users).
- `npx convex dev --once` publica sem erro; `convex/_generated/api.ts` existe depois.
- Nenhuma tabela nova usa `.filter()` como substituto de índice em nenhum ponto deste plano (não há query além de `findUserByUsernameTag`, que já usa `withIndex`).
</verification>

<success_criteria>
Fundação de dados da Fase 6 publicada e testável; SOCIAL-01 (encontrar por
USER#123) resolvido no nível de dados, pronto para os planos 06-02 a 06-05
consumirem sem reimplementar nada deste plano.
</success_criteria>

<output>
After completion, create `.planning/phases/06-amigos-e-dms/06-01-SUMMARY.md`.
</output>
