import { convexTest } from 'convex-test'
import type { TestConvex } from 'convex-test'
import { anyApi } from 'convex/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { isBlockedHost, PREVIEW_TTL_MS } from './linkPreviews'
import type { Mock } from 'vitest'
import type { Doc, Id } from './_generated/dataModel'

/**
 * Testes da action de prévia de link.
 *
 * `fetch` é SEMPRE um stub (`vi.stubGlobal`) — nenhum teste deste repositório
 * toca a rede de verdade: um teste que depende de um site de terceiro falha
 * quando aquele site cai, e passaria a medir a internet em vez do código.
 *
 * **O que estes testes provam:** a lógica de guarda (esquema, destino privado,
 * cache quente/frio/vencido, content-type, corpo grande), que a action nunca
 * rejeita por causa do site, e que sucesso e falha viram linha no banco.
 *
 * **O que eles NÃO provam** (só o `npx convex dev` no Windows fecha — lição nº 1
 * do HANDOFF.md): que o bundler do Convex aceita este módulo, que o `fetch`
 * real do runtime do Convex se comporta como o do `edge-runtime`, e que
 * `AbortSignal.timeout` aborta uma conexão lenta de verdade. O timeout aqui é
 * exercitado por um stub que REJEITA, que é a consequência observável, não pelo
 * relógio.
 */

const modules = import.meta.glob('./**/*.ts')

const WORKOS_ID = 'workos_ana'

/** `TestConvex<typeof schema>` e não `ReturnType<typeof convexTest>`: sem o
 * schema no tipo, o `ctx.db` do `t.run` cai para o modelo genérico e
 * `withIndex('by_url')` nem compila (só os índices de sistema são conhecidos).
 * Os testes mais antigos escapam disso porque só usam `insert`, que aceita
 * qualquer coisa no modelo genérico. */
type T = TestConvex<typeof schema>

async function insertUser(t: T): Promise<Id<'users'>> {
  return t.run((ctx) =>
    ctx.db.insert('users', {
      workosId: WORKOS_ID,
      username: 'ana',
      tag: '0001',
      displayName: 'Ana',
    })
  )
}

async function readCache(t: T, url: string): Promise<Doc<'linkPreviews'> | null> {
  return t.run((ctx) =>
    ctx.db
      .query('linkPreviews')
      .withIndex('by_url', (q) => q.eq('url', url))
      .first()
  )
}

function htmlResponse(html: string, contentType = 'text/html; charset=utf-8'): Response {
  return new Response(html, { status: 200, headers: { 'content-type': contentType } })
}

const PAGE = `<html><head>
  <title>Página de teste</title>
  <meta property="og:title" content="Título do site">
  <meta property="og:description" content="Descrição do site">
  <meta property="og:image" content="/capa.png">
</head><body></body></html>`

function stubFetch(impl: (input: unknown, init?: unknown) => Promise<Response>): Mock {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isBlockedHost', () => {
  test.each([
    'localhost',
    'LOCALHOST',
    'meu-mac.local',
    'metadata.google.internal',
    'intranet',
    '127.0.0.1',
    '127.9.9.9',
    '0.0.0.0',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.169.254',
    '[::1]',
    '::1',
    '[fc00::1]',
    '[fd12:3456::1]',
    '[fe80::1]',
    '[::ffff:127.0.0.1]',
    '[::ffff:7f00:1]',
  ])('bloqueia %s', (host) => {
    expect(isBlockedHost(host)).toBe(true)
  })

  test.each([
    'exemplo.com',
    'www.github.com',
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    '192.169.0.1',
    'localhost.exemplo.com',
    '[2606:4700:4700::1111]',
  ])('permite %s', (host) => {
    expect(isBlockedHost(host)).toBe(false)
  })
})

