// Geração e checagem de disponibilidade de código de convite de servidor
// (SRV-02). Convex não tem constraint de unicidade nativa (02-RESEARCH.md
// §5, reconfirmado em 04-RESEARCH.md §5) — a unicidade do código é 100%
// responsabilidade de `findAvailableInviteCode`, que sorteia até achar um
// candidato livre segundo `existsFn`, injetado por quem chama (a mutation
// `generateInvite`, que consulta o índice `by_code`). Este arquivo é puro:
// nenhuma dependência de Convex, testável isoladamente.

const CODE_LENGTH = 8

// Alfabeto sem ambiguidade visual: sem 0/O, sem 1/I/L (04-RESEARCH.md §5,
// 04-02-PLAN.md).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const INVITE_CODE_DEFAULT_MAX_ATTEMPTS = 10

/**
 * Retorna uma string de 8 caracteres do alfabeto sem ambiguidade visual.
 * Math.random() é seguro dentro de mutations do Convex — gerador seeded,
 * determinístico entre retries de OCC (04-RESEARCH.md §4).
 */
export function generateInviteCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    const index = Math.floor(Math.random() * ALPHABET.length)
    code += ALPHABET[index]
  }
  return code
}

export type FindAvailableInviteCodeOptions = {
  /** Reporta se um candidato de código já está em uso. */
  existsFn: (candidate: string) => Promise<boolean> | boolean
  /** Gerador de candidatos, injetável para testes determinísticos. */
  generateCode?: () => string
  /** Número máximo de tentativas antes de desistir. */
  maxAttempts?: number
}

/**
 * Tenta até `maxAttempts` vezes achar um código para o qual `existsFn`
 * retorna `false`. Lança um erro explícito ao esgotar as tentativas — nunca
 * retorna um candidato ainda não confirmado como livre. Mesmo padrão de
 * `convex/lib/tag.ts` (`findAvailableTag`, plano 02-05).
 */
export async function findAvailableInviteCode(
  options: FindAvailableInviteCodeOptions
): Promise<string> {
  const generateCode = options.generateCode ?? generateInviteCode
  const maxAttempts = options.maxAttempts ?? INVITE_CODE_DEFAULT_MAX_ATTEMPTS

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = generateCode()
    const taken = await options.existsFn(candidate)
    if (!taken) {
      return candidate
    }
  }

  throw new Error(`Não foi possível gerar um código de convite único após ${maxAttempts} tentativas`)
}
