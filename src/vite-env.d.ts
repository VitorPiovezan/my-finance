/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ACCESS_PIN?: string
  readonly VITE_BASE_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.wasm?url' {
  const src: string
  export default src
}
