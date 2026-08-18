---
phase: 06-amigos-e-dms
plan: 05
type: execute
wave: 3
depends_on: ["06-04"]
files_modified:
  - convex/dms.ts
  - convex/dms.test.ts
autonomous: true

must_haves:
  truths:
    - "Usuário vê a lista das conversas diretas que já tem"
    - "Usuário vê o histórico de mensagens de uma conversa direta, paginado"
    - "Usuário que não é membro de um canal de DM não consegue ler as mensagens dele, mesmo sabendo o id do canal"
  artifacts:
    - path: "convex/dms.ts"
      provides: "Query listMyDmChannels e query paginada listDmMessages"
      exports: ["listMyDmChannels", "listDmMessages"]
  key_links:
    - from: "convex/dms.ts (listDmMessages)"
      to: "convex/schema.ts (dmMessages.by_dm_channel)"
      via: "withIndex + order('desc') + paginate(paginationOpts)"
      pattern: "paginationOptsValidator"
    - from: "convex/dms.ts (listDmMessages)"
      to: "convex/dms.ts (assertDmMember)"
      via: "checagem de membership antes de paginar, reaproveitada do plano 06-04"
      pattern: "assertDmMember"
---

<objective>
Completar o backend de DM: listar minhas conversas e ler o histórico paginado
de uma conversa — as duas peças de leitura que faltam depois que o plano
06-04 resolveu criar canal e enviar mensagem.

Purpose: sem isto, a UI do plano 06-07 não tem de onde listar as conversas
nem renderizar o histórico de mensagens, e SOCIAL-05 fica sem metade de
leitura.
Output: `convex/dms.ts` completo, testado, incluindo o caso de autorização
mais sensível da fase (ler mensagem de conversa alheia).
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/06-amigos-e-dms/06-RESEARCH.md
@.planning/research/PITFALLS.md

# 06-RESEARCH.md §3: padrão oficial de paginação Convex — paginationOptsValidator
# no args, .withIndex(...).order('desc').paginate(args.paginationOpts) no
# handler, usePaginatedQuery no cliente (fica pro plano 06-07). Tamanho de
# página pode variar entre chamadas — não é bug.
</context>

<tasks>

<task type="auto">
  <name>Task 1: listMyDmChannels</name>
  <files>convex/dms.ts, convex/dms.test.ts</files>
  <action>
    Adicionar a `convex/dms.ts` (reaproveitar `getCallerUser` já extraído no
    plano 06-04):

    ```ts
    export const listMyDmChannels = query({
      args: {},
      handler: async (ctx) => {
        const me = await getCallerUser(ctx)

        const myMemberships = await ctx.db
          .query('dmMembers')
          .withIndex('by_user', (q) => q.eq('userId', me._id))
          .collect()

        return await Promise.all(
          myMemberships.map(async (membership) => {
            const otherMembers = await ctx.db
              .query('dmMembers')
              .withIndex('by_channel_user', (q) => q.eq('dmChannelId', membership.dmChannelId))
              .collect()
            const other = otherMembers.find((m) => m.userId !== me._id)
            const otherUser = other ? await ctx.db.get(other.userId) : null

            return {
              dmChannelId: membership.dmChannelId,
              otherUser: otherUser
                ? {
                    userId: otherUser._id,
                    username: otherUser.username,
                    tag: otherUser.tag,
                    displayName: otherUser.displayName,
                    avatarUrl: otherUser.avatarUrl
                  }
                : null
            }
          })
        )
      }
    })
    ```

    Nota: DMs em grupo estão fora de escopo do MVP (design doc §8, "fora do
    MVP" não lista explicitamente, mas `dmMembers` só é populado com 2 linhas
    por canal pelo plano 06-04) — `otherUser: null` é um caminho defensivo
    para um canal com membership corrompida, não um caso esperado; não
    remover a checagem só porque "não deveria acontecer".

    Caso de teste: usuário com 2 conversas diretas ativas (seed via `t.run`,
    inserindo 2 `dmChannels` + 4 `dmMembers`) vê as 2 na lista, cada uma com o
    `otherUser` correto (não confundir qual é qual). Usuário sem nenhuma
    conversa vê lista vazia, sem erro.
  </action>
  <verify>`npx vitest run convex/dms.test.ts` passa, incluindo o caso de 2 conversas simultâneas sem confundir o outro participante.</verify>
  <done>Lista de conversas diretas pronta para a UI (sidebar de DMs, plano 06-07).</done>
</task>

<task type="auto">
  <name>Task 2: listDmMessages paginado</name>
  <files>convex/dms.ts, convex/dms.test.ts</files>
  <action>
    Adicionar, importando `paginationOptsValidator` de `'convex/server'`:

    ```ts
    import { paginationOptsValidator } from 'convex/server'

    export const listDmMessages = query({
      args: { dmChannelId: v.id('dmChannels'), paginationOpts: paginationOptsValidator },
      handler: async (ctx, args) => {
        const me = await getCallerUser(ctx)
        await assertDmMember(ctx, args.dmChannelId, me._id)

        return await ctx.db
          .query('dmMessages')
          .withIndex('by_dm_channel', (q) => q.eq('dmChannelId', args.dmChannelId))
          .order('desc')
          .paginate(args.paginationOpts)
      }
    })
    ```

    A checagem de membership vem **antes** da paginação — nunca paginar
    primeiro e checar depois, isso vazaria a existência/contagem de mensagens
    de uma conversa alheia mesmo que o conteúdo não fosse exposto.

    Casos de teste:
    - Rejeita sem identidade.
    - **Caso central da fase**: usuário que não é membro do `dmChannelId`
      (seed um canal entre dois outros usuários, chamar como um terceiro) →
      `listDmMessages` lança erro, nunca retorna nem uma página vazia
      silenciosa (a diferença importa: página vazia sugeriria "canal existe
      mas está vazio", erro deixa claro "você não tem acesso").
    - Membro do canal recebe as mensagens daquele canal, ordenadas da mais
      recente pra mais antiga (`order('desc')`), respeitando
      `paginationOpts.numItems` (chamar com `{ numItems: 2, cursor: null }`
      contra 3 mensagens seedadas via `t.run`, confirmar `results.length ===
      2` e `isDone === false`).
  </action>
  <verify>`npx vitest run convex/dms.test.ts` passa, incluindo o teste de paginação com numItems menor que o total de mensagens e o teste de autorização (não-membro rejeitado antes de qualquer paginação).</verify>
  <done>Histórico de DM lido por índice, paginado, e inacessível a quem não é membro do canal.</done>
</task>

</tasks>

<verification>
- `npx vitest run convex/dms.test.ts` passa por completo (casos dos planos 06-04 e 06-05 juntos).
- Nenhuma query nova usa `.filter()` como substituto de índice.
- Autorização de leitura testada explicitamente (não só a de escrita do plano 06-04).
</verification>

<success_criteria>
SOCIAL-05 completo no nível de dados (abrir conversa, listar conversas, ler
histórico paginado, enviar mensagem); `convex/dms.ts` pronto para a UI do
plano 06-07.
</success_criteria>

<output>
After completion, create `.planning/phases/06-amigos-e-dms/06-05-SUMMARY.md`.
</output>
