import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFinanceDb } from '../context/useFinanceDb'
import { saveDriveSessionToken } from '../lib/drive/driveTokenSession'
import {
  DRIVE_OAUTH_FLASH_ERROR_KEY,
  DRIVE_OAUTH_RESULT_KEY,
} from '../lib/drive/googleAuth'
import { tryRestoreSqliteFromDriveAfterOAuth } from '../lib/drive/tryRestoreSqliteFromDrive'
import {
  extractDriveFolderId,
  getEffectiveDriveOauthClientIdPreferSession,
  getEffectiveDriveRootFolderId,
  isLikelyDriveFolderId,
} from '../lib/settings/driveFolder'
import { resolvePostLoginNavigatePath } from '../lib/urls/postLoginPath'

type ResultOk = {
  accessToken: string
  expiresInSec?: number
  source: 'login' | 'sync'
  postLoginFrom?: string
}

type ResultErr = {
  error: string
  errorDescription?: string
  source: 'login' | 'sync'
  postLoginFrom?: string
}

/**
 * Conclui OAuth por redirect (WebView embutido): lê o resultado gravado em main.tsx
 * e aplica token + restauração Drive no login, ou recarrega na sincronizar.
 */
export function DriveOAuthImplicitCompletion() {
  const { getDb, replaceDatabaseFromFile } = useFinanceDb()
  const navigate = useNavigate()

  useEffect(() => {
    const raw = sessionStorage.getItem(DRIVE_OAUTH_RESULT_KEY)
    if (!raw) return
    sessionStorage.removeItem(DRIVE_OAUTH_RESULT_KEY)

    let data: ResultOk | ResultErr
    try {
      data = JSON.parse(raw) as ResultOk | ResultErr
    } catch {
      return
    }

    if ('error' in data && data.error) {
      sessionStorage.setItem(
        DRIVE_OAUTH_FLASH_ERROR_KEY,
        data.errorDescription ?? data.error,
      )
      return
    }

    const ok = data as ResultOk
    if (!ok.accessToken) return

    const clientId = getEffectiveDriveOauthClientIdPreferSession(getDb())
    if (!clientId) {
      sessionStorage.setItem(
        DRIVE_OAUTH_FLASH_ERROR_KEY,
        'Client ID não encontrado após o retorno do Google. Abra Entrar e tente de novo.',
      )
      return
    }

    saveDriveSessionToken(clientId, ok.accessToken, ok.expiresInSec)

    if (ok.source === 'sync') {
      window.setTimeout(() => window.location.reload(), 50)
      return
    }

    void (async () => {
      const folderRaw = getEffectiveDriveRootFolderId(getDb())
      const rid = extractDriveFolderId(folderRaw)
      if (!isLikelyDriveFolderId(rid)) {
        navigate(resolvePostLoginNavigatePath({ from: ok.postLoginFrom }), { replace: true })
        return
      }
      try {
        const reloading = await tryRestoreSqliteFromDriveAfterOAuth({
          accessToken: ok.accessToken,
          rootFolderId: rid,
          replaceDatabaseFromFile,
          onLog: () => {},
        })
        if (!reloading) {
          navigate(resolvePostLoginNavigatePath({ from: ok.postLoginFrom }), { replace: true })
        }
      } catch {
        navigate(resolvePostLoginNavigatePath({ from: ok.postLoginFrom }), { replace: true })
      }
    })()
  }, [getDb, navigate, replaceDatabaseFromFile])

  return null
}
