/** Origem HTTPS atual (ex.: https://vitorpiovezan.github.io). */
export function getPublicAppOrigin(): string {
  return window.location.origin
}

/** Origem + base do Vite (ex.: …/my-finance/ em GitHub Pages). */
export function getPublicAppBaseUrl(): string {
  const base = import.meta.env.BASE_URL || '/'
  const path = base.endsWith('/') ? base : `${base}/`
  return `${window.location.origin}${path}`
}
