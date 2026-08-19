/**
 * Prévias de link — a metade de servidor.
 *
 * ## Quem busca a metadata: o Convex, nunca o cliente
 *
 * Decisão de privacidade tomada no planejamento (08.5-CONTEXT.md e
 * 08.5-15-PLAN.md), escrita aqui para não ser desfeita por conveniência:
 *
 * - **Cliente de quem LÊ** (o caminho mais fácil, e por isso o que precisa ser
 *   recusado explicitamente): cada pessoa que abre o canal faria uma requisição
 *   ao site linkado. Um link postado num canal de 10 pessoas entregaria o IP das
 *   10 ao dono daquele site, toda vez que alguém rolasse o histórico.
 * - **Cliente de quem ENVIA**: vaza só um IP, mas o resultado não serve para os
 *   outros sem um lugar compartilhado, e coloca trabalho de rede no caminho de
 *   ENVIO, que é o que precisa ser rápido.
 * - **`action` do Convex** (escolhido): o IP que chega ao site é o do Convex. O
 *   resultado vira cache compartilhado — o segundo leitor não dispara requisição
 *   nenhuma.
 *
 * Custos aceitos e tratados aqui: a prévia aparece um instante DEPOIS da
 * mensagem (nunca antes — buscar prévia não atrasa o envio), e site lento, fora
 * do ar ou hostil vira estado gravado (`status: 'failed'`), nunca exceção solta
 * na tela de quem lê.
 *
 * `action` é a única forma correta de fazer `fetch` para fora no Convex: `query`
 * e `mutation` são transacionais e não fazem rede. A action não grava direto no
 * banco — chama a `internalMutation` daqui, mesmo padrão de `voiceToken.ts`.
 *
 * Este arquivo NÃO tem `"use node"`: só usa `fetch`, `URL`, `TextDecoder` e
 * `AbortSignal`, todos globais do runtime padrão do Convex, e não importa
 * nenhuma dependência externa (ver o cabeçalho de `lib/ogParse.ts` para o
 * porquê — lição nº 1 do HANDOFF.md).
 */

import { v } from 'convex/values'
import { action, internalMutation, internalQuery, query } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { requireIdentity } from './lib/membership'
import { parseOpenGraph } from './lib/ogParse'

/** Sete dias. Título de página muda pouco, e o valor deste cache é justamente
 * não repetir a requisição — TTL curto devolveria ao site linkado o tráfego que
 * o cache existe para evitar. Vale para sucesso E para falha: um site fora do ar
 * não pode ser re-sondado a cada render de cada cliente. */
export const PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** O que impede um site lento (ou que nunca responde) de segurar um recurso do
 * Convex indefinidamente. */
export const FETCH_TIMEOUT_MS = 5000

/** Teto de HTML efetivamente lido do corpo da resposta. O `<head>` de qualquer
 * página real cabe muito abaixo disso. */
export const MAX_HTML_BYTES = 100 * 1024

/** Recusa antecipada pelo header: se o site ANUNCIA mais de 1 MB, nem começamos
 * a ler. Não substitui o teto acima — `content-length` pode estar ausente numa
 * resposta em chunks, e aí quem segura é o `MAX_HTML_BYTES` na leitura. */
export const MAX_CONTENT_LENGTH_BYTES = 1024 * 1024

// ---------------------------------------------------------------------------
// Guardas de destino (SSRF)
// ---------------------------------------------------------------------------

function isBlockedIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return false
  const [a, b] = [Number(match[1]), Number(match[2])]
  const octets = [a, b, Number(match[3]), Number(match[4])]
  if (octets.some((o) => o > 255)) return true // nem é IP válido: recusa

  if (a === 0) return true // 0.0.0.0/8 — alias de loopback em Linux
  if (a === 127) return true // 127.0.0.0/8
  if (a === 10) return true // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 169 && b === 254) return true // 169.254.0.0/16 (metadata de nuvem)
  return false
}

