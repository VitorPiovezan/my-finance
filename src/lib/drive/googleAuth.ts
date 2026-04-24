import { getPublicAppBaseUrl } from '../urls/publicAppUrl'
import { DRIVE_OAUTH_SCOPES } from './driveOAuthScopes'

export function loadGsiScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-my-finance-gsi]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Script GSI')), { once: true })
      return
    }
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.dataset.myFinanceGsi = '1'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Não foi possível carregar o Google Identity Services'))
    document.head.appendChild(s)
  })
}

export type DriveTokenResult = {
  accessToken: string
  /** Segundos até expirar (quando o Google envia). */
  expiresInSec?: number
}

/** Sessão antes do redirect OAuth (WebView / app nativo embutido). */
export const DRIVE_OAUTH_PENDING_KEY = 'my_finance_drive_oauth_pending'

/** Resultado após voltar do Google (consumido pelo React após hidratar o DB). */
export const DRIVE_OAUTH_RESULT_KEY = 'my_finance_drive_oauth_result'

/** Mensagem de erro OAuth para exibir na próxima tela (login/sync). */
export const DRIVE_OAUTH_FLASH_ERROR_KEY = 'my_finance_drive_oauth_flash_error'

export type DriveOAuthRedirectContext = {
  returnHash: string
  source: 'login' | 'sync'
  /** Só login: rota protegida que o utilizador tentou abrir (GoogleAccessGate). */
  postLoginFrom?: string
  /**
   * E-mail já escolhido no login Firebase; o GIS/OAuth usa como `login_hint` para
   * reutilizar a mesma conta e evitar um segundo «Escolha uma conta».
   */
  loginHint?: string
}

type OAuthPendingPayload = {
  state: string
  returnHash: string
  source: 'login' | 'sync'
  postLoginFrom?: string
}

/**
 * App nativo (Expo WebView) injeta esta flag. O GIS em popup/postMessage costuma
 * travar no consentimento; usamos OAuth2 implicit por redirect na mesma origem.
 */
export function isRnWebViewEmbed(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(
    (window as unknown as { __MY_FINANCE_RN_WEBVIEW__?: boolean }).__MY_FINANCE_RN_WEBVIEW__,
  )
}

/**
 * redirect_uri deve estar idêntico em «APIs e serviços → Credenciais → ID do cliente OAuth»
 * (URIs de redirecionamento autorizados), ex.: https://vitorpiovezan.com.br/my-finance/
 */
function oauthRedirectUri(): string {
  let base = getPublicAppBaseUrl()
  if (!base.endsWith('/')) base = `${base}/`
  return base
}

export function startDriveOAuthImplicitRedirect(
  clientId: string,
  forceConsent: boolean,
  ctx: DriveOAuthRedirectContext,
): void {
  const state = crypto.randomUUID()
  const pending: OAuthPendingPayload = {
    state,
    returnHash: ctx.returnHash,
    source: ctx.source,
    postLoginFrom: ctx.postLoginFrom,
  }
  sessionStorage.setItem(DRIVE_OAUTH_PENDING_KEY, JSON.stringify(pending))

  const redirectUri = oauthRedirectUri()
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('response_type', 'token')
  u.searchParams.set('scope', DRIVE_OAUTH_SCOPES)
  u.searchParams.set('state', state)
  u.searchParams.set('include_granted_scopes', 'true')
  if (forceConsent) u.searchParams.set('prompt', 'consent')
  const hint = ctx.loginHint?.trim()
  if (hint?.includes('@')) u.searchParams.set('login_hint', hint)

  window.location.assign(u.toString())
}

/**
 * Antes do React: troca `#access_token=…` pelo hash de rota certo e grava resultado em sessionStorage.
 * HashRouter usa `#/rota`; o Google devolve fragmento sem `/`, por isso não mistura com `#/entrar`.
 */
