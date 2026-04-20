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

export function requestDriveAccessToken(clientId: string, forceConsent: boolean): Promise<string> {
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
          scope: 'https://www.googleapis.com/auth/drive.readonly',
          callback: (resp) => {
            if (resp.error) {
              reject(new Error(resp.error_description ?? resp.error))
              return
            }
            if (!resp.access_token) {
              reject(new Error('Token não retornado'))
              return
            }
            resolve(resp.access_token)
          },
        })
        client.requestAccessToken({ prompt: forceConsent ? 'consent' : '' })
      }),
  )
}
