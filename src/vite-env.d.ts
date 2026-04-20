/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID?: string
  readonly VITE_DRIVE_FINANCE_ROOT_FOLDER_ID?: string
  readonly VITE_APP_ACCESS_PIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.wasm?url' {
  const src: string
  export default src
}
