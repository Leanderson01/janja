/// <reference types="vite/client" />

/**
 * Variaveis EMBUTIDAS EM TEMPO DE BUILD (prefixo VITE_). Sem esta declaracao
 * elas sao `any` — e um typo em `import.meta.env.VITE_CONVEX_UR` viraria
 * `undefined` em silencio, no navegador, sem passar por nenhum typecheck.
 *
 * Todas OPCIONAIS de proposito: elas podem legitimamente faltar (build mal
 * configurado), e e por isso que existe a tela "Configuracao incompleta" em
 * `main.tsx`. Marca-las como obrigatorias mentiria para quem le.
 */
interface ImportMetaEnv {
  readonly VITE_CONVEX_URL?: string
  /**
   * So o alvo WEB. No desktop o client id do WorkOS vive em
   * `MAIN_VITE_WORKOS_CLIENT_ID` e e lido pelo PROCESSO MAIN — o renderer do
   * Electron nunca o ve, porque quem fala com a WorkOS la e o main.
   */
  readonly VITE_WORKOS_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
