// Derivação e validação de identidade pública: `username`, `tag` e
// `displayName`. Arquivo PURO — nenhuma dependência de Convex, testável
// isoladamente (mesmo contrato de `lib/tag.ts`).
//
// ---------------------------------------------------------------------------
// POR QUE ESTE ARQUIVO EXISTE (a causa do nome feio na tela)
// ---------------------------------------------------------------------------
// O `ensureUser` original derivava o username de `identity.email`, com
// fallback para `identity.subject`. Só que o JWT que o Convex verifica é o
// ACCESS TOKEN do WorkOS, e ele NÃO carrega e-mail nem nome: o próprio SDK
// tipa suas claims em `UserManagementAccessToken`
// (node_modules/@workos-inc/node/lib/factory-*.d.mts) como
// `{ sid, org_id?, role?, roles?, permissions?, entitlements?, feature_flags? }`
// — mais as claims padrão `iss/sub/exp/iat/jti`. Nada de `email`, `name` ou
// `picture`.
//
// Resultado: `identity.email` chegava `undefined`, o fallback entrava, e o
// username virava literalmente o `sub` do WorkOS
// (`user_01m0bc3v1ggfds20pcc4bhjjcp`) — que é o que apareceu na tela do Leo.
//
// A correção tem duas frentes, e as duas passam por aqui:
//   1. `deriveIdentity` nunca mais usa o `subject` como nome. O último
//      recurso é `usuario` (a tag de 4 dígitos já desambigua).
//   2. O perfil real (nome do Google + e-mail) passa a chegar como DICA do
//      cliente, porque o processo main já o tem em mãos vindo do
//      `authenticateWithCodeAndVerifier` — ver o comentário de `ensureUser`
//      em `../users.ts` para o raciocínio de segurança.
//
// ---------------------------------------------------------------------------
// AS REGRAS, E POR QUE SÃO ESTAS
// ---------------------------------------------------------------------------
// `username` é IDENTIFICADOR, não nome próprio: é o que outra pessoa digita
// em "adicionar amigo" (`joao.silva#0001`). Por isso ele é canonizado em
// minúsculas ASCII. Não é preferência estética — é a única forma de a busca
// ser insensível a maiúsculas SEM inventar um campo/índice novo: o Convex não
// tem constraint de unicidade nem comparação case-insensitive em índice (ver
// `lib/tag.ts`), então "mesma pessoa digitando Joao ou joao acha o mesmo
// usuário" só sai de graça se existir uma única grafia possível gravada.
// Guardar `Joao` e `joao` como coisas diferentes criaria dois usuários
// visualmente idênticos e uma busca que falha por causa do Shift.
//
// O lado humano do nome mora em `displayName`, que é livre, aceita acento,
// espaço e maiúscula ("João Silva") e NÃO tem unicidade — dois "João Silva"
// podem coexistir, e é isso que se espera de um apelido.
//
// Comprimentos: 2..32 para username (1 caractere não identifica ninguém e
// 32 é o teto do Discord, referência que o projeto todo copia), 1..32 para
// displayName.

export const USERNAME_MIN_LENGTH = 2
export const USERNAME_MAX_LENGTH = 32
export const DISPLAY_NAME_MIN_LENGTH = 1
export const DISPLAY_NAME_MAX_LENGTH = 32

/** Último recurso de username — nunca o `subject` do provedor de auth. */
export const USERNAME_FALLBACK = 'usuario'

const USERNAME_ALLOWED = /^[a-z0-9._-]+$/
const USERNAME_EDGES = /^[a-z0-9].*[a-z0-9]$/
const TAG_PATTERN = /^\d{4}$/

/**
 * Transforma texto humano num handle canônico: sem acento, minúsculo, e com
 * qualquer caractere fora de [a-z0-9._-] virando ponto. Pontos/hífens/
 * sublinhados repetidos colapsam, e as bordas são aparadas — `.joao..silva.`
 * e `João  Silva` chegam os dois em `joao.silva`.
 *
 * Devolve string vazia quando não sobra nada aproveitável (ex: um nome só de
 * emoji). Quem chama decide o fallback; esta função nunca inventa nome.
 */
