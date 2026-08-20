// Limites de anexo (CHAT-10), num módulo SEM NENHUM IMPORT — de propósito.
//
// Este arquivo existe por causa de um defeito real, encontrado em uso: o
// renderer importava estas constantes de `convex/messages.ts`, que importa
// `convex/server` e `./_generated/server`. O bundler segue o import e arrasta o
// runtime de SERVIDOR do Convex para dentro do app, e esse runtime usa `process`,
// que não existe no renderer do Electron. O sintoma não é erro de build — é o app
// não abrir:
//
//     Uncaught ReferenceError: process is not defined  (server.js:101)
//
// `npm run build` passava, `npm run typecheck` passava, 480 testes passavam. Só
// abrir o app mostrava. É a lição nº 2 do HANDOFF com nome e sobrenome: build
// verde não significa app funcionando.
//
// Regra que este arquivo carrega: qualquer valor compartilhado entre `convex/` e
// `src/renderer/` mora num módulo folha, sem import nenhum. Um único import de
// `convex/server` em qualquer arquivo desta cadeia traz o defeito de volta.
//
// Os limites são aplicados no SERVIDOR (`convex/messages.ts`), sobre o tamanho
// real lido do storage. O cliente usa os mesmos números só para recusar cedo e
// explicar o motivo — se o cliente mentisse, o servidor continuaria recusando.

/** 25 MB: mesmo teto do Discord gratuito — número que o grupo já conhece, e
 * suficiente para print, log e clipe curto. Fronteira INCLUSIVA: 25 MB exatos
 * passam, 25 MB + 1 byte é recusado. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/** Teto de anexos por mensagem. Limita o custo de gerar uma URL por anexo, por
 * mensagem, por página do histórico. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5
