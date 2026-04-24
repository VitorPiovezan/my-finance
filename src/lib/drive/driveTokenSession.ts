/**
 * Access token do Google Drive: `sessionStorage` (aba) + espelho em `localStorage`
 * para sobreviver a fechar o app / WebView com mais frequência.
 */

const KEY_TOKEN = 'mf_drive_access_token'
const KEY_EXPIRES_MS = 'mf_drive_token_expires_at_ms'
const KEY_CLIENT = 'mf_drive_token_client_id'

/** Margem antes do vencimento real (evita 401 no limite). */
const EXPIRY_SKEW_MS = 90_000

function lsSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* quota / modo privado */
  }
}

function lsRemove(k: string): void {
  try {
    localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}

/** Client ID guardado junto do último token (para alinhar com o SQLite quando o meta ainda não leu bem). */
export function getStoredDriveSessionClientId(): string | null {
  try {
    const s = sessionStorage.getItem(KEY_CLIENT)?.trim()
    if (s) return s
    return lsGet(KEY_CLIENT)?.trim() || null
  } catch {
    return lsGet(KEY_CLIENT)?.trim() || null
  }
}

export function saveDriveSessionToken(
  clientId: string,
  accessToken: string,
  expiresInSec?: number,
): void {
  const cid = clientId.trim()
  try {
    sessionStorage.setItem(KEY_CLIENT, cid)
    sessionStorage.setItem(KEY_TOKEN, accessToken)
    lsSet(KEY_CLIENT, cid)
    lsSet(KEY_TOKEN, accessToken)
    if (expiresInSec != null && Number.isFinite(expiresInSec) && expiresInSec > 0) {
      const at = Date.now() + expiresInSec * 1000 - EXPIRY_SKEW_MS
      const atStr = String(at)
      sessionStorage.setItem(KEY_EXPIRES_MS, atStr)
      lsSet(KEY_EXPIRES_MS, atStr)
    } else {
      sessionStorage.removeItem(KEY_EXPIRES_MS)
      lsRemove(KEY_EXPIRES_MS)
    }
  } catch {
    /* quota / modo privado */
  }
}

function readTokenPair(expected: string): {
  token: string | null
  exp: string | null
  client: string
  source: 'session' | 'local'
} | null {
  try {
    let client = sessionStorage.getItem(KEY_CLIENT)?.trim() ?? ''
    let token = sessionStorage.getItem(KEY_TOKEN)
    let exp = sessionStorage.getItem(KEY_EXPIRES_MS)
    if (client === expected && token) {
      return { token, exp, client, source: 'session' }
    }
    client = lsGet(KEY_CLIENT)?.trim() ?? ''
    token = lsGet(KEY_TOKEN)
    exp = lsGet(KEY_EXPIRES_MS)
    if (client === expected && token) {
      return { token, exp, client, source: 'local' }
    }
  } catch {
    /* fallthrough */
  }
  return null
}

/** Token ainda válido para este Client ID (o mesmo salvo no banco ao conectar). */
export function loadDriveSessionToken(expectedClientId: string): string | null {
  const expected = expectedClientId.trim()
  if (!expected) return null
  const pair = readTokenPair(expected)
  if (!pair?.token) return null
  if (pair.exp != null && Date.now() > Number(pair.exp)) {
    clearDriveSessionToken()
    return null
  }
  if (pair.source === 'local') {
    try {
      sessionStorage.setItem(KEY_CLIENT, pair.client)
      sessionStorage.setItem(KEY_TOKEN, pair.token)
      if (pair.exp != null) sessionStorage.setItem(KEY_EXPIRES_MS, pair.exp)
    } catch {
      /* ignore */
    }
  }
  return pair.token
}

export function clearDriveSessionToken(): void {
  try {
    sessionStorage.removeItem(KEY_TOKEN)
    sessionStorage.removeItem(KEY_EXPIRES_MS)
    sessionStorage.removeItem(KEY_CLIENT)
  } catch {
    /* ignore */
  }
  lsRemove(KEY_TOKEN)
  lsRemove(KEY_EXPIRES_MS)
  lsRemove(KEY_CLIENT)
}