function isBlockedIpv6(host: string): boolean {
  const inner = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
  if (!inner.includes(':')) return false
  if (inner === '::1' || inner === '::') return true // loopback e não especificado

  // IPv4 mapeado. O `new URL` normaliza `::ffff:127.0.0.1` para `::ffff:7f00:1`,
  // então as duas formas precisam ser reconhecidas — senão a guarda de IPv4
  // acima é contornável só escrevendo o mesmo endereço em outra notação.
  const mapped = /^::ffff:(.+)$/.exec(inner)
  if (mapped) {
    const rest = mapped[1]
    if (rest.includes('.')) return isBlockedIpv4(rest)
    const groups = rest.split(':')
    if (groups.length === 2) {
      const high = Number.parseInt(groups[0], 16)
      const low = Number.parseInt(groups[1], 16)
      if (Number.isFinite(high) && Number.isFinite(low)) {
        const dotted = [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
        return isBlockedIpv4(dotted)
      }
    }
  }

  const firstGroup = inner.split(':')[0]
  if (/^f[cd]/.test(firstGroup)) return true // fc00::/7 — unique local
  if (/^fe[89ab]/.test(firstGroup)) return true // fe80::/10 — link local
  return false
}

/**
 * Recusa destinos que não deveriam ser alcançáveis a partir da infraestrutura do
 * Convex.
 *
 * Sem esta checagem, qualquer usuário do janja poderia mandar o SERVIDOR buscar
 * `http://localhost/...`, `http://169.254.169.254/...` (endpoint de metadata de
 * nuvem) ou varrer faixas privadas, usando a mensagem de chat como painel de
 * controle. É a guarda que mais importa neste arquivo.
 *
 * **Limitação conhecida, registrada de propósito:** isto bloqueia o caso
 * LITERAL — hostname especial ou IP privado escrito na URL. NÃO bloqueia um
 * domínio público que RESOLVE para IP privado (rebind por DNS), nem um redirect
 * de um host público para um privado (`redirect: 'follow'` não passa por aqui a
 * cada salto). Fechar os dois exigiria controlar a resolução de nomes e cada
 * salto do redirect, coisas que o `fetch` não expõe. O risco residual é ser
 * usado como sonda cega da rede interna do Convex: quem monta o ataque não vê o
 * corpo da resposta, só o título extraído — e só se a página tiver `<title>`.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (host.length === 0) return true

  if (isBlockedIpv6(host)) return true
  if (isBlockedIpv4(host)) return true

  if (host === 'localhost') return true
  if (host === 'metadata.google.internal') return true
  for (const suffix of ['.localhost', '.local', '.internal', '.home.arpa']) {
    if (host.endsWith(suffix)) return true
  }

  // Nome de rótulo único (`http://intranet/`): na internet pública isso não
  // resolve para nada; numa rede interna, resolve para a própria rede. Não há
  // caso legítimo de link de chat apontando para um deles.
  //
  // A exceção do `:` não é detalhe: um literal IPv6 (`[2606:4700::1111]`) não
  // tem ponto nenhum, e sem esta ressalva TODO endereço IPv6 público cairia
  // nesta regra — uma guarda que bloqueia meia internet não é guarda, é bug.
  // Quem julga IPv6 é `isBlockedIpv6`, acima.
  if (!host.includes('.') && !host.includes(':')) return true

  return false
}

// ---------------------------------------------------------------------------
// Leitura do cache
// ---------------------------------------------------------------------------

/**
 * Leitura pública do cache. NÃO busca nada — é `query`, não faz rede. O cliente
 * usa isto para renderizar e para decidir se precisa disparar a action.
 *
 * Exige autenticação: prévia é conteúdo derivado de mensagem, e um cliente sem
 * sessão não tem por que enumerar quais links já foram postados no grupo.
 *
 * Usa `first()` e não `unique()` de propósito: `unique()` LANÇA quando encontra
 * duas linhas, e uma leitura de tela não pode virar erro por causa de uma
 * duplicata hipotética. `cachePreview` faz leitura e escrita na mesma
 * transação, então duplicata não deveria existir — "não deveria" não é motivo
 * para quebrar o histórico se existir.
 */
export const getPreview = query({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<Doc<'linkPreviews'> | null> => {
    await requireIdentity(ctx)
    return await ctx.db
      .query('linkPreviews')
      .withIndex('by_url', (q) => q.eq('url', url))
      .first()
  },
})

/** Mesma leitura, sem exigir identidade — para a action consultar o cache antes
 * de tocar na rede. Separada da pública para que o caminho interno não dependa
 * de propagação de identidade entre action e query. */
export const getCachedPreview = internalQuery({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<Doc<'linkPreviews'> | null> => {
    return await ctx.db
      .query('linkPreviews')
      .withIndex('by_url', (q) => q.eq('url', url))
      .first()
  },
})

/** Grava ou atualiza a linha de cache. Chamada só pela action — é
 * `internalMutation`, então nenhum cliente consegue escrever prévia arbitrária
 * (o que seria uma forma barata de injetar título e imagem falsos numa
 * mensagem de outra pessoa). */
export const cachePreview = internalMutation({
  args: {
    url: v.string(),
    status: v.union(v.literal('ok'), v.literal('failed')),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    siteName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query('linkPreviews')
      .withIndex('by_url', (q) => q.eq('url', args.url))
      .first()

    const row = {
      url: args.url,
      status: args.status,
      title: args.title,
      description: args.description,
      imageUrl: args.imageUrl,
      siteName: args.siteName,
      fetchedAt: Date.now(),
    }

    if (existing) {
      // `patch` com os campos undefined explícitos: uma tentativa que agora
      // falhou precisa APAGAR o título antigo, senão a linha vira uma mistura de
      // duas buscas diferentes.
      await ctx.db.patch(existing._id, row)
    } else {
      await ctx.db.insert('linkPreviews', row)
    }
    return null
  },
})

// ---------------------------------------------------------------------------
// A busca
// ---------------------------------------------------------------------------

/**
 * Lê o corpo da resposta com teto de bytes, em vez de `res.text()` seguido de
 * corte. `res.text()` leria a resposta INTEIRA na memória antes de cortar — um
 * site hostil sem `content-length` poderia despejar centenas de MB dentro dos 5
 * segundos de timeout. Aqui a leitura para no teto e o resto nunca chega.
 *
 * Fallback para `res.text()` quando `res.body` não é um stream legível (não
 * acontece no runtime do Convex nem sob o vitest, mas o tipo permite `null`).
 */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const body = res.body
  if (!body) return (await res.text()).slice(0, maxBytes)

  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let read = 0
  let html = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      read += value.byteLength
      html += decoder.decode(value, { stream: true })
      if (read >= maxBytes) break
    }
  } finally {
    // Não esperar o cancel: se o servidor não cooperar, o `await` aqui
    // seguraria a action justamente no caminho que existe para não segurar nada.
    void reader.cancel().catch(() => {})
  }
  return html.slice(0, maxBytes)
}

