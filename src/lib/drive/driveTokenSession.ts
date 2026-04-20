/**
 * Mantém o access token do Google Drive na sessão do navegador (aba) para não
 * precisar clicar em "Conectar Google" ao trocar de página. Some ao fechar a aba.
 */

const KEY_TOKEN = 'mf_drive_access_token'
const KEY_EXPIRES_MS = 'mf_drive_token_expires_at_ms'
const KEY_CLIENT = 'mf_drive_token_client_id'

/** Margem antes do vencimento real (evita 401 no limite). */
const EXPIRY_SKEW_MS = 90_000

export function saveDriveSessionToken(
  clientId: string,
  accessToken: string,
  expiresInSec?: number,
): void {
  try {
    sessionStorage.setItem(KEY_CLIENT, clientId)
    sessionStorage.setItem(KEY_TOKEN, accessToken)
    if (expiresInSec != null && Number.isFinite(expiresInSec) && expiresInSec > 0) {
      const at = Date.now() + expiresInSec * 1000 - EXPIRY_SKEW_MS
      sessionStorage.setItem(KEY_EXPIRES_MS, String(at))
    } else {
      sessionStorage.removeItem(KEY_EXPIRES_MS)
    }
  } catch {
    /* quota / modo privado */
  }
}

/** Token ainda válido para este Client ID (o mesmo salvo no banco ao conectar). */
export function loadDriveSessionToken(expectedClientId: string): string | null {
  if (!expectedClientId.trim()) return null
  try {
    const storedClient = sessionStorage.getItem(KEY_CLIENT)
    if (storedClient !== expectedClientId) return null
    const exp = sessionStorage.getItem(KEY_EXPIRES_MS)
    if (exp != null && Date.now() > Number(exp)) {
      clearDriveSessionToken()
      return null
    }
    return sessionStorage.getItem(KEY_TOKEN)
  } catch {
    return null
  }
}

export function clearDriveSessionToken(): void {
  try {
    sessionStorage.removeItem(KEY_TOKEN)
    sessionStorage.removeItem(KEY_EXPIRES_MS)
    sessionStorage.removeItem(KEY_CLIENT)
  } catch {
    /* ignore */
  }
}