describe('fetchPreview — guardas antes da rede', () => {
  test.each(['ftp://exemplo.com/arquivo', 'javascript:alert(1)', 'nao é uma url'])(
    'esquema inválido (%s): grava failed e não chama fetch',
    async (url) => {
      const t = convexTest(schema, modules)
      const asAna = t.withIdentity({ subject: WORKOS_ID })
      const spy = stubFetch(async () => htmlResponse(PAGE))

      await asAna.action(anyApi.linkPreviews.fetchPreview, { url })

      expect(spy).not.toHaveBeenCalled()
      expect((await readCache(t, url))?.status).toBe('failed')
    }
  )

  test.each([
    'http://localhost:3000/algo',
    'http://192.168.0.1/roteador',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]:8080/',
    'http://10.0.0.5/',
  ])('destino privado (%s): grava failed e NÃO chama fetch', async (url) => {
    const t = convexTest(schema, modules)
    const asAna = t.withIdentity({ subject: WORKOS_ID })
    const spy = stubFetch(async () => htmlResponse(PAGE))

    await asAna.action(anyApi.linkPreviews.fetchPreview, { url })

    expect(spy).not.toHaveBeenCalled()
    expect((await readCache(t, url))?.status).toBe('failed')
  })

  test('sem autenticação a action recusa e não chama fetch', async () => {
    const t = convexTest(schema, modules)
    const spy = stubFetch(async () => htmlResponse(PAGE))

    await expect(
      t.action(anyApi.linkPreviews.fetchPreview, { url: 'https://exemplo.com/' })
    ).rejects.toThrow('Não autenticado')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('fetchPreview — cache', () => {
  test('cache frio: chama fetch uma vez e grava ok com os campos extraídos', async () => {
    const t = convexTest(schema, modules)
    const asAna = t.withIdentity({ subject: WORKOS_ID })
    const spy = stubFetch(async () => htmlResponse(PAGE))
    const url = 'https://exemplo.com/artigo'

    await asAna.action(anyApi.linkPreviews.fetchPreview, { url })

    expect(spy).toHaveBeenCalledTimes(1)
    const row = await readCache(t, url)
    expect(row).toMatchObject({
      status: 'ok',
      title: 'Título do site',
      description: 'Descrição do site',
      imageUrl: 'https://exemplo.com/capa.png',
      siteName: 'exemplo.com',
    })
    expect(row?.fetchedAt).toBeGreaterThan(0)
  })

  test('o fetch vai com timeout, user-agent e redirect declarados', async () => {
    const t = convexTest(schema, modules)
    const asAna = t.withIdentity({ subject: WORKOS_ID })
    const spy = stubFetch(async () => htmlResponse(PAGE))

    await asAna.action(anyApi.linkPreviews.fetchPreview, { url: 'https://exemplo.com/artigo' })

    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.redirect).toBe('follow')
    expect((init.headers as Record<string, string>)['user-agent']).toBe('janja-link-preview/1.0')
  })

  test('cache quente (sucesso recente): não chama fetch', async () => {
    const t = convexTest(schema, modules)
    const asAna = t.withIdentity({ subject: WORKOS_ID })
    const url = 'https://exemplo.com/quente'
    await t.run((ctx) =>
      ctx.db.insert('linkPreviews', {
        url,
        status: 'ok',
        title: 'Já buscado',
        fetchedAt: Date.now(),
      })
    )
    const spy = stubFetch(async () => htmlResponse(PAGE))

    await asAna.action(anyApi.linkPreviews.fetchPreview, { url })

    expect(spy).not.toHaveBeenCalled()
    expect((await readCache(t, url))?.title).toBe('Já buscado')
  })

  test('cache quente de FALHA também segura o fetch — é o abuso que o cache evita', async () => {
    const t = convexTest(schema, modules)
    const asAna = t.withIdentity({ subject: WORKOS_ID })
    const url = 'https://fora-do-ar.com/'
    await t.run((ctx) =>
      ctx.db.insert('linkPreviews', { url, status: 'failed', fetchedAt: Date.now() })
    )
    const spy = stubFetch(async () => htmlResponse(PAGE))

    await asAna.action(anyApi.linkPreviews.fetchPreview, { url })

    expect(spy).not.toHaveBeenCalled()
  })

  test('cache vencido (mais de 7 dias): busca de novo e substitui a linha', async () => {
    const t = convexTest(schema, modules)
    const asAna = t.withIdentity({ subject: WORKOS_ID })
    const url = 'https://exemplo.com/velho'
    await t.run((ctx) =>
      ctx.db.insert('linkPreviews', {
        url,
        status: 'failed',
        fetchedAt: Date.now() - PREVIEW_TTL_MS - 1,
      })
    )
    const spy = stubFetch(async () => htmlResponse(PAGE))

    await asAna.action(anyApi.linkPreviews.fetchPreview, { url })

    expect(spy).toHaveBeenCalledTimes(1)
    const rows = await t.run((ctx) => ctx.db.query('linkPreviews').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'ok', title: 'Título do site' })
  })

  test('sucesso seguido de falha apaga os campos antigos, não mistura as duas buscas', async () => {
    const t = convexTest(schema, modules)
    const asAna = t.withIdentity({ subject: WORKOS_ID })
    const url = 'https://exemplo.com/mudou'
    await t.run((ctx) =>
      ctx.db.insert('linkPreviews', {
        url,
        status: 'ok',
        title: 'Título antigo',
        description: 'Descrição antiga',
        fetchedAt: Date.now() - PREVIEW_TTL_MS - 1,
      })
    )
    stubFetch(async () => new Response('erro', { status: 500 }))

    await asAna.action(anyApi.linkPreviews.fetchPreview, { url })

    const row = await readCache(t, url)
    expect(row?.status).toBe('failed')
    expect(row?.title).toBeUndefined()
    expect(row?.description).toBeUndefined()
  })
})

describe('fetchPreview — respostas ruins viram cache de falha, nunca exceção', () => {
  test('fetch que rejeita (timeout): grava failed e a action NÃO rejeita', async () => {
    const t = convexTest(schema, modules)
    const asAna = t.withIdentity({ subject: WORKOS_ID })
    const url = 'https://lento.com/'
    stubFetch(async () => {
      // O que `AbortSignal.timeout` produz na prática: uma promise rejeitada.
      // O relógio real do timeout só se prova em deploy.
      throw new DOMException('The operation was aborted.', 'TimeoutError')
    })

    await expect(asAna.action(anyApi.linkPreviews.fetchPreview, { url })).resolves.toBeNull()
    expect((await readCache(t, url))?.status).toBe('failed')
  })

  test('status 404: grava failed', async () => {
    const t = convexTest(schema, modules)
    const asAna = t.withIdentity({ subject: WORKOS_ID })
    const url = 'https://exemplo.com/sumiu'
    stubFetch(async () => new Response('nada aqui', { status: 404 }))

    await asAna.action(anyApi.linkPreviews.fetchPreview, { url })

    expect((await readCache(t, url))?.status).toBe('failed')
  })

  test('content-type application/pdf: grava failed sem tentar parsear', async () => {
    const t = convexTest(schema, modules)
    const asAna = t.withIdentity({ subject: WORKOS_ID })
    const url = 'https://exemplo.com/manual.pdf'
    stubFetch(async () => htmlResponse(PAGE, 'application/pdf'))

    await asAna.action(anyApi.linkPreviews.fetchPreview, { url })

    const row = await readCache(t, url)
    expect(row?.status).toBe('failed')
    expect(row?.title).toBeUndefined()
  })

  test('content-length acima de 1 MB: grava failed sem ler o corpo', async () => {
    const t = convexTest(schema, modules)
    const asAna = t.withIdentity({ subject: WORKOS_ID })
    const url = 'https://exemplo.com/gigante'
    stubFetch(
      async () =>
        new Response(PAGE, {
          status: 200,
          headers: {
            'content-type': 'text/html',
            'content-length': String(2 * 1024 * 1024),
          },
        })
    )

    await asAna.action(anyApi.linkPreviews.fetchPreview, { url })

    expect((await readCache(t, url))?.status).toBe('failed')
  })

  test('HTML sem título nenhum: grava failed em vez de ok vazio', async () => {
    const t = convexTest(schema, modules)
    const asAna = t.withIdentity({ subject: WORKOS_ID })
    const url = 'https://exemplo.com/sem-titulo'
    stubFetch(async () => htmlResponse('<html><head></head><body>oi</body></html>'))

    await asAna.action(anyApi.linkPreviews.fetchPreview, { url })

    expect((await readCache(t, url))?.status).toBe('failed')
  })

  test('corpo enorme sem content-length: a leitura para no teto e a prévia sai mesmo assim', async () => {
    const t = convexTest(schema, modules)
    const asAna = t.withIdentity({ subject: WORKOS_ID })
    const url = 'https://exemplo.com/sem-content-length'
    // 2 MB de lixo DEPOIS do </head>: se a leitura fosse `res.text()` inteira,
    // tudo isso entraria na memória da action antes do corte.
    stubFetch(async () => htmlResponse(PAGE + 'x'.repeat(2 * 1024 * 1024)))

    await asAna.action(anyApi.linkPreviews.fetchPreview, { url })

    expect((await readCache(t, url))?.title).toBe('Título do site')
  })
})

describe('getPreview', () => {
  test('sem autenticação: lança', async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.query(anyApi.linkPreviews.getPreview, { url: 'https://exemplo.com/' })
    ).rejects.toThrow('Não autenticado')
  })

  test('autenticado e sem cache: devolve null e não faz rede', async () => {
    const t = convexTest(schema, modules)
    await insertUser(t)
    const asAna = t.withIdentity({ subject: WORKOS_ID })
    const spy = stubFetch(async () => htmlResponse(PAGE))

    const result = await asAna.query(anyApi.linkPreviews.getPreview, {
      url: 'https://exemplo.com/',
    })

    expect(result).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  test('autenticado e com cache: devolve a linha inteira', async () => {
    const t = convexTest(schema, modules)
    await insertUser(t)
    const asAna = t.withIdentity({ subject: WORKOS_ID })
    const url = 'https://exemplo.com/artigo'
    stubFetch(async () => htmlResponse(PAGE))
    await asAna.action(anyApi.linkPreviews.fetchPreview, { url })

    const result = await asAna.query(anyApi.linkPreviews.getPreview, { url })

    expect(result).toMatchObject({ status: 'ok', title: 'Título do site' })
  })

  // NÃO existe teste de "cliente não consegue chamar cachePreview".
  // Tentado e removido nesta execução: o `convex-test` executa qualquer função
  // referenciada por `anyApi` sem distinguir pública de interna — chamar
  // `cachePreview` pelo harness SUCEDE, e um teste que passasse aqui estaria
  // afirmando o contrário do que o deployment real faz. Quem recusa uma
  // `internalMutation` vinda de cliente é o servidor do Convex, e isso só se
  // observa depois do push (Plano 08.5-17). A proteção existe no código (o
  // export é `internalMutation`, nunca `mutation`); o que falta é a prova.
})
