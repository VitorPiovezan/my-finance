import type { Database } from 'sql.js'
import { getStoredDriveSessionClientId } from '../drive/driveTokenSession'
import { SETTING_KEYS, getSetting, setSetting } from './appSettings'

/**
 * Configurações do Google Drive (folder raiz + OAuth Client ID).
 *
 * Ficam na tabela `meta` do SQLite local; o Client ID vem também do registo
 * do utilizador (Firestore) durante o onboarding. O token OAuth na sessão
 * guarda o Client ID usado em `saveDriveSessionToken` para não divergir.
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

/** Client ID efetivo: valor salvo no SQLite. */
export function getEffectiveDriveOauthClientId(db: Database): string {
  return getDriveOauthClientId(db).trim()
}

/**
 * Igual ao efetivo, mas se o SQLite ainda não tiver meta e existir token na sessão da aba,
 * usa o Client ID guardado com esse token (o mesmo usado em `saveDriveSessionToken`).
 */
export function getEffectiveDriveOauthClientIdPreferSession(db: Database): string {
  const fromDb = getDriveOauthClientId(db).trim()
  if (fromDb) return fromDb
  return getStoredDriveSessionClientId() ?? ''
}

/** ID da pasta raiz efetivo: apenas o valor salvo no SQLite. */
export function getEffectiveDriveRootFolderId(db: Database): string {
  return getDriveRootFolderId(db).trim()
}

export function setDriveOauthClientId(db: Database, clientId: string): void {
  setSetting(db, SETTING_KEYS.driveOauthClientId, clientId)
}

/** Heurística simples pra validar o Client ID do Google (termina em .apps.googleusercontent.com). */
export function isLikelyGoogleOauthClientId(id: string): boolean {
  return /\.apps\.googleusercontent\.com$/i.test(id.trim())
}