export function slugifyUsername(input: string): string {
  const withoutDiacritics = input
    .normalize('NFD')
    // Faixa de combining marks do Unicode — o que sobra de "ã" depois do NFD.
    .replace(/[\u0300-\u036f]/g, '')
  return withoutDiacritics
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/[._-]{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
}

/**
 * Capitalização humana para `displayName` derivado: separadores viram espaço
 * e cada palavra ganha inicial maiúscula. `joao.silva` -> `Joao Silva`.
 *
 * Só é usada quando NÃO há nome vindo do provedor — se o Google mandou
 * "João Silva", esse texto é usado como veio, com acento e tudo.
 */
export function humanizeUsername(username: string): string {
  return username
    .split(/[._-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/** Parte antes do "@". Devolve o próprio texto se não houver "@". */
export function emailLocalPart(email: string): string {
  return email.split('@')[0] ?? email
}

export type IdentityHints = {
  /** Nome completo vindo do provedor de auth (Google via WorkOS). */
  name?: string | null
  /** Primeiro nome, usado quando não há nome completo. */
  givenName?: string | null
  email?: string | null
}

export type DerivedIdentity = {
  username: string
  displayName: string
}

/**
 * Ordem de preferência EXPLÍCITA para o primeiro login:
 *   1. nome do provedor (`name`, senão `givenName`) — é o que a pessoa
 *      reconhece como "o meu nome";
 *   2. parte antes do "@" do e-mail;
 *   3. `usuario`.
 *
 * O `subject` do WorkOS não entra em lugar nenhum desta lista, de propósito:
 * ele é um identificador opaco de infraestrutura e foi exatamente o que
 * vazou para a tela. Um `username` truncado no limite de 32 continua sendo
 * aparado nas bordas para nunca terminar em separador.
 */
export function deriveIdentity(hints: IdentityHints): DerivedIdentity {
  const providerName = firstNonEmpty(hints.name, hints.givenName)
  const emailLocal = hints.email ? emailLocalPart(hints.email) : ''

  const rawSource = firstNonEmpty(providerName, emailLocal) ?? ''
  const slug = truncateUsername(slugifyUsername(rawSource))
  const username = slug.length >= USERNAME_MIN_LENGTH ? slug : USERNAME_FALLBACK

  const displayName = providerName
    ? clampDisplayName(providerName)
    : clampDisplayName(humanizeUsername(username))

  return { username, displayName }
}

function firstNonEmpty(...values: (string | null | undefined)[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}

function truncateUsername(slug: string): string {
  if (slug.length <= USERNAME_MAX_LENGTH) return slug
  // Cortar no limite pode deixar um separador na borda (`joao.silva.` ),
  // que a própria validação recusaria — apara de novo depois do corte.
  return slug.slice(0, USERNAME_MAX_LENGTH).replace(/[._-]+$/g, '')
}

function clampDisplayName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) return USERNAME_FALLBACK
  return trimmed.slice(0, DISPLAY_NAME_MAX_LENGTH).trim()
}

// ---------------------------------------------------------------------------
// Validação — as mensagens são EM PORTUGUÊS e escritas para o usuário final,
// porque é exatamente esse texto que a UI mostra (readableConvexError extrai
// a frase do embrulho do Convex; ver src/renderer/src/lib/convex-error.ts).
// ---------------------------------------------------------------------------

export type ValidationResult = { ok: true; value: string } | { ok: false; error: string }

/**
 * Valida e canoniza um username digitado. Aceita o que a pessoa escreveu com
 * maiúscula ou acento e devolve a forma canônica ("João" -> "joao") em vez de
 * recusar — recusar seria pedantismo, já que a canonização é determinística e
 * a UI mostra o resultado. Recusa mesmo é o que não sobrevive à canonização
 * (curto demais, longo demais, ou sem nenhum caractere aproveitável).
 */
export function validateUsername(input: string): ValidationResult {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return { ok: false, error: 'Escolha um nome de usuário' }
  }

  const canonical = slugifyUsername(trimmed)
  if (canonical.length === 0) {
    return {
      ok: false,
      error: 'O nome de usuário precisa ter letras ou números'
    }
  }
  if (canonical.length < USERNAME_MIN_LENGTH) {
    return {
      ok: false,
      error: `O nome de usuário precisa ter ao menos ${USERNAME_MIN_LENGTH} caracteres`
    }
  }
  if (canonical.length > USERNAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `O nome de usuário pode ter no máximo ${USERNAME_MAX_LENGTH} caracteres`
    }
  }
  // Redundante depois de slugifyUsername, e mantido de propósito: é a rede de
  // segurança para o dia em que alguém chamar validateUsername com um valor
  // que veio pronto de outro caminho, sem passar pela canonização.
  if (!USERNAME_ALLOWED.test(canonical) || !USERNAME_EDGES.test(canonical)) {
    return {
      ok: false,
      error: 'O nome de usuário só aceita letras, números, ponto, hífen e sublinhado'
    }
  }

  return { ok: true, value: canonical }
}

/** A tag é escolhida à mão no diálogo de edição: exatamente 4 dígitos. */
export function validateTag(input: string): ValidationResult {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return { ok: false, error: 'Escolha uma tag' }
  }
  if (!TAG_PATTERN.test(trimmed)) {
    return { ok: false, error: 'A tag precisa ter exatamente 4 dígitos (ex: 0001)' }
  }
  return { ok: true, value: trimmed }
}

/** `displayName` é livre: acento, espaço e maiúscula são bem-vindos. */
export function validateDisplayName(input: string): ValidationResult {
  const trimmed = input.trim()
  if (trimmed.length < DISPLAY_NAME_MIN_LENGTH) {
    return { ok: false, error: 'Escolha um nome de exibição' }
  }
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `O nome de exibição pode ter no máximo ${DISPLAY_NAME_MAX_LENGTH} caracteres`
    }
  }
  return { ok: true, value: trimmed }
}

/** Texto único do erro de colisão, para servidor e UI nunca divergirem. */
export function usernameTakenError(username: string, tag: string): string {
  return `${username}#${tag} já está em uso. Escolha outro nome ou outra tag.`
}