export function bootstrapDriveOAuthImplicitHash(): void {
  if (typeof window === 'undefined') return
  const rawHash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : ''
  if (!rawHash.includes('access_token=') && !rawHash.includes('error=')) return

  const params = new URLSearchParams(rawHash)
  const pathname = window.location.pathname
  const search = window.location.search

  const pendingRaw = sessionStorage.getItem(DRIVE_OAUTH_PENDING_KEY)
  const pending: OAuthPendingPayload | null = pendingRaw ? JSON.parse(pendingRaw) : null
  const returnHash = pending?.returnHash ?? '#/entrar'

  const oauthError = params.get('error')
  if (oauthError) {
    const desc = params.get('error_description') ?? oauthError
    sessionStorage.setItem(
      DRIVE_OAUTH_RESULT_KEY,
      JSON.stringify({
        error: oauthError,
        errorDescription: desc,
        source: pending?.source ?? 'login',
        postLoginFrom: pending?.postLoginFrom,
      }),
    )
    sessionStorage.removeItem(DRIVE_OAUTH_PENDING_KEY)
    window.history.replaceState(null, '', `${pathname}${search}${returnHash}`)
    return
  }

  const accessToken = params.get('access_token')
  const state = params.get('state')
  if (!accessToken || !state || !pending || pending.state !== state) {
    sessionStorage.removeItem(DRIVE_OAUTH_PENDING_KEY)
    sessionStorage.setItem(
      DRIVE_OAUTH_FLASH_ERROR_KEY,
      'Falha na autorização Google (estado inválido ou sessão expirada). Tente de novo.',
    )
    window.history.replaceState(null, '', `${pathname}${search}${returnHash}`)
    return
  }

  const expiresIn = params.get('expires_in')
  const expiresInSec =
    expiresIn != null && expiresIn.length > 0 ? Number(expiresIn) : undefined

  sessionStorage.setItem(
    DRIVE_OAUTH_RESULT_KEY,
    JSON.stringify({
      accessToken,
      expiresInSec: expiresInSec != null && Number.isFinite(expiresInSec) ? expiresInSec : undefined,
      source: pending.source,
      postLoginFrom: pending.postLoginFrom,
    }),
  )
  sessionStorage.removeItem(DRIVE_OAUTH_PENDING_KEY)
  window.history.replaceState(null, '', `${pathname}${search}${returnHash}`)
}

export function requestDriveAccessToken(
  clientId: string,
  forceConsent: boolean,
  redirectContext?: DriveOAuthRedirectContext,
): Promise<DriveTokenResult> {
  if (isRnWebViewEmbed()) {
    const ctx: DriveOAuthRedirectContext = redirectContext ?? {
      returnHash: '#/entrar',
      source: 'login',
    }
    startDriveOAuthImplicitRedirect(clientId, forceConsent, ctx)
    return new Promise(() => {
      /* página redireciona; Promise abandonada */
    })
  }

  const loginHint = redirectContext?.loginHint?.trim()

  return loadGsiScript().then(
    () =>
      new Promise((resolve, reject) => {
        const google = window.google
        if (!google?.accounts?.oauth2) {
          reject(new Error('Google Identity Services indisponível'))
          return
        }
        const client = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: DRIVE_OAUTH_SCOPES,
          callback: (resp) => {
            if (resp.error) {
              reject(new Error(resp.error_description ?? resp.error))
              return
            }
            if (!resp.access_token) {
              reject(new Error('Token não retornado'))
              return
            }
            const raw = (resp as { expires_in?: string | number }).expires_in
            const expiresInSec =
              raw != null && String(raw).length > 0 ? Number(raw) : undefined
            resolve({
              accessToken: resp.access_token,
              expiresInSec:
                expiresInSec != null && Number.isFinite(expiresInSec) ? expiresInSec : undefined,
            })
          },
        })
        const hint = loginHint?.includes('@') ? loginHint : undefined
        client.requestAccessToken({
          prompt: forceConsent ? 'consent' : '',
          ...(hint ? { login_hint: hint } : {}),
        })
      }),
  )
}
