// Geração e checagem de disponibilidade de tag de 4 dígitos (AUTH-06).
//
// Convex não tem constraint de unicidade nativa (02-RESEARCH.md §5) — o par
// (username, tag) só é único porque `findAvailableTag` sorteia até achar um
// par livre segundo `existsFn`, injetado por quem chama (a mutation
// `ensureUser`, que consulta o índice `by_username_tag`). Este arquivo é
// puro: nenhuma dependência de Convex, testável isoladamente.

const TAG_DIGITS = 4
export const TAG_DEFAULT_MAX_ATTEMPTS = 10

/**
 * Retorna uma string de 4 dígitos, com zero à esquerda quando necessário
 * ("0000" a "9999").
 */
export function generateFourDigitTag(): string {
  const max = 10 ** TAG_DIGITS
  const n = Math.floor(Math.random() * max)
  return n.toString().padStart(TAG_DIGITS, '0')
}

export type FindAvailableTagOptions = {
  /** Reporta se um candidato de tag já está em uso. */
  existsFn: (candidate: string) => Promise<boolean> | boolean
  /** Gerador de candidatos, injetável para testes determinísticos. */
  generateTag?: () => string
  /** Número máximo de tentativas antes de desistir. */
  maxAttempts?: number
}

/**
 * Tenta até `maxAttempts` vezes achar uma tag para a qual `existsFn`
 * retorna `false`. Lança um erro explícito ao esgotar as tentativas — nunca
 * retorna um candidato ainda não confirmado como livre.
 */
export async function findAvailableTag(options: FindAvailableTagOptions): Promise<string> {
  const generateTag = options.generateTag ?? generateFourDigitTag
  const maxAttempts = options.maxAttempts ?? TAG_DEFAULT_MAX_ATTEMPTS

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = generateTag()
    const taken = await options.existsFn(candidate)
    if (!taken) {
      return candidate
    }
  }

  throw new Error(`Não foi possível gerar uma tag única após ${maxAttempts} tentativas`)
}
