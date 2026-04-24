import { isRnWebViewEmbed } from '../drive/googleAuth'

const KEY = 'mf_app_unlock_v1'

/** Marca a «sessão do app» como desbloqueada (PIN ok neste ciclo de vida da WebView). */
export function setAppSessionUnlocked(): void {
  try {
    sessionStorage.setItem(KEY, '1')
  } catch {
    /* quota / privado */
  }
}

export function clearAppSessionUnlock(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export function isAppSessionUnlocked(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/**
 * App nativo (Expo): com token Drive + envelope PIN, exige PIN de novo após o shell
 * limpar `sessionStorage` ao ir para background (reabrir o app).
 * No browser isso não se aplica — não injetamos essa limpeza.
 */
export function needsNativeAppPinGate(hasDriveToken: boolean, hasPinEnvelope: boolean): boolean {
  if (!isRnWebViewEmbed()) return false
  if (!hasDriveToken || !hasPinEnvelope) return false
  return !isAppSessionUnlocked()
}
