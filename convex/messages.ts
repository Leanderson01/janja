import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import { mutation, query } from './_generated/server'
import { requireChannelMembership } from './lib/membership'

// CHAT-01/CHAT-02/CHAT-03 no nível de dados: mensagens de canal (tabela `messages`,
// separada de `dmMessages` da Fase 6 por design — ver 05-RESEARCH.md §1).
//
// CHAT-10 (anexos) entrou no v1 pela decisão de 2026-08-19 e vive aqui, no mesmo
// módulo da mensagem, porque um anexo é parte da mensagem — não uma entidade
// própria. Anexo em DM está fora de escopo por decisão: `dmMessages` é outra
// tabela e dobraria schema, mutation e UI.

/**
 * Teto de 25 MB por arquivo.
 *
 * Escolhido por ser o mesmo teto do Discord gratuito — o grupo já conhece esse
 * número, então "não passou" não vira surpresa — e por ser grande o bastante
 * para print, log e clipe curto, que é o uso real do grupo.
 *
 * Custo conhecido e ACEITO (registrado no SUMMARY como risco): o plano gratuito
 * do Convex tem cota finita de file storage. Vinte pessoas mandando vídeo de
 * 25 MB consomem essa cota rápido. Não há cota por usuário nem expurgo
 * automático nesta fase — isso seria feature nova, não anexo.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/**
 * Cinco anexos por mensagem. O limite existe para dar teto ao custo de leitura:
 * `listMessages` chama `storage.getUrl` uma vez por anexo, por mensagem, por
 * página do histórico.
 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5

/**
 * CHAT-10: URL de upload de curta duração, emitida SÓ para membro do canal.
 *
 * O `channelId` não é usado para nada além de autorizar, e é por isso que ele
 * existe: sem ele, qualquer usuário autenticado — inclusive quem não é membro
 * de servidor nenhum — conseguiria uma URL e gravaria arquivo no storage do
 * projeto. É SRV-06 ("não-membro não aprende nem escreve nada") aplicado ao
 * storage, e a checagem acontece ANTES de o arquivo existir, não depois.
 *
 * O cliente faz POST do arquivo nessa URL e recebe `{ storageId }`; esse
 * `storageId` só vira linha no banco quando passar pelas validações de
 * `sendMessage`. Arquivo cujo `sendMessage` nunca acontece fica órfão no
 * storage — conhecido, sem coleta automática nesta fase.
 */
export const generateUploadUrl = mutation({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const { channel } = await requireChannelMembership(ctx, channelId)

    if (channel.type !== 'text') {
      throw new Error('Não é possível anexar arquivo em um canal de voz')
    }

    return ctx.storage.generateUploadUrl()
  }
})

export const sendMessage = mutation({
  args: { channelId: v.id('channels'), content: v.string() },
  handler: async (ctx, { channelId, content }) => {
    const { channel, user } = await requireChannelMembership(ctx, channelId)

    if (channel.type !== 'text') {
      throw new Error('Não é possível enviar mensagem em um canal de voz')
    }

    const trimmed = content.trim()
    if (trimmed.length < 1 || trimmed.length > 2000) {
      throw new Error('Mensagem deve ter entre 1 e 2000 caracteres')
    }

    return ctx.db.insert('messages', {
      channelId,
      authorId: user._id,
      content: trimmed,
      createdAt: Date.now()
    })
  }
})

// CHAT-03 no nível de dados: histórico paginado, mais nova primeiro. Nunca .collect()
// do canal inteiro — sempre withIndex('by_channel') + .paginate(). Enriquece cada
// mensagem com o autor (mesmo padrão de Promise.all que members.ts:listServerMembers
// já usa) e com isMine, computado sem consulta extra a partir do `user` já resolvido
// pela checagem de autorização.
export const listMessages = query({
  args: { channelId: v.id('channels'), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { channelId, paginationOpts }) => {
    const { user } = await requireChannelMembership(ctx, channelId)

    const result = await ctx.db
      .query('messages')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .order('desc')
      .paginate(paginationOpts)

    const page = await Promise.all(
      result.page.map(async (message) => {
        const author = await ctx.db.get(message.authorId)

        return {
          _id: message._id,
          channelId: message.channelId,
          content: message.content,
          createdAt: message.createdAt,
          isMine: message.authorId === user._id,
          author: author
            ? {
                userId: author._id,
                username: author.username,
                tag: author.tag,
                displayName: author.displayName,
                avatarUrl: author.avatarUrl
              }
            : null
        }
      })
    )

    return { ...result, page }
  }
})
