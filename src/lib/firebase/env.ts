/** True quando as variáveis mínimas do Firebase estão no build (Firestore + link por e-mail). */
export function isFirebaseConfigured(): boolean {
  const apiKey = (import.meta.env.VITE_FIREBASE_API_KEY ?? '').trim()
  const authDomain = (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '').trim()
  const projectId = (import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '').trim()
  const appId = (import.meta.env.VITE_FIREBASE_APP_ID ?? '').trim()
  return (
    apiKey.length > 0 && authDomain.length > 0 && projectId.length > 0 && appId.length > 0
  )
}

/** Desativa o gate de login Google (ex.: dev local com só SQLite). */
export function isGoogleAccessGateDisabled(): boolean {
  return (import.meta.env.VITE_DISABLE_GOOGLE_GATE ?? '').trim() === '1'
}
