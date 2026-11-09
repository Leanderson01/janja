/** A faixa “ir para o presente” aparece lendo coisa antiga OU com mensagem nova abaixo. */
export function shouldShowJumpBar(p: { isViewingOld: boolean; newMessageCount: number }): boolean {
  return p.isViewingOld || p.newMessageCount > 0
}
