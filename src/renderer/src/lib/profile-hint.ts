/**
 * Dica de perfil enviada ao `ensureUser` do Convex no primeiro login.
 *
 * POR QUE ELA EXISTE: o JWT que o Convex verifica é o access token do
 * WorkOS, e ele não carrega claim de e-mail nem de nome — só
 * `sid/org_id/role/permissions/...` além das padrão. Dentro do Convex,
 * portanto, `identity.email` chega `undefined`, e a derivação antiga caía
 * no `sub` opaco (`user_01m0bc3v...`), que foi o nome feio que apareceu na
 * lista de membros e no canal de voz.
 *
 * Quem tem o perfil de verdade é o processo main: ele recebe o objeto `User`
 * completo do `authenticateWithCodeAndVerifier` e o expõe em
 * `window.auth.getUser()`. Este módulo só traduz aquele formato para o que a
 * mutation aceita. A confiança continua no servidor: ele valida tudo, dá
 * precedência a qualquer claim verificada do JWT e nunca deixa a dica
 * influenciar o `workosId` (ver o comentário de `ensureUser` em
 * convex/users.ts).
 */
export type ProfileHint = {
  name?: string
  givenName?: string
  email?: string
  pictureUrl?: string
}

/** Formato do `AuthUser` exposto pelo preload (src/main/auth/types.ts). */
export type AuthUserLike = {
  email: string
  firstName: string | null
  lastName: string | null
  profilePictureUrl: string | null
}

/**
 * Campo vazio é OMITIDO em vez de virar string vazia, de propósito: o
 * servidor escolhe o fallback pela AUSÊNCIA do campo, então mandar `''`
 * esconderia a próxima opção da ordem de preferência e produziria de novo um
 * nome ruim.
 */
export function toProfileHint(user: AuthUserLike | null | undefined): ProfileHint {
  if (!user) return {}
  const fullName = [user.firstName, user.lastName]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim()

  const hint: ProfileHint = {}
  if (fullName.length > 0) hint.name = fullName
  if (user.firstName && user.firstName.trim().length > 0) hint.givenName = user.firstName.trim()
  if (user.email && user.email.trim().length > 0) hint.email = user.email.trim()
  if (user.profilePictureUrl) hint.pictureUrl = user.profilePictureUrl
  return hint
}
