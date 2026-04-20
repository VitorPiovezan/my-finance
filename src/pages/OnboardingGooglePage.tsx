import { motion } from 'framer-motion'
import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useFinanceDb } from '../context/useFinanceDb'
import { loadDriveSessionToken } from '../lib/drive/driveTokenSession'
import { sendSignInLinkToEmail } from 'firebase/auth'
import {
  normalizeGoogleAccountEmail,
  savePendingDriveRegistration,
} from '../lib/firebase/driveUserConfig'
import { getFirebaseAuth } from '../lib/firebase/init'
import { isFirebaseConfigured } from '../lib/firebase/env'
import {
  extractDriveFolderId,
  isLikelyDriveFolderId,
  isLikelyGoogleOauthClientId,
  getEffectiveDriveOauthClientIdPreferSession,
} from '../lib/settings/driveFolder'
import { resolvePostLoginNavigatePath } from '../lib/urls/postLoginPath'
import { getPublicAppBaseUrl, getPublicAppOrigin } from '../lib/urls/publicAppUrl'

export function OnboardingGooglePage() {
  const { getDb } = useFinanceDb()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [clientId, setClientId] = useState('')
  const [folderRaw, setFolderRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const origin = useMemo(() => getPublicAppOrigin(), [])
  const appBase = useMemo(() => getPublicAppBaseUrl(), [])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setErr(null)
    if (!isFirebaseConfigured()) {
      setErr('Firebase não configurado no deploy.')
      return
    }

    const norm = normalizeGoogleAccountEmail(email)
    if (!norm.includes('@')) {
      setErr('Informe o e-mail Google correto.')
      return
    }
    const cid = clientId.trim()
    if (!isLikelyGoogleOauthClientId(cid)) {
      setErr('O OAuth Client ID deve terminar em .apps.googleusercontent.com')
      return
    }
    const folderId = extractDriveFolderId(folderRaw)
    if (!isLikelyDriveFolderId(folderId)) {
      setErr('Cole o link da pasta do Drive ou o ID (trecho após /folders/).')
      return
    }

    setBusy(true)
    void (async () => {
      try {
        savePendingDriveRegistration({
          clientId: cid,
          driveRootFolderId: folderId,
        })
        try {
          window.localStorage.setItem('emailForSignIn', norm)
        } catch {
          /* ignore */
        }

        const auth = getFirebaseAuth()
        const actionCodeSettings = {
          url: appBase,
          handleCodeInApp: true,
        }
        await sendSignInLinkToEmail(auth, norm, actionCodeSettings)
        setSent(true)
      } catch (x) {
        setErr(x instanceof Error ? x.message : String(x))
      } finally {
        setBusy(false)
      }
    })()
  }

  if (!isFirebaseConfigured()) {
    return (
      <div className="mx-auto flex min-h-svh max-w-lg items-center justify-center p-6 text-center text-zinc-400">
        <p>
          Cadastro na nuvem exige <code className="text-zinc-300">VITE_FIREBASE_*</code> no build. Veja
          `FIREBASE_SETUP.md` no repositório.
        </p>
      </div>
    )
  }

  if (loadDriveSessionToken(getEffectiveDriveOauthClientIdPreferSession(getDb()))) {
    return <Navigate to={resolvePostLoginNavigatePath(location.state)} replace />
  }

  if (sent) {
    return (
      <div className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-6 p-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass glow-ring rounded-2xl p-8 text-center"
        >
          <h1 className="text-lg font-semibold text-white">Verifique seu e-mail</h1>
          <p className="mt-3 text-sm text-zinc-400">
            Enviamos um link para <strong className="text-zinc-200">{email.trim()}</strong>. Abra na
            mesma faixa onde você cadastrou (o link confirma o e-mail e grava Client ID + pasta raiz no
            Firebase).
          </p>
          <p className="mt-4 text-xs text-zinc-500">
            Não feche o armazenamento do site entre enviar e clicar — se limpar dados do site antes de
            abrir o link, faça o cadastro de novo.
          </p>
          <Link
            to="/entrar"
            className="mt-8 inline-block rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/25"
          >
            Voltar para o login
          </Link>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="mx-auto min-h-svh max-w-2xl px-4 py-10">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-2">Primeiro acesso</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
          Configurar Google OAuth e pasta no Drive
        </h1>
        <p className="mt-3 text-sm text-zinc-400">
          Você precisa de um projeto no Google Cloud, um OAuth 2.0 Client ID (tipo Web) e uma pasta no
          Google Drive. Use os valores deste site (abaixo) nas telas do Google — costuma levar até{' '}
          <strong className="text-zinc-300">5 minutos</strong> para propagar depois de salvar.
        </p>

        <section className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-300">
          <h2 className="text-base font-semibold text-white">1. Google Cloud Console</h2>
          <ol className="list-decimal space-y-2 pl-5">
            <li>Crie um projeto (ou use um existente).</li>
            <li>
              APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth → Aplicação da Web.
            </li>
            <li>
              Em <strong className="text-white">Origens JavaScript autorizadas</strong>, adicione
              exatamente:
              <code className="mt-1 block break-all rounded-lg bg-black/40 px-3 py-2 text-xs text-accent-2">
                {origin}
              </code>
            </li>
            <li>
              Em <strong className="text-white">URIs de redirecionamento autorizados</strong>, adicione
              a URL base do app (com <code className="text-zinc-200">https</code> e barra final se o
              console pedir):
              <code className="mt-1 block break-all rounded-lg bg-black/40 px-3 py-2 text-xs text-accent-2">
                {appBase}
              </code>
            </li>
            <li>
              Tela de consentimento OAuth: em modo de teste, adicione seu e-mail em{' '}
              <strong className="text-white">Usuários de teste</strong> — só eles conseguem concluir o
              fluxo até você publicar o app.
            </li>
          </ol>
        </section>

        <section className="mt-6 text-xs text-zinc-500">
          <p>
            Origem atual calculada pelo navegador: <code className="text-zinc-400">{origin}</code> · Base:{' '}
            <code className="text-zinc-400">{appBase}</code>
          </p>
        </section>

        <form onSubmit={onSubmit} className="glass glow-ring mt-8 space-y-4 rounded-2xl p-8">
          <h2 className="text-base font-semibold text-white">2. Cadastrar neste app</h2>
          <p className="text-sm text-zinc-400">
            Após enviar, você recebe um e-mail com link. Abrir o link confirma o e-mail e grava Client ID
            + pasta raiz no Firestore (protegido pelo login do próprio Firebase).
          </p>
          <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
            E-mail Google (o mesmo dos testes, se o app OAuth estiver em modo teste)
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-3 text-sm text-white outline-none ring-accent/40 focus:ring-2"
            />
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
            OAuth 2.0 Client ID (Web)
            <input
              type="text"
              required
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="123456-abc.apps.googleusercontent.com"
              className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-3 text-sm text-white outline-none ring-accent/40 focus:ring-2"
            />
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
            Pasta raiz no Drive (link ou ID)
            <input
              type="text"
              required
              value={folderRaw}
              onChange={(e) => setFolderRaw(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/…"
              className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-3 text-sm text-white outline-none ring-accent/40 focus:ring-2"
            />
          </label>
          {err ? <p className="text-sm text-danger">{err}</p> : null}
          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <Link to="/entrar" className="text-center text-sm text-zinc-500 hover:text-zinc-300">
              Já tenho cadastro → voltar ao login
            </Link>
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-accent/25 disabled:opacity-50"
            >
              {busy ? 'Enviando…' : 'Enviar link de confirmação por e-mail'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
