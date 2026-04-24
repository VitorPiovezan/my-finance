import { motion } from 'framer-motion'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useFinanceDb } from '../context/useFinanceDb'
import { loadDriveSessionToken, saveDriveSessionToken } from '../lib/drive/driveTokenSession'
import { driveAccessTokenWorksForFolder } from '../lib/drive/driveTokenProbe'
import {
  DRIVE_OAUTH_FLASH_ERROR_KEY,
  requestDriveAccessToken,
} from '../lib/drive/googleAuth'
import { tryRestoreSqliteFromDriveAfterOAuth } from '../lib/drive/tryRestoreSqliteFromDrive'
import {
  completeGoogleRedirectSignIn,
  ensureFirebaseAuthPersistence,
  isRedirectPendingError,
  signInWithGoogle,
} from '../lib/firebase/authGoogle'
import { fetchDriveUserConfigByEmail, normalizeGoogleAccountEmail } from '../lib/firebase/driveUserConfig'
import { isFirebaseConfigured } from '../lib/firebase/env'
import {
  extractDriveFolderId,
  isLikelyDriveFolderId,
  isLikelyGoogleOauthClientId,
  setDriveOauthClientId,
  setDriveRootFolderId,
  getEffectiveDriveOauthClientIdPreferSession,
} from '../lib/settings/driveFolder'
import { needsNativeAppPinGate, setAppSessionUnlocked } from '../lib/session/appSessionUnlock'
import { clearDriveSessionAndAllLocalData } from '../lib/session/logoutDriveAndLocal'
import {
  getQuickUnlockStoredEmail,
  hasQuickUnlockEnvelope,
  saveQuickUnlockEnvelope,
  tryQuickUnlockWithPin,
} from '../lib/session/pinQuickUnlock'
import { resolvePostLoginNavigatePath } from '../lib/urls/postLoginPath'

type PendingPinSetup = {
  email: string
  clientId: string
  rootFolderId: string
  accessToken: string
  expiresInSec?: number
}

/** Token Drive já obtido no popup do Firebase (`credentialFromResult`). */
type ExistingDriveOAuth = { accessToken: string; expiresInSec?: number }

