import type { Database } from 'sql.js'
import { uploadSqliteBackupToDrive } from './sqliteDriveBackup'
import { getEffectiveDriveRootFolderId, isLikelyDriveFolderId } from '../settings/driveFolder'

export type PushLocalSqliteBackupResult =
  | { ok: true; created: boolean; fileId: string }
  | { ok: false; error: string }

/**
 * Exporta o SQLite atual e envia/atualiza `my-finance.sqlite` na pasta raiz do Drive.
 * O caller deve garantir `persistNow()` antes se quiser o que está no IndexedDB refletido no export.
 */
export async function pushLocalSqliteBackupToDrive(params: {
  db: Database
  token: string
}): Promise<PushLocalSqliteBackupResult> {
  const id = getEffectiveDriveRootFolderId(params.db)
  if (!isLikelyDriveFolderId(id)) {
    return {
      ok: false,
      error:
        'Salve o ID da pasta raiz na tela Sincronizar (SQLite local).',
    }
  }
  try {
    const data = params.db.export()
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    const res = await uploadSqliteBackupToDrive({
      token: params.token,
      rootFolderId: id,
      data: bytes,
    })
    return { ok: true, created: res.created, fileId: res.fileId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
