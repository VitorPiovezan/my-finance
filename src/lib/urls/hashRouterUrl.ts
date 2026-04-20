/**
 * Com `HashRouter`, o único sítio da rota é o **hash** (`#/lancamentos`).
 * URLs erradas como `/lancamentos#/entrar` (pathname falso + hash) partem do browser
 * e deixam a barra de endereço confusa — recolocamos em `origem` + `BASE_URL` + hash.
 */
export function normalizeHashOnlySpaUrl(): void {
  if (typeof window === 'undefined') return
  const hash = window.location.hash
  if (!hash.startsWith('#/')) return

  const base = import.meta.env.BASE_URL || '/'
  const pathname = window.location.pathname
  const origin = window.location.origin

  let isCanonical = false
  if (base === '/') {
    isCanonical = pathname === '/' || pathname === ''
  } else {
    const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base
    isCanonical =
      pathname === normalizedBase ||
      pathname === base ||
      pathname === `${normalizedBase}/`
  }

  if (isCanonical) return

  const prefix =
    base === '/'
      ? `${origin}/`
      : `${origin}${base.endsWith('/') ? base : `${base}/`}`

  window.history.replaceState(null, '', `${prefix}${hash}`)
}
