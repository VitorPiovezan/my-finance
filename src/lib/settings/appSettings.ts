import type { Database } from 'sql.js'
import { queryOne, run } from '../db/query'

/**
 * Gerencia chaves de configuração persistidas no SQLite local (tabela `meta`).
 *
 * Por que no DB e não em `localStorage`?
 * - Acompanha o export/import de `.sqlite`: trocar de navegador mantém tudo.
 * - Fica só no navegador do usuário — nenhum valor vai pro bundle público.
 *
 * Entram aqui as credenciais que antes eram lidas de `VITE_*`:
 *   - `ai.gemini.api_key` / `ai.gemini.model`
 *   - `drive.oauth_client_id` / `drive.root_folder_id`
 */

export const SETTING_KEYS = {
  aiGeminiApiKey: 'ai.gemini.api_key',
  aiGeminiModel: 'ai.gemini.model',
  driveOauthClientId: 'drive.oauth_client_id',
  driveRootFolderId: 'drive.root_folder_id',
} as const

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]

export function getSetting(db: Database, key: SettingKey): string {
  const row = queryOne(db, `SELECT value FROM meta WHERE key = ?`, [key])
  const raw = row?.value
  return typeof raw === 'string' ? raw.trim() : ''
}

export function setSetting(db: Database, key: SettingKey, value: string): void {
  const trimmed = value.trim()
  if (!trimmed) {
    removeSetting(db, key)
    return
  }
  run(
    db,
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, trimmed],
  )
}

export function removeSetting(db: Database, key: SettingKey): void {
  run(db, `DELETE FROM meta WHERE key = ?`, [key])
}

/**
 * Copia valores antigos de `localStorage` pra tabela `meta` quando o DB
 * ainda não tem a chave correspondente. Idempotente: pode rodar em toda
 * abertura do banco. Apaga do localStorage depois pra não ficar cópia
 * duplicada.
 */
export function migrateLegacySettings(db: Database): void {
  try {
    if (typeof window === 'undefined') return
    const ls = window.localStorage
    if (!ls) return
    const mapping: Array<[string, SettingKey]> = [
      ['ai.gemini.apiKey', SETTING_KEYS.aiGeminiApiKey],
      ['ai.gemini.model', SETTING_KEYS.aiGeminiModel],
      ['my_finance_drive_root_folder_id', SETTING_KEYS.driveRootFolderId],
    ]
    for (const [lsKey, dbKey] of mapping) {
      const raw = ls.getItem(lsKey)?.trim()
      if (!raw) continue
      if (!getSetting(db, dbKey)) setSetting(db, dbKey, raw)
      ls.removeItem(lsKey)
    }
  } catch {
    /* storage indisponível — só segue a vida */
  }
}
