// Página de conclusão de login (AUTH-07), servida por convex/http.ts na rota
// GET /auth/complete. Ver a "Decisão registrada — 2026-08-18" em .planning/STATE.md
// para o motivo desta rota existir: o app não pode fechar a aba do navegador (foi
// aberta pelo SO via shell.openExternal, não por script — todo navegador bloqueia
// window.close() nesse caso, por design, igual Discord/Slack/Spotify). O que dá pra
// fazer, e é o que esta página faz, é confirmar que o login deu certo e dizer que a
// aba pode ser fechada — nunca prometer que ela vai se fechar sozinha.
//
// HTML totalmente inline: uma httpAction do Convex não serve arquivos estáticos, e a
// página deve funcionar sem depender de rede (sem fonte externa, sem CDN, sem
// tracking) — é servida a um navegador, não ao app.

/** Escapa uma string para uso seguro dentro de um atributo HTML entre aspas duplas.
 *  Aplicado a `callbackUrl` mesmo vindo de query params controlados pela WorkOS —
 *  nunca confiar em query string não escapada dentro de HTML. */
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Escapa uma string para uso seguro como literal de string dentro de um bloco
 *  <script> inline. HTML entities (usadas em escapeHtmlAttribute) NÃO são
 *  decodificadas dentro de <script> — usar o escape de atributo aqui quebraria a
 *  URL. Escapa aspas/barra invertida para a sintaxe JS e a sequência "</script"
 *  para impedir que o valor feche a tag e injete HTML/JS arbitrário. */
function escapeJsStringLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\u003C')
}

const baseStyles = `
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #313338;
      color: #f2f3f5;
      font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
      text-align: center;
    }
    main { max-width: 28rem; padding: 2rem; }
    h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
    p { color: #b5bac1; line-height: 1.5; margin: 0.5rem 0; }
    a { color: #00a8fc; }
  </style>
`

/** Monta o HTML da página de conclusão.
 *
 * `hasCallbackParams=true` (caminho normal, veio de um redirect real da WorkOS com
 * `code`/`error` na query string): dispara um redirect automático via <script> para
 * `janja://callback?...`, mais um texto sempre visível e um link manual como
 * fallback — alguns navegadores exigem confirmação de clique para abrir um app
 * externo, e o redirect automático pode ser bloqueado silenciosamente.
 *
 * `hasCallbackParams=false` (alguém abriu a URL sem vir de um callback de verdade,
 * ex: digitou à mão): mensagem genérica, sem tentar redirecionar para um
 * `janja://callback` vazio. */
export function renderCompletionPage(hasCallbackParams: boolean, callbackUrl: string): string {
  if (!hasCallbackParams) {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>janja</title>
  ${baseStyles}
</head>
<body>
  <main>
    <h1>Nada para completar aqui.</h1>
    <p>Esta página só faz sentido como retorno de um login iniciado pelo app janja.</p>
  </main>
</body>
</html>`
  }

  const safeHrefUrl = escapeHtmlAttribute(callbackUrl)
  const safeJsUrl = escapeJsStringLiteral(callbackUrl)

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>janja — login concluído</title>
  ${baseStyles}
</head>
<body>
  <main>
    <h1>Login concluído.</h1>
    <p>Você pode fechar esta aba e voltar para o app janja.</p>
    <p>Se o app não abrir sozinho, <a href="${safeHrefUrl}">clique aqui</a>.</p>
  </main>
  <script>
    window.location.href = "${safeJsUrl}";
  </script>
</body>
</html>`
}
