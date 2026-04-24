import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useFinanceDb } from '../context/useFinanceDb'
import { loadDriveSessionToken } from '../lib/drive/driveTokenSession'
import { isFirebaseConfigured, isGoogleAccessGateDisabled } from '../lib/firebase/env'
import { getEffectiveDriveOauthClientIdPreferSession } from '../lib/settings/driveFolder'
import { needsNativeAppPinGate } from '../lib/session/appSessionUnlock'
import { hasQuickUnlockEnvelope } from '../lib/session/pinQuickUnlock'

const LOGIN_PATH = '/entrar'
const ONBOARD_PATH = '/primeiro-acesso'

/** Link mágico do Firebase anexa ?oobCode=… — não redirecionar pra /entrar ou o fluxo quebra. */
function isFirebaseEmailLinkCallbackUrl(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const p = new URLSearchParams(window.location.search)
    if (p.get('oobCode')) return true
    if (p.get('mode') === 'signIn' && p.get('apiKey')) return true
  } catch {
    return false
  }
  return false
}

/**
 * Com Firebase configurado: exige token OAuth do Drive válido nesta aba antes do restante do app.
 * Rotas de login e primeiro acesso ficam de fora.
 */
export function GoogleAccessGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { getDb } = useFinanceDb()

  if (isGoogleAccessGateDisabled() || !isFirebaseConfigured()) {
    return <>{children}</>
  }

  if (isFirebaseEmailLinkCallbackUrl()) {
    return <>{children}</>
  }

  if (location.pathname === LOGIN_PATH || location.pathname === ONBOARD_PATH) {
    return <>{children}</>
  }

  const clientId = getEffectiveDriveOauthClientIdPreferSession(getDb())
  const token = loadDriveSessionToken(clientId)
  if (
    token &&
    needsNativeAppPinGate(true, hasQuickUnlockEnvelope())
  ) {
    return <Navigate to={LOGIN_PATH} replace state={{ from: location.pathname }} />
  }
  if (token) {
    return <>{children}</>
  }

  return <Navigate to={LOGIN_PATH} replace state={{ from: location.pathname }} />
}