/**
 * Busca a metadata de um link e grava o resultado no cache. Sempre devolve
 * `null`: quem lê o resultado é a `query` reativa `getPreview`, não o retorno
 * desta chamada — assim o segundo cliente que abrir o canal já encontra a linha
 * pronta sem chamar nada.
 *
 * Sucesso e falha são os DOIS gravados. Nenhum caminho aqui deixa uma promise
 * rejeitada chegar ao cliente: site quebrado não pode virar erro na tela de quem
 * está lendo a conversa.
 */
export const fetchPreview = action({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<null> => {
    // Sem esta checagem, o deployment seria um buscador de URLs aberto ao mundo
    // — qualquer um com o endereço do Convex poderia usá-lo como proxy anônimo.
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Não autenticado')

    const fail = async (): Promise<null> => {
      await ctx.runMutation(internal.linkPreviews.cachePreview, { url, status: 'failed' })
      return null
    }

    try {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return await fail()
      }

      // Só http/https. `javascript:`, `data:` e `file:` nunca chegam ao fetch.
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return await fail()

      // Recusa de destino privado não lança: é entrada de usuário, não defeito
      // do sistema. Gravar `failed` também garante que a mesma URL recusada não
      // seja reprocessada a cada render.
      if (isBlockedHost(parsed.hostname)) return await fail()

      const cached = await ctx.runQuery(internal.linkPreviews.getCachedPreview, { url })
      if (cached && Date.now() - cached.fetchedAt < PREVIEW_TTL_MS) return null

      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
        headers: {
          'user-agent': 'janja-link-preview/1.0',
          accept: 'text/html',
        },
      })

      if (!res.ok) return await fail()

      const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
      const isHtml =
        contentType.includes('text/html') || contentType.includes('application/xhtml+xml')
      if (!isHtml) return await fail()

      const declaredLength = Number(res.headers.get('content-length'))
      if (Number.isFinite(declaredLength) && declaredLength > MAX_CONTENT_LENGTH_BYTES) {
        return await fail()
      }

      const html = await readCapped(res, MAX_HTML_BYTES)
      const preview = parseOpenGraph(html, url)

      // Sem título não há prévia que valha um cartão na tela — e gravar `ok`
      // vazio faria a UI renderizar uma caixa em branco. Vira falha em cache,
      // que é a resposta honesta: já tentamos, não há o que mostrar.
      if (!preview.title) return await fail()

      await ctx.runMutation(internal.linkPreviews.cachePreview, {
        url,
        status: 'ok',
        title: preview.title,
        description: preview.description,
        imageUrl: preview.imageUrl,
        siteName: preview.siteName,
      })
      return null
    } catch {
      // Timeout, DNS que não resolve, TLS inválido, corpo que morre no meio:
      // tudo vira a mesma coisa gravada. Se até a gravação da falha falhar (o
      // banco fora do ar), aí sim não há o que fazer — mas nem isso pode
      // rejeitar para o cliente.
      try {
        await ctx.runMutation(internal.linkPreviews.cachePreview, { url, status: 'failed' })
      } catch {
        // engolido de propósito: ver acima
      }
      return null
    }
  },
})
