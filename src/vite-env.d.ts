/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ACCESS_PIN?: string
  readonly VITE_BASE_PATH?: string
  /** OAuth Client ID padrão (deploy). Sobrescrito pelo valor salvo no SQLite. */
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID?: string
  /** ID ou URL da pasta raiz no Drive (deploy). Sobrescrito pelo SQLite. */
  readonly VITE_GOOGLE_DRIVE_ROOT_FOLDER_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.wasm?url' {
  const src: string
  export default src
}
