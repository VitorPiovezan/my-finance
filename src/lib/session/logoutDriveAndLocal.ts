import { clearDriveSessionToken } from '../drive/driveTokenSession'
import { signOutFirebase } from '../firebase/authGoogle'
import { clearAppSessionUnlock } from './appSessionUnlock'
import { clearQuickUnlockEnvelope } from './pinQuickUnlock'

/**
 * Remove o token OAuth do Google nesta aba e apaga o SQLite + IndexedDB (mesmo efeito
 * de «Apagar dados locais»), para forçar novo login em /entrar quando o gate Firebase está ativo.
 */
export async function clearDriveSessionAndAllLocalData(
  clearAllLocalData: () => Promise<void>,
): Promise<void> {
  clearDriveSessionToken()
  clearAppSessionUnlock()
  clearQuickUnlockEnvelope()
  await signOutFirebase()
  await clearAllLocalData()
}
