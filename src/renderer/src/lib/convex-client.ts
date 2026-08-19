import { ConvexReactClient } from 'convex/react'

const raw = import.meta.env.VITE_CONVEX_URL

if (!raw) {
  throw new Error('VITE_CONVEX_URL não definida — ver .env.local.example e o checkpoint 02-04')
}

/**
 * Barra no final é removida de propósito.
 *
 * O cliente do Convex concatena `/api/...` na URL sem normalizar. Com uma barra
 * sobrando, o WebSocket vira `wss://host//api/...` e o servidor responde 404 — o app
 * fica carregando para sempre, sem erro de aplicação nenhum.
 *
 * Aconteceu de verdade: um testador copiou a URL com a barra que o navegador exibe, e o
 * sintoma não tinha relação aparente com a causa. Normalizar aqui custa uma linha e
 * elimina a classe inteira do problema, em vez de confiar que todo mundo vai copiar
 * certo para sempre.
 */
const url = raw.replace(/\/+$/, '')

export const convexClient = new ConvexReactClient(url)
