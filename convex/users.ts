import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import * as identity from './lib/identity'
import * as tag from './lib/tag'

// Dica de perfil enviada pelo cliente no primeiro login.
//
// POR QUE O CLIENTE PRECISA MANDAR ISSO (não é preguiça, é a causa raiz):
// o JWT que o Convex verifica é o ACCESS TOKEN do WorkOS, e ele não carrega
// e-mail nem nome — as claims são só `sid/org_id/role/permissions/...` além
// das padrão (`UserManagementAccessToken`, no .d.ts do @workos-inc/node; ver
// o cabeçalho de lib/identity.ts). O processo main, esse sim, recebe o
// objeto `User` completo do `authenticateWithCodeAndVerifier` e o expõe ao
// renderer por `window.auth.getUser()`.
//
// POR QUE ACEITAR ISSO DO CLIENTE É SEGURO:
// a dica só alimenta a criação do documento DO PRÓPRIO CHAMADOR, e só campos
// que ele pode reescrever à vontade um segundo depois via `updateProfile`.
// `workosId` continua vindo exclusivamente de `ctx.auth.getUserIdentity()` —
// nenhum argumento do cliente chega perto dele, que é o que impede alguém de
// se passar por outro. Tudo o que entra passa pela mesma validação do
// rename; nada é gravado cru.
//
// Se o Leo configurar um JWT Template no dashboard do WorkOS expondo
// `email`/`name`/`picture`, as claims passam a existir e ganham precedência
// sobre a dica automaticamente (ver `hintsFrom` abaixo) — sem mudar código.
const profileHint = v.optional(
  v.object({
    name: v.optional(v.string()),
    givenName: v.optional(v.string()),
    email: v.optional(v.string()),
    pictureUrl: v.optional(v.string())
  })
)

type ProfileHint = {
  name?: string
  givenName?: string
  email?: string
  pictureUrl?: string
}

type AuthIdentity = { name?: string; givenName?: string; email?: string; pictureUrl?: string }

/** Claim verificada do JWT ganha da dica do cliente, sempre. */
function hintsFrom(id: AuthIdentity, hint: ProfileHint | undefined): identity.IdentityHints {
  return {
    name: id.name ?? hint?.name,
    givenName: id.givenName ?? hint?.givenName,
    email: id.email ?? hint?.email
  }
}

/**
 * Só http(s) vira avatar. Sem esta peneira, uma dica do cliente poderia
 * plantar um `javascript:`/`data:` no `src` de um <img> renderizado para
 * TODO MUNDO que abre a lista de membros — o avatar é o único campo do
 * perfil que a UI interpreta como URL em vez de texto.
 */
