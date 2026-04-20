/**
 * Configuração da IA (Google Gemini) — local-first.
 *
 * A chave pode vir de duas fontes (nessa ordem):
 *   1. `localStorage` (preferida): configurada no próprio app. Fica só neste navegador.
 *   2. `VITE_GEMINI_API_KEY` no build: usado só se `localStorage` estiver vazio.
 *
 * Aviso: variáveis `VITE_*` entram no bundle do front. Se você publicar o app,
 * prefira a configuração local pelo UI e deixe a `VITE_GEMINI_API_KEY` em branco no `.env`.
 */

const LS_KEY = 'ai.gemini.apiKey'
const LS_MODEL = 'ai.gemini.model'

export const DEFAULT_GEMINI_MODEL =
  (import.meta.env.VITE_GEMINI_MODEL as string | undefined)?.trim() || 'gemini-2.5-flash'

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

export type AiKeySource = 'localStorage' | 'env' | null

export function getGeminiApiKey(): { key: string; source: AiKeySource } {
  const ls = safeLocalStorage()
  const fromLs = ls?.getItem(LS_KEY)?.trim()
  if (fromLs) return { key: fromLs, source: 'localStorage' }
  const fromEnv = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim()
  if (fromEnv) return { key: fromEnv, source: 'env' }
  return { key: '', source: null }
}

export function setGeminiApiKey(key: string): void {
  const ls = safeLocalStorage()
  if (!ls) return
  const trimmed = key.trim()
  if (!trimmed) ls.removeItem(LS_KEY)
  else ls.setItem(LS_KEY, trimmed)
}

export function clearGeminiApiKey(): void {
  safeLocalStorage()?.removeItem(LS_KEY)
}

export function getGeminiModel(): string {
  const ls = safeLocalStorage()
  const fromLs = ls?.getItem(LS_MODEL)?.trim()
  return fromLs || DEFAULT_GEMINI_MODEL
}

export function setGeminiModel(model: string): void {
  const ls = safeLocalStorage()
  if (!ls) return
  const trimmed = model.trim()
  if (!trimmed) ls.removeItem(LS_MODEL)
  else ls.setItem(LS_MODEL, trimmed)
}

export function isAiConfigured(): boolean {
  return getGeminiApiKey().key.length > 0
}
