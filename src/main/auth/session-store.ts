// Persistência da sessão de autenticação via `safeStorage` ASSÍNCRONO
// (encryptStringAsync/decryptStringAsync), nunca localStorage e nunca a API
// síncrona do safeStorage (electron-store não é usado aqui — divergência
// deliberada do exemplo oficial da WorkOS, ver 02-RESEARCH.md §3).
//
// IMPORTANTE: nenhuma função deste arquivo pode ser chamada antes de
// `app.whenReady()` resolver. O encryptor assíncrono do Electron é
// inicializado lazily na primeira chamada a encryptStringAsync/
// decryptStringAsync *depois* que o app está pronto — chamar antes disso
// lança/gera comportamento indefinido.

import { safeStorage, app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'

interface StoredSession {
  refreshToken: string
  workosId: string
}

function sessionFilePath(): string {
  return path.join(app.getPath('userData'), 'auth-session.enc')
}

export async function writeSession(session: StoredSession): Promise<void> {
  const plainText = JSON.stringify(session)
  const encrypted = await safeStorage.encryptStringAsync(plainText)
  await fs.writeFile(sessionFilePath(), encrypted.toString('base64'), 'utf-8')
}

export async function readSession(): Promise<StoredSession | null> {
  try {
    const raw = await fs.readFile(sessionFilePath(), 'utf-8')
    const encrypted = Buffer.from(raw, 'base64')
    const { result } = await safeStorage.decryptStringAsync(encrypted)
    return JSON.parse(result) as StoredSession
  } catch {
    // Arquivo ausente, base64 inválido, decrypt falhando (DPAPI amarrado a outra
    // credencial de login do Windows, ou máquina/instalação diferente — Pitfall 7),
    // ou JSON corrompido: em todos os casos, tratar como "sem sessão", nunca lançar.
    return null
  }
}

export async function clearStoredSession(): Promise<void> {
  try {
    await fs.rm(sessionFilePath(), { force: true })
  } catch {
    // Falha ao remover não deve travar o fluxo de logout.
  }
}
