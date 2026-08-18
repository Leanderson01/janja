// Registro do protocolo customizado `janja://` e extração/parsing da URL de
// callback do OAuth a partir do argv de uma segunda instância do app.
//
// Alvo exclusivo: Windows (PROJECT.md). No Windows não existe o evento
// `open-url` do macOS — a única forma de o SO entregar `janja://callback?...`
// a um app já em execução é reabrir uma segunda instância, que o
// `requestSingleInstanceLock()` (F0) intercepta via o evento `second-instance`
// em src/main/index.ts, entregando o `argv` da nova invocação.

import { app } from 'electron'
import path from 'path'

const PROTOCOL = 'janja'

/** Chamar antes de app.whenReady() resolver, uma única vez, apenas na
 *  instância principal (depois que requestSingleInstanceLock() foi concedido). */
export function registerProtocol(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    // electron-vite dev: o executável é o binário genérico do Electron
    // (electron.exe), não um .exe empacotado do janja — sem passar
    // process.execPath + o caminho do script como args, o registro no
    // Windows aponta para "electron.exe" sem saber qual projeto abrir.
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
  } else {
    // Empacotado (F9): sem path/args já basta — usa o Registro do Windows
    // internamente.
    app.setAsDefaultProtocolClient(PROTOCOL)
  }
}

/** Procura no argv de uma nova invocação (second-instance) por uma URL
 *  `janja://...`. Retorna null se nenhuma URL do protocolo estiver presente
 *  (ex: segunda instância aberta manualmente, sem callback de OAuth). */
export function extractCallbackUrl(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${PROTOCOL}://`)) ?? null
}

export interface CallbackParams {
  code: string | null
  state: string | null
  error: string | null
}

/** Extrai code/state/error da querystring de `janja://callback?code=...&state=...`. */
export function parseCallbackParams(url: string): CallbackParams {
  const params = new URL(url).searchParams
  return {
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error')
  }
}