function safeAvatarUrl(...candidates: (string | undefined | null)[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue
    if (/^https?:\/\//i.test(candidate)) return candidate
  }
  return undefined
}

/** Resolve o documento do chamador a partir da identidade autenticada. */
async function callerUser(ctx: MutationCtx | QueryCtx): Promise<Doc<'users'> | null> {
  const id = await ctx.auth.getUserIdentity()
  if (!id) return null
  return await ctx.db
    .query('users')
    .withIndex('by_workos_id', (q) => q.eq('workosId', id.subject))
    .unique()
}

/**
 * "Esse par (username, tag) já está ocupado por OUTRA pessoa?"
 *
 * Convex não tem constraint de unicidade nativa (02-RESEARCH.md §5): o índice
 * `by_username_tag` só acelera a pergunta — a garantia é 100% desta checagem
 * feita dentro da mesma mutation transacional que grava, exatamente o padrão
 * já documentado no topo de lib/tag.ts. `exceptUserId` existe para o rename
 * não colidir com o próprio usuário que está renomeando.
 */
async function pairTaken(
  ctx: MutationCtx | QueryCtx,
  username: string,
  candidateTag: string,
  exceptUserId?: Doc<'users'>['_id']
): Promise<boolean> {
  const collision = await ctx.db
    .query('users')
    .withIndex('by_username_tag', (q) => q.eq('username', username).eq('tag', candidateTag))
    .unique()
  if (!collision) return false
  return collision._id !== exceptUserId
}

/** Sorteia uma tag livre para um dado username. */
async function freeTagFor(ctx: MutationCtx, username: string): Promise<string> {
  return await tag.findAvailableTag({
    generateTag: tag.generateFourDigitTag,
    existsFn: (candidate) => pairTaken(ctx, username, candidate)
  })
}

// Upsert por workosId — primeiro login gera um username#tag único (AUTH-06),
// logins seguintes só retornam o documento já existente. Nunca aceita
// workosId vindo do cliente: ele deriva de ctx.auth.getUserIdentity(), que é
// validado pelo JWT do WorkOS (ver auth.config.ts / 02-RESEARCH.md §4).
export const ensureUser = mutation({
  args: { profile: profileHint },
  handler: async (ctx, { profile }) => {
    const id = await ctx.auth.getUserIdentity()
    if (!id) {
      throw new Error('ensureUser requer uma identidade autenticada')
    }

    const hints = hintsFrom(id, profile)

    const existing = await ctx.db
      .query('users')
      .withIndex('by_workos_id', (q) => q.eq('workosId', id.subject))
      .unique()
    if (existing) {
      return await healOpaqueUsername(ctx, existing, hints, profile)
    }

    const derived = identity.deriveIdentity(hints)
    const newTag = await freeTagFor(ctx, derived.username)

    const userId = await ctx.db.insert('users', {
      workosId: id.subject,
      username: derived.username,
      tag: newTag,
      displayName: derived.displayName,
      avatarUrl: safeAvatarUrl(id.pictureUrl, profile?.pictureUrl)
    })

    return await ctx.db.get(userId)
  }
})

/**
 * Conserto de quem JÁ ENTROU antes desta correção.
 *
 * O bug gravou `username = workosId` (o `sub` opaco do WorkOS,
 * `user_01m0bc3v...`) em quem logou com a derivação antiga. Corrigir a
 * derivação não reescreve linha já gravada, então o próximo `ensureUser`
 * conserta — mas SÓ nesse caso exato (`username === workosId`), nunca em
 * cima de um nome que a pessoa escolheu. Quem já renomeou pela mão nunca
 * tem o nome sobrescrito por um login.
 *
 * O `_id` não muda: amizades, mensagens e membros de servidor apontam para
 * ele, não para o username, e sobrevivem intactos à troca.
 */
async function healOpaqueUsername(
  ctx: MutationCtx,
  user: Doc<'users'>,
  hints: identity.IdentityHints,
  profile: ProfileHint | undefined
): Promise<Doc<'users'> | null> {
  if (user.username !== user.workosId) return user

  const derived = identity.deriveIdentity(hints)
  const keepsTag = !(await pairTaken(ctx, derived.username, user.tag, user._id))
  const nextTag = keepsTag ? user.tag : await freeTagFor(ctx, derived.username)

  await ctx.db.patch(user._id, {
    username: derived.username,
    tag: nextTag,
    // displayName também estava opaco (era cópia do username) — só é trocado
    // se ainda for o valor quebrado.
    displayName: user.displayName === user.workosId ? derived.displayName : user.displayName,
    avatarUrl: safeAvatarUrl(user.avatarUrl, profile?.pictureUrl)
  })

  return await ctx.db.get(user._id)
}

/**
 * Perfil do próprio chamador — é o que o diálogo de edição usa para
 * pré-preencher os campos. Devolve `null` (nunca lança) quando ainda não há
 * sessão ou o `ensureUser` ainda não rodou, para a UI poder renderizar um
 * estado de carregamento em vez de quebrar.
 *
 * Diferente de `findUserByUsernameTag`, aqui `workosId` também não sai: a UI
 * não tem uso para ele, e o que não é devolvido não pode vazar.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await callerUser(ctx)
    if (!user) return null
    return {
      _id: user._id,
      username: user.username,
      tag: user.tag,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl
    }
  }
})

/**
 * Renomear nome de usuário, tag e/ou nome de exibição.
 *
 * Todos os argumentos são opcionais e independentes: mandar só `displayName`
 * mexe só nele. `username` é canonizado (minúsculo, sem acento — ver
 * lib/identity.ts para o porquê), `tag` é escolhida à mão em 4 dígitos, e a
 * unicidade é do PAR, não de cada um: `joao#0001` e `joao#0002` convivem.
 *
 * A checagem de colisão e o `patch` acontecem na MESMA mutation, e mutation
 * de Convex é transacional e serializável — não existe janela entre "está
 * livre?" e "gravei" para duas pessoas pegarem o mesmo par.
 */
export const updateProfile = mutation({
  args: {
    username: v.optional(v.string()),
    tag: v.optional(v.string()),
    displayName: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const user = await callerUser(ctx)
    if (!user) {
      throw new Error('Faça login novamente para editar o perfil')
    }

    let nextUsername = user.username
    if (args.username !== undefined) {
      const result = identity.validateUsername(args.username)
      if (!result.ok) throw new Error(result.error)
      nextUsername = result.value
    }

    let nextTag = user.tag
    if (args.tag !== undefined) {
      const result = identity.validateTag(args.tag)
      if (!result.ok) throw new Error(result.error)
      nextTag = result.value
    }

    let nextDisplayName = user.displayName
    if (args.displayName !== undefined) {
      const result = identity.validateDisplayName(args.displayName)
      if (!result.ok) throw new Error(result.error)
      nextDisplayName = result.value
    }

    const pairChanged = nextUsername !== user.username || nextTag !== user.tag
    if (pairChanged && (await pairTaken(ctx, nextUsername, nextTag, user._id))) {
      throw new Error(identity.usernameTakenError(nextUsername, nextTag))
    }

    await ctx.db.patch(user._id, {
      username: nextUsername,
      tag: nextTag,
      displayName: nextDisplayName
    })

    const updated = await ctx.db.get(user._id)
    if (!updated) throw new Error('Perfil não encontrado')
    return {
      _id: updated._id,
      username: updated.username,
      tag: updated.tag,
      displayName: updated.displayName,
      avatarUrl: updated.avatarUrl
    }
  }
})

// Busca pública por identificador `USER#123` (SOCIAL-01): resolve o par
// (username, tag) pelo índice by_username_tag já publicado, nunca por
// varredura. Qualquer usuário autenticado pode procurar outro por esse
// identificador — é o próprio propósito da busca de amigos.
export const findUserByUsernameTag = query({
  args: { username: v.string(), tag: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_username_tag', (q) => q.eq('username', args.username).eq('tag', args.tag))
      .unique()
    if (!user) return null
    // Nunca devolver workosId a outro usuário — é um identificador interno
    // do provedor de auth, não parte da identidade pública USER#123.
    return {
      _id: user._id,
      username: user.username,
      tag: user.tag,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl
    }
  }
})
