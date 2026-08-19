import { ConvexReactClient } from 'convex/react'

const raw = import.meta.env.VITE_CONVEX_URL

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
const url = raw ? raw.replace(/\/+$/, '') : ''

/**
 * Nenhum throw no nível do módulo.
 *
 * `main.tsx` importa este módulo antes de `createRoot(...).render()` rodar — um
 * import ESM é hoisted, então qualquer exceção lançada aqui aconteceria antes de
 * existir qualquer DOM montado ou error boundary React capaz de capturá-la. Num
 * build empacotado com VITE_CONVEX_URL faltando (variável embutida em tempo de
 * build, não lida em runtime — ver 09-RESEARCH.md §4), isso produzia um popup de
 * "Uncaught Exception" com stack trace de node_modules, sem nenhuma pista pro
 * usuário. Mesma classe de bug que 02-VERIFICACAO.md já registrou e corrigiu uma
 * vez para `createWorkOS` em src/main/auth/auth.ts (achado #3) — nunca corrigida
 * aqui.
 *
 * A falta de configuração agora vira estado (`isConvexConfigured`), checado por
 * main.tsx antes de montar o `ConvexProviderWithAuth` — nunca uma exceção não
 * capturada.
 */
export const isConvexConfigured = Boolean(url)
export const convexClient = isConvexConfigured ? new ConvexReactClient(url) : null
