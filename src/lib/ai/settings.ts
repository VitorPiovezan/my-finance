import type { Database } from 'sql.js'
import { SETTING_KEYS, getSetting, removeSetting, setSetting } from '../settings/appSettings'

/**
 * Configuração da IA (Google Gemini) — local-first, zero env.
 *
 * A chave e o modelo ficam na tabela `meta` do SQLite local. Assim:
 *   - Seguem o export/import do `.sqlite` (backup completo).
 *   - Não vazam no bundle público em deploys.
 *
 * Pegue uma chave em https://aistudio.google.com/app/apikey.
 */

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

export function getGeminiApiKey(db: Database): string {
  return getSetting(db, SETTING_KEYS.aiGeminiApiKey)
}

export function setGeminiApiKey(db: Database, key: string): void {
  setSetting(db, SETTING_KEYS.aiGeminiApiKey, key)
}

export function clearGeminiApiKey(db: Database): void {
  removeSetting(db, SETTING_KEYS.aiGeminiApiKey)
}

export function getGeminiModel(db: Database): string {
  return getSetting(db, SETTING_KEYS.aiGeminiModel) || DEFAULT_GEMINI_MODEL
}

export function setGeminiModel(db: Database, model: string): void {
  if (!model.trim() || model.trim() === DEFAULT_GEMINI_MODEL) {
    removeSetting(db, SETTING_KEYS.aiGeminiModel)
    return
  }
  setSetting(db, SETTING_KEYS.aiGeminiModel, model)
}

export function isAiConfigured(db: Database): boolean {
  return getGeminiApiKey(db).length > 0
}
