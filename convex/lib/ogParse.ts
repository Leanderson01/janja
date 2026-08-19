/**
 * Extração de metadata de prévia de link a partir de HTML — pura, sem rede e
 * sem dependência nova.
 *
 * **Por que regex própria e não cheerio/jsdom/node-html-parser:** lição nº 1 do
 * HANDOFF.md. O spike da Fase 7 "provou" sob vitest que uma lib rodava no
 * runtime do Convex e o deploy real falhou, porque o `edge-runtime` do vitest
 * resolve módulos que o bundler do Convex não resolve. Como o push do Convex é
 * impossível nesta máquina, uma dependência nova aqui só seria descoberta como
 * quebrada no primeiro deploy do usuário. Código próprio, sem import nenhum,
 * não dá ao bundler nada novo em que engasgar.
 *
 * O preço dessa escolha é conhecido e aceito: regex não é parser de HTML. Ela
 * erra em casos patológicos (uma `<meta>` dentro de um comentário, atributo com
 * `>` literal sem escape). O custo de errar aqui é uma prévia sem título — não
 * é corrupção de dado, não é falha de segurança, e o `imageUrl` extraído ainda
 * passa por validação de esquema antes de ser gravado.
 *
 * Esta função NUNCA lança: HTML malformado devolve o que der para extrair, e no
 * pior caso um objeto vazio. Quem chama (a action de `linkPreviews.ts`) trata
 * "sem título" como cache de falha, não como exceção.
 */

export type OgPreview = {
  title?: string
  description?: string
  imageUrl?: string
  siteName?: string
}

/** Teto de HTML examinado. O `<head>` de qualquer página real cabe MUITO abaixo
 * disso; o resto do documento não tem metadata e só custaria CPU do Convex. É a
 * segunda barreira de tamanho — a primeira é o corte do corpo da resposta na
 * action, antes mesmo de chamar esta função. */
export const MAX_HTML_SCAN_CHARS = 100 * 1024

const MAX_TITLE_CHARS = 200
const MAX_DESCRIPTION_CHARS = 300

/** Só as cinco entidades que o serializador de HTML é obrigado a escapar. Não é
 * uma tabela completa de entidades de propósito: título de página raramente tem
 * outras, e uma tabela grande seria peso morto no bundle. Entidade não
 * reconhecida fica literal na string, que é degradação visível e inofensiva. */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

function decodeEntities(text: string): string {
  // `&amp;` é resolvido por último de propósito: resolvê-lo antes transformaria
  // `&amp;lt;` (um `&lt;` literal escapado) em `<`, que é justamente o erro que
  // o duplo escape existe para evitar.
  let out = text
  for (const entity of ['&lt;', '&gt;', '&quot;', '&#39;', '&apos;', '&nbsp;']) {
    out = out.split(entity).join(ENTITIES[entity])
  }
  return out.split('&amp;').join('&')
}

function clean(raw: string | undefined, maxChars: number): string | undefined {
  if (raw === undefined) return undefined
  const collapsed = decodeEntities(raw).replace(/\s+/g, ' ').trim()
  if (collapsed.length === 0) return undefined
  return collapsed.length > maxChars ? collapsed.slice(0, maxChars) : collapsed
}

/** Lê os atributos de uma tag já isolada. Aceita valor entre aspas duplas,
 * simples ou sem aspas, e devolve as chaves em minúsculas — HTML não distingue
 * caixa em nome de atributo, e `<meta PROPERTY="og:title">` é válido. */
function attributesOf(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g
  let match: RegExpExecArray | null
  while ((match = re.exec(tag)) !== null) {
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    attrs[match[1].toLowerCase()] = value
  }
  return attrs
}

/**
 * Indexa TODAS as `<meta>` do trecho de uma vez, em vez de rodar uma regex por
 * campo procurado.
 *
 * Isso é o que resolve o erro clássico de regex de meta tag — a que assume
 * `property` ANTES de `content` e falha silenciosamente em
 * `<meta content="..." property="og:title">`, que é ordem igualmente válida e
 * comum (o Next.js emite nessa ordem). Aqui a ordem dos atributos não importa,
 * porque a tag é lida inteira antes de qualquer decisão.
 */
function indexMetaTags(head: string): Map<string, string> {
  const byKey = new Map<string, string>()
  const tagRe = /<meta\b[^>]*>/gi
  let tag: RegExpExecArray | null
  while ((tag = tagRe.exec(head)) !== null) {
    const attrs = attributesOf(tag[0])
    const content = attrs.content
    if (content === undefined) continue
    // `property` é o atributo do Open Graph; `name` é o do HTML clássico
    // (`description`). Alguns sites emitem og com `name` — os dois entram.
    for (const keyAttr of ['property', 'name'] as const) {
      const key = attrs[keyAttr]
      if (key === undefined) continue
      const normalized = key.trim().toLowerCase()
      if (normalized.length > 0 && !byKey.has(normalized)) byKey.set(normalized, content)
    }
  }
  return byKey
}

/** Primeira das chaves que existir e tiver conteúdo útil. A ordem do array É a
 * ordem de preferência. */
function firstOf(meta: Map<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = meta.get(key)
    if (value !== undefined && value.trim().length > 0) return value
  }
  return undefined
}

/**
 * Resolve a URL da imagem contra a URL da página (og:image relativa é comum) e
 * DESCARTA qualquer coisa que não termine em `http`/`https`.
 *
 * O descarte não é preciosismo: essa string vai para o cache, o cliente a
 * coloca num `<img src>`, e o cliente é um Electron. `javascript:` e `data:`
 * saindo de um site de terceiro direto para dentro do renderer é exatamente o
 * caminho que não pode existir.
 */
function resolveImage(raw: string | undefined, baseUrl: string): string | undefined {
  if (raw === undefined) return undefined
  const candidate = raw.trim()
  if (candidate.length === 0) return undefined
  try {
    const resolved = new URL(decodeEntities(candidate), baseUrl)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined
    return resolved.toString()
  } catch {
    return undefined
  }
}

export function parseOpenGraph(html: string, baseUrl: string): OgPreview {
  try {
    const scanned = html.length > MAX_HTML_SCAN_CHARS ? html.slice(0, MAX_HTML_SCAN_CHARS) : html
    const headEnd = scanned.search(/<\/head\s*>/i)
    const head = headEnd === -1 ? scanned : scanned.slice(0, headEnd)

    const meta = indexMetaTags(head)

    const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)
    const title = clean(
      firstOf(meta, ['og:title', 'twitter:title']) ?? titleTag?.[1],
      MAX_TITLE_CHARS
    )

    const description = clean(
      firstOf(meta, ['og:description', 'description', 'twitter:description']),
      MAX_DESCRIPTION_CHARS
    )

    const imageUrl = resolveImage(firstOf(meta, ['og:image', 'twitter:image']), baseUrl)

    let siteName = clean(firstOf(meta, ['og:site_name']), MAX_TITLE_CHARS)
    if (siteName === undefined) {
      try {
        siteName = new URL(baseUrl).hostname || undefined
      } catch {
        siteName = undefined
      }
    }

    const preview: OgPreview = {}
    if (title !== undefined) preview.title = title
    if (description !== undefined) preview.description = description
    if (imageUrl !== undefined) preview.imageUrl = imageUrl
    if (siteName !== undefined) preview.siteName = siteName
    return preview
  } catch {
    // Contrato do módulo: nunca lançar. Se uma regex explodir num HTML
    // patológico, a prévia some — a leitura do canal não pode quebrar por causa
    // do HTML de um site de terceiro.
    return {}
  }
}