export function GoogleLoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getDb, touch, persistNow, replaceDatabaseFromFile, clearAllLocalData } = useFinanceDb()
  const clientIdEff = getEffectiveDriveOauthClientIdPreferSession(getDb())
  const driveSessionToken = loadDriveSessionToken(clientIdEff)
  const appPinOnly =
    Boolean(driveSessionToken) &&
    needsNativeAppPinGate(!!driveSessionToken, hasQuickUnlockEnvelope())
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [showPinUnlock, setShowPinUnlock] = useState(false)
  const [pinUnlock, setPinUnlock] = useState('')
  const [pendingPinSetup, setPendingPinSetup] = useState<PendingPinSetup | null>(null)
  const [pinNew, setPinNew] = useState('')
  const [pinNew2, setPinNew2] = useState('')
  const [pinSetupBusy, setPinSetupBusy] = useState(false)

  const registrationOk = Boolean((location.state as { registrationOk?: boolean } | null)?.registrationOk)
  const storedPinEmail = getQuickUnlockStoredEmail()

  const appendLog = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-40), line])
  }, [])

  const finishLogin = useCallback(() => {
    navigate(resolvePostLoginNavigatePath(location.state), { replace: true })
  }, [navigate, location.state])

  const postLoginFrom = (location.state as { from?: string } | null)?.from

  const runDriveLoginForEmail = useCallback(
    async (
      norm: string,
      onLog: (line: string) => void,
      existingDrive?: ExistingDriveOAuth,
    ): Promise<void> => {
      const cfg = await fetchDriveUserConfigByEmail(norm)
      if (!cfg) {
        throw new Error(
          'Este e-mail ainda não está cadastrado. Configure o Client ID e a pasta raiz em «Primeiro acesso».',
        )
      }
      if (!isLikelyGoogleOauthClientId(cfg.clientId)) {
        throw new Error('Registro inválido: Client ID no servidor não parece correto.')
      }
      const rootId = extractDriveFolderId(cfg.driveRootFolderId)
      if (!isLikelyDriveFolderId(rootId)) {
        throw new Error('Registro inválido: ID da pasta raiz não parece correto.')
      }

      const db = getDb()
      setDriveOauthClientId(db, cfg.clientId)
      setDriveRootFolderId(db, rootId)
      touch()
      await persistNow()

      let res: { accessToken: string; expiresInSec?: number }
      const firebaseTok = existingDrive?.accessToken?.trim()
      const firebaseOk =
        firebaseTok != null && (await driveAccessTokenWorksForFolder(firebaseTok, rootId))

      if (firebaseOk) {
        onLog('Usando permissão do Drive do mesmo login Google…')
        res = {
          accessToken: firebaseTok,
          expiresInSec: existingDrive?.expiresInSec,
        }
      } else {
        if (firebaseTok) {
          onLog(
            'O login Google não incluiu escopo do Drive neste ambiente; abrindo permissão com seu Client ID…',
          )
        } else {
          onLog('Abrindo permissão do Google Drive com seu OAuth Client ID…')
        }
        res = await requestDriveAccessToken(cfg.clientId, false, {
          returnHash: '#/entrar',
          source: 'login',
          postLoginFrom,
          loginHint: norm,
        })
      }
      saveDriveSessionToken(cfg.clientId, res.accessToken, res.expiresInSec)
      onLog('Google autorizado. Verificando backup no Drive…')

      const reloading = await tryRestoreSqliteFromDriveAfterOAuth({
        accessToken: res.accessToken,
        rootFolderId: rootId,
        replaceDatabaseFromFile,
        onLog,
      })
      if (reloading) return

      setPendingPinSetup({
        email: norm,
        clientId: cfg.clientId,
        rootFolderId: rootId,
        accessToken: res.accessToken,
        expiresInSec: res.expiresInSec,
      })
    },
    [getDb, touch, persistNow, replaceDatabaseFromFile, postLoginFrom],
  )

  useEffect(() => {
    const msg = sessionStorage.getItem(DRIVE_OAUTH_FLASH_ERROR_KEY)
    if (msg) {
      sessionStorage.removeItem(DRIVE_OAUTH_FLASH_ERROR_KEY)
      setErr(msg)
    }
  }, [])

  useEffect(() => {
    if (appPinOnly) setShowPinUnlock(true)
  }, [appPinOnly])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await ensureFirebaseAuthPersistence()
      try {
        const session = await completeGoogleRedirectSignIn()
        if (cancelled || !session?.user?.email) return
        const norm = normalizeGoogleAccountEmail(session.user.email)
        if (!norm.includes('@')) return
        setBusy(true)
        setErr(null)
        try {
          await runDriveLoginForEmail(
            norm,
            appendLog,
            session.oauthAccessToken
              ? { accessToken: session.oauthAccessToken }
              : undefined,
          )
        } catch (x) {
          setErr(x instanceof Error ? x.message : String(x))
        } finally {
          if (!cancelled) setBusy(false)
        }
      } catch (x) {
        if (!cancelled) setErr(x instanceof Error ? x.message : String(x))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [appendLog, runDriveLoginForEmail])

  const onGoogleClick = () => {
    if (busy || pendingPinSetup) return
    setErr(null)
    if (!isFirebaseConfigured()) {
      setErr('Firebase não está configurado no deploy (VITE_FIREBASE_*).')
      return
    }

    setBusy(true)
    void (async () => {
      try {
        const { user, oauthAccessToken } = await signInWithGoogle()
        const norm = normalizeGoogleAccountEmail(user.email ?? '')
        if (!norm.includes('@')) {
          throw new Error('Sua conta Google não retornou um e-mail válido.')
        }
        await runDriveLoginForEmail(
          norm,
          appendLog,
          oauthAccessToken ? { accessToken: oauthAccessToken } : undefined,
        )
      } catch (x) {
        if (isRedirectPendingError(x)) {
          /* redirect em curso (WebView) */
        } else {
          setErr(x instanceof Error ? x.message : String(x))
        }
      } finally {
        setBusy(false)
      }
    })()
  }

  const onPinUnlockSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (busy || pendingPinSetup) return
    setErr(null)
    setBusy(true)
    void (async () => {
      try {
        const unlocked = await tryQuickUnlockWithPin(pinUnlock)
        if (!unlocked) {
          setErr('PIN incorreto ou sessão salva expirada.')
          return
        }
        const { payload } = unlocked
        const db = getDb()
        setDriveOauthClientId(db, payload.clientId)
        setDriveRootFolderId(db, payload.rootFolderId)
        touch()
        await persistNow()

        const remSec =
          payload.expiresAtMs != null
            ? Math.max(1, Math.round((payload.expiresAtMs - Date.now()) / 1000))
            : undefined
        saveDriveSessionToken(payload.clientId, payload.accessToken, remSec)
        appendLog('PIN aceito. Verificando backup no Drive…')
        const reloading = await tryRestoreSqliteFromDriveAfterOAuth({
          accessToken: payload.accessToken,
          rootFolderId: payload.rootFolderId,
          replaceDatabaseFromFile,
          onLog: appendLog,
        })
        if (!reloading) {
          setAppSessionUnlocked()
          finishLogin()
        }
      } catch (x) {
        setErr(x instanceof Error ? x.message : String(x))
      } finally {
        setBusy(false)
      }
    })()
  }

  const onSkipPinSetup = () => {
    setPendingPinSetup(null)
    setPinNew('')
    setPinNew2('')
    setAppSessionUnlocked()
    finishLogin()
  }

  const onSavePinSetup = (e: FormEvent) => {
    e.preventDefault()
    if (!pendingPinSetup || pinSetupBusy) return
    setErr(null)
    const a = pinNew.trim()
    const b = pinNew2.trim()
    if (a.length < 4) {
      setErr('O PIN deve ter pelo menos 4 caracteres.')
      return
    }
    if (a !== b) {
      setErr('Os dois campos do PIN precisam ser iguais.')
      return
    }
    setPinSetupBusy(true)
    void (async () => {
      try {
        await saveQuickUnlockEnvelope(pendingPinSetup.email, a, {
          clientId: pendingPinSetup.clientId,
          accessToken: pendingPinSetup.accessToken,
          rootFolderId: pendingPinSetup.rootFolderId,
          expiresInSec: pendingPinSetup.expiresInSec,
        })
        setPendingPinSetup(null)
        setPinNew('')
        setPinNew2('')
        setAppSessionUnlocked()
        finishLogin()
      } catch (x) {
        setErr(x instanceof Error ? x.message : String(x))
      } finally {
        setPinSetupBusy(false)
      }
    })()
  }

  const onUseOtherAccount = () => {
    if (busy) return
    setBusy(true)
    void (async () => {
      try {
        await clearDriveSessionAndAllLocalData(clearAllLocalData)
        window.location.reload()
      } catch (x) {
        setErr(x instanceof Error ? x.message : String(x))
        setBusy(false)
      }
    })()
  }

  /* Com token já salvo, entramos direto — exceto PIN opcional ou desbloqueio do app nativo. */
  if (driveSessionToken && !pendingPinSetup && !appPinOnly) {
    return <Navigate to={resolvePostLoginNavigatePath(location.state)} replace />
  }

  if (!isFirebaseConfigured()) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6 text-center text-zinc-400">
        <p>
          O login exige as variáveis <code className="text-zinc-300">VITE_FIREBASE_*</code>. Sem
          Firebase, use a tela Sincronizar para gravar Client ID e pasta raiz no SQLite (ou o fluxo
          de primeiro acesso quando o projeto estiver configurado).
        </p>
      </div>
    )
  }

  if (pendingPinSetup) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-8 p-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass glow-ring w-full max-w-md rounded-2xl p-8"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-2">My Finance</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-white">PIN rápido (opcional)</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Guarde um PIN neste aparelho para desbloquear sem passar pelo Google de novo, enquanto o
            token do Drive for válido. Ou pule e entre normalmente.
          </p>
          {err ? <p className="mt-3 text-sm text-danger">{err}</p> : null}
          <form onSubmit={onSavePinSetup} className="mt-6 space-y-4">
            <label className="block text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
              Novo PIN
              <input
                type="password"
                autoComplete="new-password"
                value={pinNew}
                onChange={(e) => setPinNew(e.target.value)}
                disabled={pinSetupBusy}
                className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-3 text-sm text-white outline-none ring-accent/40 focus:ring-2 disabled:opacity-50"
              />
            </label>
            <label className="block text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
              Confirmar PIN
              <input
                type="password"
                autoComplete="new-password"
                value={pinNew2}
                onChange={(e) => setPinNew2(e.target.value)}
                disabled={pinSetupBusy}
                className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-3 text-sm text-white outline-none ring-accent/40 focus:ring-2 disabled:opacity-50"
              />
            </label>
            <div className="flex flex-col gap-3 pt-2 sm:flex-row-reverse">
              <button
                type="submit"
                disabled={pinSetupBusy}
                className="flex-1 rounded-xl bg-accent py-3 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition hover:brightness-110 disabled:opacity-50"
              >
                {pinSetupBusy ? 'Salvando…' : 'Salvar PIN e entrar'}
              </button>
              <button
                type="button"
                onClick={onSkipPinSetup}
                disabled={pinSetupBusy}
                className="flex-1 rounded-xl border border-white/15 bg-white/5 py-3 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:opacity-50"
              >
                Pular
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass glow-ring w-full max-w-md rounded-2xl p-8"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-2">My Finance</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-white">
          {appPinOnly ? 'Desbloquear o app' : 'Entrar com Google'}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {appPinOnly
            ? 'Você fechou o app ou saiu dele. Digite o PIN deste aparelho para continuar. O PIN não é enviado ao servidor.'
            : 'Use sua conta Google. Validamos se o e-mail está cadastrado e abrimos a permissão do Drive.'}
        </p>
        {registrationOk && !appPinOnly ? (
          <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
            Cadastro concluído. Continue com Google usando o mesmo e-mail.
          </p>
        ) : null}

        {err ? <p className="mt-3 text-sm text-danger">{err}</p> : null}

        {hasQuickUnlockEnvelope() ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
            {!showPinUnlock && !appPinOnly ? (
              <button
                type="button"
                onClick={() => {
                  setShowPinUnlock(true)
                  setErr(null)
                }}
                className="w-full rounded-lg border border-accent-2/40 bg-accent-2/10 py-2.5 text-sm font-medium text-accent-2 transition hover:bg-accent-2/20"
              >
                Entrar com PIN neste aparelho
                {storedPinEmail ? (
                  <span className="mt-1 block text-xs font-normal text-zinc-400">{storedPinEmail}</span>
                ) : null}
              </button>
            ) : (
              <form onSubmit={onPinUnlockSubmit}>
                {!appPinOnly ? (
                  <p className="text-xs text-zinc-500">
                    Desbloqueio local; o PIN não é enviado ao servidor.
                  </p>
                ) : null}
                <label
                  className={`block text-left text-xs font-medium uppercase tracking-wide text-zinc-500 ${appPinOnly ? '' : 'mt-3'}`}
                >
                  PIN
                  <input
                    type="password"
                    autoComplete="current-password"
                    autoFocus
                    value={pinUnlock}
                    onChange={(e) => setPinUnlock(e.target.value)}
                    disabled={busy}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-3 text-sm text-white outline-none ring-accent/40 focus:ring-2 disabled:opacity-50"
                  />
                </label>
                <div className="mt-3 flex gap-2">
                  <button
                    type="submit"
                    disabled={busy || !pinUnlock.trim()}
                    className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/25 disabled:opacity-50"
                  >
                    {busy ? 'Abrindo…' : 'Desbloquear'}
                  </button>
                  {!appPinOnly ? (
                    <button
                      type="button"
                      onClick={() => {
                        setShowPinUnlock(false)
                        setPinUnlock('')
                        setErr(null)
                      }}
                      disabled={busy}
                      className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-zinc-300"
                    >
                      Voltar
                    </button>
                  ) : null}
                </div>
              </form>
            )}
          </div>
        ) : null}

        {appPinOnly ? (
          <p className="mt-6 text-center text-xs text-zinc-500">
            <button
              type="button"
              onClick={onUseOtherAccount}
              disabled={busy}
              className="text-accent-2 underline-offset-4 hover:underline disabled:opacity-50"
            >
              Sair e entrar com outra conta
            </button>
          </p>
        ) : null}

        {!appPinOnly ? (
        <button
          type="button"
          onClick={onGoogleClick}
          disabled={busy}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white py-3 text-sm font-semibold text-zinc-900 shadow-sm transition hover:bg-zinc-100 disabled:opacity-50"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          {busy ? 'Conectando…' : 'Continuar com Google'}
        </button>
        ) : null}

        {!appPinOnly ? (
          <p className="mt-6 text-center text-xs text-zinc-500">
            Primeira vez?{' '}
            <Link to="/primeiro-acesso" className="text-accent-2 underline-offset-4 hover:underline">
              Como configurar o Google e cadastrar
            </Link>
          </p>
        ) : null}
      </motion.div>
      {log.length > 0 ? (
        <div className="glass w-full max-w-md rounded-xl border border-white/10 p-4 text-left text-xs text-zinc-400">
          {log.map((l, i) => (
            <p key={`${i}-${l.slice(0, 12)}`} className="break-words">
              {l}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
