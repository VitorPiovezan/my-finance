import { motion } from 'framer-motion'
import { type FormEvent, useMemo, useState } from 'react'
import { useFinanceDb } from '../context/useFinanceDb'
import { queryAll, run } from '../lib/db/query'
import { newId } from '../lib/id'

const KINDS = [
  { value: 'expense', label: 'Despesa' },
  { value: 'income', label: 'Receita' },
  { value: 'transfer', label: 'Transferência' },
] as const

export function CategoriesPage() {
  const { getDb, touch, persistSoon, version } = useFinanceDb()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('expense')

  const rows = useMemo(() => {
    const db = getDb()
    return queryAll(db, 'SELECT id, name, kind, created_at FROM categories ORDER BY kind, name')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDb, version])

  const onAdd = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const db = getDb()
    run(db, 'INSERT INTO categories (id, name, kind, created_at) VALUES (?,?,?,?)', [
      newId(),
      name.trim(),
      kind,
      new Date().toISOString(),
    ])
    setName('')
    touch()
    persistSoon()
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Categorias</h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-400">
          Use categorias para classificar lançamentos manuais e futuros. Importações de CSV começam sem categoria.
        </p>
      </header>

      <motion.form
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={onAdd}
        className="glass flex flex-wrap items-end gap-4 rounded-2xl p-6"
      >
        <div className="min-w-[200px] flex-1">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Nome</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
            placeholder="Ex.: Pets"
          />
        </div>
        <div className="w-44">
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
        <button
          type="submit"
          className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/20 hover:brightness-110"
        >
          Nova categoria
        </button>
      </motion.form>

      <section className="glass rounded-2xl p-4">
        <ul className="divide-y divide-white/5">
          {rows.map((c, i) => (
            <motion.li
              key={String(c.id)}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.02 }}
              className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
            >
              <span className="font-medium text-white">{String(c.name)}</span>
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-zinc-400">{String(c.kind)}</span>
            </motion.li>
          ))}
        </ul>
      </section>
    </div>
  )
}
