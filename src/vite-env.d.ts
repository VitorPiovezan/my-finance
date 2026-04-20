/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASE_PATH?: string
  /** `1` desliga o gate de login Google (útil sem Firebase em dev). */
  readonly VITE_DISABLE_GOOGLE_GATE?: string
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.wasm?url' {
  const src: string
  export default src
}
