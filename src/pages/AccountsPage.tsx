import { motion } from 'framer-motion'
import { type FormEvent, useMemo, useState } from 'react'
import { useFinanceDb } from '../context/useFinanceDb'
import { queryAll, run } from '../lib/db/query'
import { newId } from '../lib/id'
import { normalizeInstitutionKey } from '../lib/drive/driveApi'
import { parseBRLToCents } from '../lib/money'

const KINDS = [
  { value: 'checking', label: 'Conta corrente' },
  { value: 'credit', label: 'Cartão de crédito' },
  { value: 'wallet', label: 'Carteira / saldo' },
  { value: 'other', label: 'Outro' },
] as const

const SUGGESTED_KEYS = ['nubank', 'mercado-pago', 'banco-do-brasil', 'santander', 'itau', 'bradesco', 'inter', 'c6']

export function AccountsPage() {
  const { getDb, touch, persistSoon, version, replaceDatabaseFromFile } = useFinanceDb()
  const [name, setName] = useState('')
  const [institutionKey, setInstitutionKey] = useState('')
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('checking')
  const [txAccount, setTxAccount] = useState('')
  const [txAmount, setTxAmount] = useState('')
  const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [txDesc, setTxDesc] = useState('')

  const accounts = useMemo(() => {
    const db = getDb()
    return queryAll(
      db,
      `SELECT id, name, institution_key, kind, color, created_at
       FROM accounts WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDb, version])

  const onCreate = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const db = getDb()
    const id = newId()
    const now = new Date().toISOString()
    const rawKey = institutionKey.trim()
    const keyNorm = rawKey ? normalizeInstitutionKey(rawKey) : null
    run(db, 'INSERT INTO accounts (id, name, institution_key, kind, color, invoice_close_day, created_at) VALUES (?,?,?,?,?,?,?)', [
      id,
      name.trim(),
      keyNorm,
      kind,
      null,
      null,
      now,
    ])
    setName('')
    setInstitutionKey('')
    touch()
    persistSoon()
  }

  const onSoftDelete = (id: string) => {
    const db = getDb()
    run(db, 'UPDATE accounts SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), id])
    touch()
    persistSoon()
  }

  const onRestoreFile = async (f: File | null) => {
    if (!f) return
    await replaceDatabaseFromFile(f)
  }

  const onManualTx = (e: FormEvent) => {
    e.preventDefault()
    const centsIn = parseBRLToCents(txAmount)
    if (!txAccount || centsIn === null || !txDesc.trim()) return
    const cents = centsIn > 0 ? -centsIn : centsIn
    const db = getDb()
    const tid = newId()
    const fp = `manual:${tid}`
    run(
      db,
      `INSERT INTO transactions (id, account_id, category_id, amount_cents, occurred_at, billing_ref_ym, description, source, fingerprint, import_batch_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [tid, txAccount, null, cents, txDate, null, txDesc.trim(), 'manual', fp, null, new Date().toISOString()],
    )
    setTxAmount('')
    setTxDesc('')
    touch()
    persistSoon()
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Contas</h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-400">
          A chave deve bater com a pasta do banco no Drive (ex.: <span className="font-mono text-zinc-300">nubank</span>). Para o layout{' '}
          <span className="font-mono text-zinc-300">…/nubank/cartao</span> e <span className="font-mono">…/nubank/conta</span>, cadastre
          duas contas com a mesma chave: uma tipo <strong className="text-zinc-300">cartão</strong> e outra{' '}
          <strong className="text-zinc-300">corrente/carteira</strong>.
        </p>
      </header>

      <motion.form
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={onCreate}
        className="glass grid gap-4 rounded-2xl p-6 md:grid-cols-2"
      >
        <div className="md:col-span-2">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Nome</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
            placeholder="Ex.: Nubank conta"
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Chave da instituição</label>
          <input
            value={institutionKey}
            onChange={(e) => setInstitutionKey(e.target.value)}
            list="institution-suggestions"
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
            placeholder="nubank"
          />
          <datalist id="institution-suggestions">
            {SUGGESTED_KEYS.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Tipo</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as (typeof KINDS)[number]['value'])}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <button
            type="submit"
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/20 hover:brightness-110"
          >
            Adicionar conta
          </button>
        </div>
      </motion.form>

      <motion.form
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        onSubmit={onManualTx}
        className="glass grid gap-4 rounded-2xl p-6 md:grid-cols-2"
      >
        <div className="md:col-span-2">
          <h2 className="text-sm font-semibold text-white">Lançamento manual</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Informe um valor positivo para registrar uma saída (será gravado como negativo). Use valor negativo para entrada.
          </p>
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Conta</label>
          <select
            required
            value={txAccount}
            onChange={(e) => setTxAccount(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
          >
            <option value="">Selecione…</option>
            {accounts.map((a) => (
              <option key={String(a.id)} value={String(a.id)}>
                {String(a.name)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Data</label>
          <input
            type="date"
            required
            value={txDate}
            onChange={(e) => setTxDate(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Valor (R$)</label>
          <input
            value={txAmount}
            onChange={(e) => setTxAmount(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
            placeholder="120,50"
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Descrição</label>
          <input
            value={txDesc}
            onChange={(e) => setTxDesc(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
            placeholder="Mercado, farmácia…"
            required
          />
        </div>
        <div className="md:col-span-2">
          <button
            type="submit"
            className="rounded-xl border border-white/15 bg-surface-2 px-5 py-2.5 text-sm font-medium text-white hover:bg-surface-3"
          >
            Registrar lançamento
          </button>
        </div>
      </motion.form>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-zinc-300">Cadastradas</h2>
          <label className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
            Substituir banco por arquivo
            <input type="file" accept=".sqlite,application/x-sqlite3,*/*" className="hidden" onChange={(e) => void onRestoreFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <div className="space-y-2">
          {accounts.length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhuma conta ainda.</p>
          ) : (
            accounts.map((a, i) => (
              <motion.div
                key={String(a.id)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="glass flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
              >
                <div>
                  <p className="font-medium text-white">{String(a.name)}</p>
                  <p className="text-xs text-zinc-500">
                    {String(a.kind)} {a.institution_key ? `· ${String(a.institution_key)}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onSoftDelete(String(a.id))}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:border-danger/50 hover:text-danger"
                >
                  Remover (duplicidade)
                </button>
              </motion.div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
