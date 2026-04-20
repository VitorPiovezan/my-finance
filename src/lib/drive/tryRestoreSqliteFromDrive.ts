import { downloadSqliteBackupBytes, SQLITE_DRIVE_BACKUP_NAME } from './sqliteDriveBackup'

const AFTER_OAUTH_DELAY_MS = 350

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Baixa `my-finance.sqlite` na pasta raiz, se existir; caso contrário mensagem amigável.
 * Em sucesso recarrega a página (o SQLite no IndexedDB já foi trocado).
 * @returns `true` se agendou `location.reload()` (não retorna depois disso de fato).
 */
export async function tryRestoreSqliteFromDriveAfterOAuth(params: {
  accessToken: string
  rootFolderId: string
  replaceDatabaseFromFile: (file: File) => Promise<void>
  onLog: (line: string) => void
}): Promise<boolean> {
  await delay(AFTER_OAUTH_DELAY_MS)
  const { accessToken, rootFolderId, replaceDatabaseFromFile, onLog } = params
  try {
    onLog('Baixando backup do Drive…')
    const { bytes } = await downloadSqliteBackupBytes(accessToken, rootFolderId)
    const file = new File([new Uint8Array(bytes)], SQLITE_DRIVE_BACKUP_NAME, {
      type: 'application/x-sqlite3',
    })
    await replaceDatabaseFromFile(file)
    onLog('Backup do Drive aplicado. Recarregando…')
    setTimeout(() => window.location.reload(), 400)
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('Não há') && msg.includes(SQLITE_DRIVE_BACKUP_NAME)) {
      onLog('Nenhum backup nesta pasta ainda — pode usar o app e enviar o backup depois em Sincronizar.')
    } else {
      onLog(msg)
    }
    return false
  }
}
