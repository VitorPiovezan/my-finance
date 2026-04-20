import { isSignInWithEmailLink, signInWithEmailLink, signOut } from 'firebase/auth'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearPendingDriveRegistration, writeDriveUserConfigForSignedInUser } from '../lib/firebase/driveUserConfig'
import { getFirebaseAuth } from '../lib/firebase/init'
import { isFirebaseConfigured } from '../lib/firebase/env'
import { extractDriveFolderId } from '../lib/settings/driveFolder'

/**
 * Completa cadastro via link mágico do Firebase Auth e grava `drive_user_configs`.
 * Deve ficar dentro do Router.
 */
export function FirebaseEmailLinkCompletion() {
  const navigate = useNavigate()
  const ran = useRef(false)
  const [overlay, setOverlay] = useState<string | null>(null)

  useEffect(() => {
    if (!isFirebaseConfigured() || ran.current) return
    const auth = getFirebaseAuth()
    const href = window.location.href
    if (!isSignInWithEmailLink(auth, href)) return
    ran.current = true
    void Promise.resolve().then(() => setOverlay('Concluindo cadastro…'))

    void (async () => {
      try {
        let email = ''
        try {
          email = window.localStorage.getItem('emailForSignIn')?.trim() ?? ''
        } catch {
          email = ''
        }
        if (!email) {
          email = window.prompt('Digite o mesmo e-mail que você usou no cadastro:')?.trim() ?? ''
        }
        if (!email) {
          setOverlay(null)
          window.alert('E-mail necessário para concluir o cadastro.')
          navigate('/primeiro-acesso', { replace: true })
          return
        }

        await signInWithEmailLink(auth, email, href)

        const raw = window.localStorage.getItem('mf_pending_drive_reg')
        const pending = raw ? (JSON.parse(raw) as { clientId?: string; driveRootFolderId?: string }) : {}
        const clientId = pending.clientId?.trim() ?? ''
        const driveRootFolderId = extractDriveFolderId(pending.driveRootFolderId ?? '')
        if (!clientId || !driveRootFolderId) {
          await signOut(auth)
          throw new Error(
            'Cadastro incompleto: antes de abrir o link, preencha Client ID e pasta raiz em «Primeiro acesso» e envie o e-mail de novo.',
          )
        }

        await writeDriveUserConfigForSignedInUser({
          email,
          clientId,
          driveRootFolderId,
        })
        await signOut(auth)
        clearPendingDriveRegistration()
        try {
          window.localStorage.removeItem('emailForSignIn')
        } catch {
          /* ignore */
        }

        try {
          const u = new URL(window.location.href)
          u.search = ''
          window.history.replaceState(null, '', u.toString())
        } catch {
          /* ignore */
        }

        navigate('/entrar', { replace: true, state: { registrationOk: true } })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        window.alert(msg)
        navigate('/primeiro-acesso', { replace: true })
      } finally {
        setOverlay(null)
      }
    })()
  }, [navigate])

  if (!overlay) return null
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-6 text-center text-sm text-white">
      <p className="rounded-xl border border-white/15 bg-surface-1 px-6 py-4">{overlay}</p>
    </div>
  )
}
