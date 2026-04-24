import { motion } from 'framer-motion'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useFinanceDb } from '../context/useFinanceDb'
import { loadDriveSessionToken, saveDriveSessionToken } from '../lib/drive/driveTokenSession'
import {
  DRIVE_OAUTH_FLASH_ERROR_KEY,
  requestDriveAccessToken,
} from '../lib/drive/googleAuth'
import { tryRestoreSqliteFromDriveAfterOAuth } from '../lib/drive/tryRestoreSqliteFromDrive'
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
import { resolvePostLoginNavigatePath } from '../lib/urls/postLoginPath'

export function GoogleLoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getDb, touch, persistNow, replaceDatabaseFromFile } = useFinanceDb()
  const [email, setEmail] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])

  const registrationOk = Boolean((location.state as { registrationOk?: boolean } | null)?.registrationOk)

  useEffect(() => {
    const msg = sessionStorage.getItem(DRIVE_OAUTH_FLASH_ERROR_KEY)
    if (msg) {
      sessionStorage.removeItem(DRIVE_OAUTH_FLASH_ERROR_KEY)
      setErr(msg)
    }
  }, [])

  const appendLog = (line: string) => {
    setLog((prev) => [...prev.slice(-40), line])
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setErr(null)
    if (!isFirebaseConfigured()) {
      setErr('Firebase não está configurado no deploy (VITE_FIREBASE_*).')
      return
    }

    const norm = normalizeGoogleAccountEmail(email)
    if (!norm.includes('@')) {
      setErr('Informe um e-mail Google válido.')
      return
    }

    setBusy(true)
    void (async () => {
      try {
        const cfg = await fetchDriveUserConfigByEmail(norm)
        if (!cfg) {
          setErr(
            'Este e-mail ainda não está cadastrado. Configure o Client ID e a pasta raiz em «Primeiro acesso».',
          )
          return
        }
        if (!isLikelyGoogleOauthClientId(cfg.clientId)) {
          setErr('Registro inválido: Client ID no servidor não parece correto.')
          return
        }
        const rootId = extractDriveFolderId(cfg.driveRootFolderId)
        if (!isLikelyDriveFolderId(rootId)) {
          setErr('Registro inválido: ID da pasta raiz não parece correto.')
          return
        }

        const db = getDb()
        setDriveOauthClientId(db, cfg.clientId)
        setDriveRootFolderId(db, rootId)
        touch()
        await persistNow()

        appendLog('Abrindo login do Google com seu OAuth Client ID…')
        const res = await requestDriveAccessToken(cfg.clientId, true, {
          returnHash: '#/entrar',
          source: 'login',
          postLoginFrom: (location.state as { from?: string } | null)?.from,
        })
        saveDriveSessionToken(cfg.clientId, res.accessToken, res.expiresInSec)
        appendLog('Google autorizado. Verificando backup no Drive…')

        const reloading = await tryRestoreSqliteFromDriveAfterOAuth({
          accessToken: res.accessToken,
          rootFolderId: rootId,
          replaceDatabaseFromFile,
          onLog: appendLog,
        })
        if (!reloading) {
          navigate(resolvePostLoginNavigatePath(location.state), { replace: true })
        }
      } catch (x) {
        setErr(x instanceof Error ? x.message : String(x))
      } finally {
        setBusy(false)
      }
    })()
  }

  const driveSessionToken = loadDriveSessionToken(
    getEffectiveDriveOauthClientIdPreferSession(getDb()),
  )
  if (driveSessionToken) {
    return <Navigate to={resolvePostLoginNavigatePath(location.state)} replace />
  }

  if (!isFirebaseConfigured()) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6 text-center text-zinc-400">
        <p>
          O login por e-mail exige as variáveis{' '}
          <code className="text-zinc-300">VITE_FIREBASE_*</code>. Sem Firebase, use a tela Sincronizar
          para gravar Client ID e pasta raiz no SQLite (ou o fluxo de primeiro acesso quando o
          projeto estiver configurado).
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 p-6">
      <motion.form
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={onSubmit}
        className="glass glow-ring w-full max-w-md rounded-2xl p-8"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-2">My Finance</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-white">Entrar com Google</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Digite o mesmo e-mail da sua conta Google cadastrada. Vamos usar o Client ID e a pasta raiz
          salvos para você.
        </p>
        {registrationOk ? (
          <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
            Cadastro concluído. Faça login com o e-mail abaixo.
          </p>
        ) : null}
        <label className="mt-6 block text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
          E-mail Google
          <input
            type="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-3 text-sm text-white outline-none ring-accent/40 focus:ring-2 disabled:opacity-50"
          />
        </label>
        {err ? <p className="mt-3 text-sm text-danger">{err}</p> : null}
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="mt-6 w-full rounded-xl bg-accent py-3 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? 'Conectando…' : 'Acessar'}
        </button>
        <p className="mt-6 text-center text-xs text-zinc-500">
          Primeira vez?{' '}
          <Link to="/primeiro-acesso" className="text-accent-2 underline-offset-4 hover:underline">
            Como configurar o Google e cadastrar
          </Link>
        </p>
      </motion.form>
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
