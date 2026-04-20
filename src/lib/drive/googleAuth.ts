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

export function requestDriveAccessToken(
  clientId: string,
  forceConsent: boolean,
): Promise<DriveTokenResult> {
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
          // readonly: listar/importar CSVs na pasta · drive.file: criar/atualizar o backup .sqlite
          scope: [
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/drive.file',
          ].join(' '),
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
        client.requestAccessToken({ prompt: forceConsent ? 'consent' : '' })
      }),
  )
}
