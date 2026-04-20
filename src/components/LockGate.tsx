import { type FormEvent, type ReactNode, useState } from 'react'
import { motion } from 'framer-motion'
import { isPinConfigured, isSessionUnlocked, tryUnlockWithPin } from '../lib/sessionPin'

/**
 * Envolve toda a aplicação. Enquanto a sessão não estiver destravada, nada
 * do `<App/>` é montado — inclusive rotas diretas (deep-link). Após o acerto,
 * o valor fica em `sessionStorage` e permite navegar livremente até a aba
 * ser fechada.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(() => isSessionUnlocked())
  const [pin, setPin] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!isPinConfigured()) return <>{children}</>
  if (unlocked) return <>{children}</>

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setErr(null)
    setBusy(true)
    try {
      const ok = await tryUnlockWithPin(pin)
      if (ok) {
        setUnlocked(true)
        setPin('')
      } else {
        setErr('PIN incorreto.')
        setPin('')
      }
    } catch {
      setErr('Falha ao validar PIN. Recarregue a página e tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <motion.form
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        onSubmit={(e) => void onSubmit(e)}
        className="glass glow-ring w-full max-w-sm rounded-2xl p-8"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-2">
          Acesso restrito
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-white">My Finance</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Digite o PIN pra entrar. A sessão dura enquanto esta aba estiver aberta.
        </p>
        <label className="mt-6 block text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
          PIN
          <input
            type="password"
            inputMode="text"
            autoComplete="current-password"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            disabled={busy}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-3 text-sm text-white outline-none ring-accent/40 focus:ring-2 disabled:opacity-50"
          />
        </label>
        {err ? <p className="mt-3 text-sm text-danger">{err}</p> : null}
        <button
          type="submit"
          disabled={busy || pin.length === 0}
          className="mt-6 w-full rounded-xl bg-accent py-3 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? 'Verificando…' : 'Entrar'}
        </button>
      </motion.form>
    </div>
  )
}
