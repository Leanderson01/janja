import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from '../../../../convex/messages'

// CHAT-10 — as regras de anexo do LADO DO CLIENTE, isoladas em funções puras
// (sem DOM, sem rede) para serem testáveis no ambiente `edge-runtime` padrão.
//
// Estas checagens existem para POUPAR UPLOAD INÚTIL, não para decidir. Quem
// decide é `convex/messages.ts:sendMessage`, que lê o tamanho real do
// `_storage` — o cliente nem manda `size`, justamente para o limite não ser
// contornável com `size: 1` (08.5-13-SUMMARY.md). Se estas funções tivessem um
// bug e deixassem passar um arquivo de 30 MB, o servidor recusaria mesmo assim;
// o usuário só teria esperado o upload à toa.

// Os dois limites vêm do módulo do Convex, NÃO são redeclarados aqui.
//
// O plano previa que este import pudesse não atravessar (o renderer importa de
// `convex/_generated`, não do código de servidor) e autorizava duplicar os
// números com um comentário. Não foi preciso: `tsconfig.web.json` resolve o
// caminho relativo e o bundler do renderer aceita. Limite duplicado em silêncio
// é exatamente como cliente e servidor passam a discordar — se um dia este
// import quebrar, o typecheck cai, que é o resultado certo.
export { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE }

const MAX_ATTACHMENT_MB = Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))

/** Por que um arquivo escolhido não entrou na lista. */
export type RejectionReason = 'too-large' | 'too-many'

export type RejectedFile = {
  name: string
  reason: RejectionReason
  /** Frase pronta para o toast, em pt-BR. */
  message: string
}

export type ValidationResult<T> = {
  accepted: T[]
  rejected: RejectedFile[]
}

const decimalFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

/**
 * Tamanho legível em pt-BR: `1234567` → `"1,2 MB"`.
 *
 * Vírgula decimal e não ponto: o app é do grupo, em português. `Intl` cuida
 * disso e também remove a casa decimal inútil (`1,0 MB` vira `1 MB`).
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`
  if (bytes < 1024 * 1024) return `${decimalFormatter.format(bytes / 1024)} KB`
  return `${decimalFormatter.format(bytes / (1024 * 1024))} MB`
}

/**
 * Filtra os arquivos escolhidos ANTES de qualquer upload.
 *
 * `alreadySelected` é quantos já estão na lista do composer — sem esse número,
 * escolher 3 arquivos duas vezes passaria dos 5 sem ninguém notar.
 *
 * O teto de tamanho é INCLUSIVO (`size > MAX` recusa), igual ao do servidor:
 * exatamente 25 MB passa, 25 MB + 1 byte não.
 *
 * Tamanho é conferido ANTES da contagem de propósito: um arquivo grande demais
 * não deve consumir uma das 5 vagas antes de ser recusado.
 */
export function validateFiles<T extends { name: string; size: number }>(
  files: T[],
  alreadySelected: number
): ValidationResult<T> {
  const accepted: T[] = []
  const rejected: RejectedFile[] = []

  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      rejected.push({
        name: file.name,
        reason: 'too-large',
        message: `acima do limite de ${MAX_ATTACHMENT_MB} MB (${formatBytes(file.size)})`
      })
      continue
    }

    if (alreadySelected + accepted.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
      rejected.push({
        name: file.name,
        reason: 'too-many',
        message: `máximo de ${MAX_ATTACHMENTS_PER_MESSAGE} anexos por mensagem`
      })
      continue
    }

    accepted.push(file)
  }

  return { accepted, rejected }
}

/**
 * O anexo deve ser mostrado embutido como imagem?
 *
 * `image/svg+xml` fica DE FORA e cai no cartão genérico. SVG não é imagem: é
 * documento executável, com `<script>` e handlers de evento. Renderizar inline
 * um SVG vindo de arquivo de terceiro é vetor de XSS mesmo dentro da CSP deste
 * app — e o custo de excluí-lo é o usuário ter que clicar para abrir um formato
 * que ninguém deste grupo manda no chat. Não "consertar" isto.
 *
 * `contentType` é `string | undefined` porque o storage do Convex pode não ter
 * preenchido (o upload não mandou `Content-Type`); nesse caso, cartão genérico.
 */
export function isImage(contentType: string | undefined): boolean {
  if (!contentType) return false
  // `image/png; charset=binary` — o parâmetro depois do `;` faz parte do
  // cabeçalho e não do tipo.
  const mime = contentType.split(';')[0].trim().toLowerCase()
  if (mime === 'image/svg+xml') return false
  return mime.startsWith('image/')
}
