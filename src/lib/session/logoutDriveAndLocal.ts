import { clearDriveSessionToken } from '../drive/driveTokenSession'

/**
 * Remove o token OAuth do Google nesta aba e apaga o SQLite + IndexedDB (mesmo efeito
 * de «Apagar dados locais»), para forçar novo login em /entrar quando o gate Firebase está ativo.
 */
export async function clearDriveSessionAndAllLocalData(
  clearAllLocalData: () => Promise<void>,
): Promise<void> {
  clearDriveSessionToken()
  await clearAllLocalData()
}
