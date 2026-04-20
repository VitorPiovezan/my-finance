import { motion } from 'framer-motion'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useFinanceDb } from '../context/useFinanceDb'
import { queryAll, run } from '../lib/db/query'

type BatchRow = {
  id: unknown
  file_name: unknown
  external_ref: unknown
  institution_key: unknown
  row_count: unknown
  billing_month: unknown
  imported_at: unknown
  tx_count: unknown
  account_names: unknown
}

export function ImportacoesPage() {
  const { getDb, touch, persistSoon, version } = useFinanceDb()

  const batches = useMemo(() => {
    const db = getDb()
    return queryAll(
      db,
      `
      SELECT
        b.id,
        b.file_name,
        b.external_ref,
        b.institution_key,
        b.row_count,
        b.billing_month,
        b.imported_at,
        (SELECT COUNT(*) FROM transactions t WHERE t.import_batch_id = b.id) AS tx_count,
        (SELECT group_concat(DISTINCT a.name) FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.import_batch_id = b.id) AS account_names
      FROM import_batches b
      ORDER BY datetime(b.imported_at) DESC
      `,
    ) as BatchRow[]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDb, version])

  const removeBatch = (b: BatchRow) => {
    const id = String(b.id)
    const n = Number(b.tx_count)
    const label = String(b.file_name)
    const ok = window.confirm(
      `Remover só os lançamentos deste extrato?\n\nArquivo: ${label}\nLançamentos no banco: ${n}\n\nContas e categorias não são apagadas. Depois você pode importar o CSV de novo.`,
    )
    if (!ok) return
    const db = getDb()
    run(db, 'DELETE FROM transactions WHERE import_batch_id = ?', [id])
    run(db, 'DELETE FROM import_batches WHERE id = ?', [id])
    touch()
    persistSoon()
  }

  return (
    <div className="space-y-6">
      <header>
        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-semibold tracking-tight text-white"
        >
          Extratos importados
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Cada vez que um CSV entra pelo Drive ou por aqui, fica um <strong className="text-zinc-300">lote</strong> nesta lista.
          Você pode apagar <strong className="text-zinc-300">só aquele extrato</strong> (todas as linhas ligadas a ele), sem mexer em contas ou em outros arquivos. Para zerar tudo, use{' '}
          <span className="text-zinc-300">Apagar dados locais</span> no menu.
        </p>
        <p className="mt-2 text-sm">
          <Link to="/sincronizar" className="text-accent-2 underline decoration-white/20 hover:decoration-accent-2">
            Voltar para Sincronizar
          </Link>
        </p>
      </header>

      <div className="glass overflow-hidden rounded-2xl">
        {batches.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">Nenhum extrato importado ainda.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {batches.map((b, i) => (
              <motion.li
                key={String(b.id)}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.2) }}
                className="flex flex-wrap items-start justify-between gap-4 px-4 py-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-white">{String(b.file_name)}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {new Date(String(b.imported_at)).toLocaleString('pt-BR')} ·{' '}
                    {b.account_names ? String(b.account_names) : '—'} · {String(b.tx_count)} lanç.
                    {b.billing_month ? ` · ref. ${String(b.billing_month)}` : ''}
                    {b.institution_key ? ` · ${String(b.institution_key)}` : ''}
                  </p>
                  <p className="mt-1 break-all font-mono text-[10px] text-zinc-600" title="Referência interna / ID no Drive">
                    {String(b.external_ref).length > 48 ? `${String(b.external_ref).slice(0, 48)}…` : String(b.external_ref)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeBatch(b)}
                  className="shrink-0 rounded-xl border border-danger/40 bg-danger/10 px-4 py-2 text-xs font-medium text-rose-200 hover:bg-danger/20"
                >
                  Remover este extrato
                </button>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
