import type { Database } from 'sql.js'
import { SETTING_KEYS, getSetting, setSetting } from './appSettings'

/**
 * Configurações do Google Drive (folder raiz + OAuth Client ID).
 *
 * Ambas ficam na tabela `meta` do SQLite local pra nunca serem embutidas
 * no bundle público. O OAuth Client ID é "semi-público" por design do
 * Google, mas um atacante que capture o seu pode esgotar a quota associada
 * — então mantemos em local isolado por padrão.
 */

/** Aceita só o ID ou a URL completa do Drive (cole o link da pasta). */
export function extractDriveFolderId(raw: string): string {
  const s = raw.trim()
  const fromPath = s.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (fromPath?.[1]) return fromPath[1]
  const fromQuery = s.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (fromQuery?.[1]) return fromQuery[1]
  return s
}

export function isLikelyDriveFolderId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{10,128}$/.test(id.trim())
}

export function getDriveRootFolderId(db: Database): string {
  return extractDriveFolderId(getSetting(db, SETTING_KEYS.driveRootFolderId))
}

export function setDriveRootFolderId(db: Database, id: string): void {
  setSetting(db, SETTING_KEYS.driveRootFolderId, extractDriveFolderId(id))
}

export function getDriveOauthClientId(db: Database): string {
  return getSetting(db, SETTING_KEYS.driveOauthClientId)
}

export function setDriveOauthClientId(db: Database, clientId: string): void {
  setSetting(db, SETTING_KEYS.driveOauthClientId, clientId)
}

/** Heurística simples pra validar o Client ID do Google (termina em .apps.googleusercontent.com). */
export function isLikelyGoogleOauthClientId(id: string): boolean {
  return /\.apps\.googleusercontent\.com$/i.test(id.trim())
}
