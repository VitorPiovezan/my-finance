import { motion } from 'framer-motion'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useFinanceDb } from '../context/useFinanceDb'
import {
  DEFAULT_GEMINI_MODEL,
  clearGeminiApiKey,
  getGeminiApiKey,
  getGeminiModel,
  setGeminiApiKey,
  setGeminiModel,
} from '../lib/ai/settings'

function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '•'.repeat(key.length)
  return `${key.slice(0, 4)}${'•'.repeat(Math.max(4, key.length - 8))}${key.slice(-4)}`
}

export function ConfigIaPage() {
  const { getDb, touch, persistSoon, version } = useFinanceDb()

  // Lazy init lê do banco; nos re-renders após mutação (`version` muda),
  // o `storedKey`/`storedModel` abaixo pegam o estado atualizado.
  const [apiKey, setApiKey] = useState<string>(() => getGeminiApiKey(getDb()))
  const [model, setModel] = useState<string>(() => getGeminiModel(getDb()))
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [show, setShow] = useState(false)

  const storedKey = getGeminiApiKey(getDb())
  const storedModel = getGeminiModel(getDb())
  // Sinaliza o uso da dependência `version` pra lints de exhaustive-deps.
  void version

  const save = () => {
    const db = getDb()
    setGeminiApiKey(db, apiKey)
    setGeminiModel(db, model)
    touch()
    persistSoon()
    setSavedAt(Date.now())
  }

  const clear = () => {
    const db = getDb()
    clearGeminiApiKey(db)
    touch()
    persistSoon()
    setApiKey('')
    setSavedAt(Date.now())
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2">
        <Link to="/" className="inline-flex w-fit items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <span aria-hidden="true">←</span> Voltar
        </Link>
        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-semibold tracking-tight text-white"
        >
          Configurar IA (Google Gemini)
        </motion.h1>
        <p className="max-w-2xl text-sm text-zinc-400">
          Use uma chave do <strong className="text-zinc-300">Google Gemini</strong> para categorizar automaticamente os lançamentos sem categoria. A chave fica salva no <strong className="text-zinc-300">banco local (SQLite)</strong> — só neste navegador, acompanhando o backup <code className="rounded bg-surface-2 px-1.5 py-0.5">.sqlite</code>. Pegue a sua em{' '}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            className="text-accent-2 underline underline-offset-2 hover:no-underline"
          >
            aistudio.google.com/app/apikey
          </a>
          .
        </p>
      </header>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass space-y-5 rounded-2xl p-5"
      >
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="ai-key">
            Chave do Gemini
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="ai-key"
              type={show ? 'text' : 'password'}
              value={apiKey}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="flex-1 rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="rounded-xl border border-white/10 bg-surface-2 px-3 py-2 text-xs text-zinc-300 hover:bg-surface-3"
            >
              {show ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            {storedKey
              ? `Chave salva no banco local: ${maskKey(storedKey)}`
              : 'Nenhuma chave configurada ainda.'}
          </p>
        </div>

        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="ai-model">
            Modelo
          </label>
          <input
            id="ai-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={DEFAULT_GEMINI_MODEL}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
          />
          <p className="mt-2 text-[11px] text-zinc-500">
            Em uso:{' '}
            <code className="rounded bg-surface-2 px-1.5 py-0.5">{storedModel}</code>. Sugestões:{' '}
            <code className="rounded bg-surface-2 px-1.5 py-0.5">gemini-2.5-flash</code>,{' '}
            <code className="rounded bg-surface-2 px-1.5 py-0.5">gemini-2.0-flash</code>,{' '}
            <code className="rounded bg-surface-2 px-1.5 py-0.5">gemini-1.5-flash</code>,{' '}
            <code className="rounded bg-surface-2 px-1.5 py-0.5">gemini-1.5-pro</code>.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={save}
            className="rounded-xl bg-accent/20 px-4 py-2 text-sm font-medium text-accent-2 ring-1 ring-accent/30 hover:bg-accent/25"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={clear}
            className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-rose-200 hover:bg-danger/20"
          >
            Remover chave do banco
          </button>
          {savedAt ? (
            <span className="self-center text-[11px] text-zinc-500">Atualizado {new Date(savedAt).toLocaleTimeString('pt-BR')}</span>
          ) : null}
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass rounded-2xl p-5 text-sm text-zinc-400"
      >
        <h2 className="text-sm font-semibold text-zinc-200">Como funciona</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li>Abra a tela <strong className="text-zinc-200">Categorizar</strong> ou uma análise e clique em <strong className="text-zinc-200">Categorizar com IA</strong>.</li>
          <li>Enviamos para o Gemini só os lançamentos <strong className="text-zinc-200">sem categoria</strong> do recorte atual (descrição, valor, conta). Nenhum servidor intermediário vê esses dados.</li>
          <li>A resposta é aplicada como sugestão automática; você pode reverter manualmente em <Link to="/lancamentos" className="text-accent-2 hover:underline">Lançamentos</Link>.</li>
        </ul>
        <p className="mt-3 text-[11px] text-zinc-500">
          A chave fica só neste navegador, gravada no SQLite local. Ao exportar o banco ela vai junto no arquivo <code className="rounded bg-surface-2 px-1.5 py-0.5">.sqlite</code> — guarde com cuidado.
        </p>
      </motion.section>
    </div>
  )
}
