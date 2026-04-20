import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { AiCategorizeButton } from '../components/AiCategorizeButton'
import {
  CATEGORY_PALETTE,
  DonutChart,
  colorForCategoryId,
  type DonutSlice,
} from '../components/DonutChart'
import { useFinanceDb } from '../context/useFinanceDb'
import { queryAll, run } from '../lib/db/query'
import {
  buildDescriptionIndex,
  suggestCategory,
  type DescriptionIndex,
} from '../lib/learning/descriptionIndex'
import { formatBRL } from '../lib/money'
import {
  getAnalysisSummary,
  getInflowByCategory,
  getOutflowByCategory,
  getTransactionsByCategory,
  type AnalysisFilter,
  type CategoryBreakdown,
  type TopTransaction,
} from '../lib/queries/analysis'
import { SQL_EFFECTIVE_SPEND_MONTH } from '../lib/queries/effectiveSpendMonth'
import { listInvestments, type Investment } from '../lib/queries/investments'
import { ymNow } from '../lib/queries/spendSummary'

const STORAGE_KEY = 'categorize-page-filters'
const UNCAT_KEY = '__uncat__'

type AccountRow = {
  id: string
  name: string
  kind: 'checking' | 'credit' | 'wallet' | 'other' | string
}

type TxRow = {
  id: string
  occurred_at: string
  description: string
  amount_cents: number
  category_id: string | null
  category_kind: string | null
  category_name: string | null
  account_name: string
  account_kind: string
  source: string
  investment_id: string | null
}

function monthChoices(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = []
  const d = new Date()
  for (let i = 0; i < 36; i++) {
    const dt = new Date(d.getFullYear(), d.getMonth() - i, 1)
    const v = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
    const label = dt.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    out.push({ value: v, label: label.charAt(0).toUpperCase() + label.slice(1) })
  }
  return out
}

function formatYmLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const dt = new Date(y, m - 1, 1)
  const label = dt.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

type ScopeShortcut = 'all' | 'contas' | 'cartao'

function loadStoredFilters(): {
  accountId: string
  ym: string
  scopeShortcut: ScopeShortcut
} {
  const fallback = { accountId: '', ym: ymNow(), scopeShortcut: 'all' as ScopeShortcut }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return fallback
    const accountId = typeof parsed.accountId === 'string' ? parsed.accountId : ''
    const ym =
      typeof parsed.ym === 'string' && /^\d{4}-\d{2}$/.test(parsed.ym) ? parsed.ym : ymNow()
    const scope =
      parsed.scopeShortcut === 'contas' || parsed.scopeShortcut === 'cartao'
        ? (parsed.scopeShortcut as ScopeShortcut)
        : 'all'
    return { accountId, ym, scopeShortcut: scope }
  } catch {
    return fallback
  }
}

function KpiCard({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string
  value: string
  tone?: 'neutral' | 'rose' | 'emerald' | 'amber'
  hint?: string
}) {
  const color =
    tone === 'rose'
      ? 'text-rose-200'
      : tone === 'emerald'
        ? 'text-emerald-200'
        : tone === 'amber'
          ? 'text-amber-200'
          : 'text-white'
  return (
    <div className="glass rounded-2xl p-5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${color}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  )
}

function CategoryLegend({
  items,
  total,
  tone,
  expandedKey,
  onToggle,
  expandedTransactions,
  emptyMessage,
}: {
  items: (CategoryBreakdown & { color: string })[]
  total: number
  tone: 'out' | 'in'
  expandedKey: string | null
  onToggle: (categoryId: string | null) => void
  expandedTransactions: TopTransaction[]
  emptyMessage: string
}) {
  if (items.length === 0) {
    return <p className="text-sm text-zinc-500">{emptyMessage}</p>
  }
  const amountColor = tone === 'in' ? 'text-emerald-200' : 'text-rose-200'
  return (
    <ul className="divide-y divide-white/5">
      {items.map((it) => {
        const pct = total > 0 ? (it.cents / total) * 100 : 0
        const key = it.categoryId ?? UNCAT_KEY
        const isOpen = expandedKey === key
        return (
          <li key={key} className="min-w-0">
            <button
              type="button"
              onClick={() => onToggle(it.categoryId)}
              aria-expanded={isOpen}
              className={[
                'flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left transition',
                'hover:bg-white/5 focus:bg-white/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40',
                isOpen ? 'bg-white/5' : '',
              ].join(' ')}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: it.color }}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-100">{it.categoryName}</p>
                  <p className="text-[11px] text-zinc-500">
                    {it.count} {it.count === 1 ? 'lançamento' : 'lançamentos'} · {pct.toFixed(1)}%
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <p className="whitespace-nowrap font-semibold tabular-nums text-zinc-100">
                  {formatBRL(it.cents)}
                </p>
                <span
                  aria-hidden="true"
                  className={[
                    'text-zinc-500 transition-transform',
                    isOpen ? 'rotate-90 text-zinc-300' : '',
                  ].join(' ')}
                >
                  ›
                </span>
              </div>
            </button>
            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.div
                  key={`${key}-panel`}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mb-2 ml-5 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    {expandedTransactions.length === 0 ? (
                      <p className="text-xs text-zinc-500">Sem lançamentos nesta categoria.</p>
                    ) : (
                      <ul className="divide-y divide-white/5">
                        {expandedTransactions.map((t) => (
                          <li key={t.id} className="flex items-start justify-between gap-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm text-zinc-100" title={t.description}>
                                {t.description}
                              </p>
                              <p className="mt-0.5 text-[11px] text-zinc-500">
                                {t.occurredAt.slice(0, 10)} · {t.accountName}
                              </p>
                            </div>
                            <p
                              className={`shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums ${amountColor}`}
                            >
                              {formatBRL(Math.abs(t.amountCents))}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </li>
        )
      })}
    </ul>
  )
}

export function CategorizePage() {
  const { getDb, touch, persistSoon, version } = useFinanceDb()

  // Inicialização única: respeita a preferência salva (conta + mês + atalho de escopo).
  // Sem mais effects ajustando esses valores depois — o usuário controla explicitamente.
  const [accountId, setAccountId] = useState<string>(() => loadStoredFilters().accountId)
  const [scopeShortcut, setScopeShortcut] = useState<ScopeShortcut>(
    () => loadStoredFilters().scopeShortcut,
  )
  const [ym, setYm] = useState<string>(() => loadStoredFilters().ym)
  const [expandedOut, setExpandedOut] = useState<string | null>(null)

  const accounts = useMemo<AccountRow[]>(() => {
    const db = getDb()
    return queryAll(
      db,
      `SELECT id, name, kind FROM accounts WHERE deleted_at IS NULL ORDER BY kind, name`,
    ).map((r) => ({ id: String(r.id), name: String(r.name), kind: String(r.kind) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida leituras após mutações no SQLite
  }, [getDb, version])

  const categories = useMemo(() => {
    const db = getDb()
    return queryAll(db, 'SELECT id, name, kind FROM categories ORDER BY kind, name').map((r) => ({
      id: String(r.id),
      name: String(r.name),
      kind: String(r.kind),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida leituras após mutações no SQLite
  }, [getDb, version])

  const investments = useMemo<Investment[]>(
    () => listInvestments(getDb(), false),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida leituras após mutações no SQLite
    [getDb, version],
  )

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ accountId, ym, scopeShortcut }),
      )
    } catch {
      /* ignore */
    }
  }, [accountId, ym, scopeShortcut])

  const filter = useMemo<AnalysisFilter>(() => {
    if (accountId) return { accountId }
    if (scopeShortcut === 'contas') return { scope: 'contas' }
    if (scopeShortcut === 'cartao') return { scope: 'cartao' }
    return {}
  }, [accountId, scopeShortcut])

  const filterLabel = useMemo(() => {
    if (accountId) {
      const a = accounts.find((x) => x.id === accountId)
      return a ? `${a.name} (${a.kind})` : 'Conta'
    }
    if (scopeShortcut === 'contas') return 'Todas as contas não-cartão'
    if (scopeShortcut === 'cartao') return 'Todos os cartões'
    return 'Todas as contas'
  }, [accountId, scopeShortcut, accounts])

  const data = useMemo(() => {
    const db = getDb()
    return {
      summary: getAnalysisSummary(db, ym, filter),
      outflow: getOutflowByCategory(db, ym, filter),
      inflow: getInflowByCategory(db, ym, filter),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida leituras após mutações no SQLite
  }, [getDb, version, filter, ym])

  const outflowSliced = useMemo<(CategoryBreakdown & { color: string })[]>(
    () =>
      data.outflow.map((c, i) => ({ ...c, color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] })),
    [data.outflow],
  )

  const inflowSliced = useMemo<(CategoryBreakdown & { color: string })[]>(
    () =>
      data.inflow.map((c, i) => ({ ...c, color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] })),
    [data.inflow],
  )

  const expandedOutTx = useMemo<TopTransaction[]>(() => {
    if (expandedOut == null) return []
    const db = getDb()
    const categoryId = expandedOut === UNCAT_KEY ? null : expandedOut
    return getTransactionsByCategory(db, ym, filter, categoryId, 'out', 200)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida leituras após mutações no SQLite
  }, [getDb, version, filter, ym, expandedOut])

  // Lista completa de lançamentos pra edição inline (categorizados + não).
  const rows = useMemo<TxRow[]>(() => {
    const db = getDb()
    const parts: string[] = ['a.deleted_at IS NULL']
    const params: (string | number)[] = []
    if (accountId) {
      parts.push('t.account_id = ?')
      params.push(accountId)
    } else if (scopeShortcut === 'cartao') {
      parts.push("a.kind = 'credit'")
    } else if (scopeShortcut === 'contas') {
      parts.push("a.kind != 'credit'")
    }
    parts.push(`(${SQL_EFFECTIVE_SPEND_MONTH}) = ?`)
    params.push(ym)
    const where = parts.join(' AND ')
    const sql = `
      SELECT
        t.id, t.occurred_at, t.description, t.amount_cents,
        t.category_id, t.investment_id, t.source,
        a.name AS account_name, a.kind AS account_kind,
        c.name AS category_name,
        c.kind AS category_kind
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE ${where}
      ORDER BY
        CASE WHEN t.category_id IS NULL THEN 0 ELSE 1 END,
        t.occurred_at DESC,
        t.id DESC
      LIMIT 1000
    `
    return queryAll(db, sql, params).map((r) => ({
      id: String(r.id),
      occurred_at: String(r.occurred_at),
      description: String(r.description ?? ''),
      amount_cents: Number(r.amount_cents ?? 0),
      category_id: r.category_id ? String(r.category_id) : null,
      category_kind: r.category_kind ? String(r.category_kind) : null,
      category_name: r.category_name ? String(r.category_name) : null,
      account_name: String(r.account_name ?? ''),
      account_kind: String(r.account_kind ?? ''),
      source: String(r.source ?? ''),
      investment_id: r.investment_id ? String(r.investment_id) : null,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida leituras após mutações no SQLite
  }, [getDb, version, accountId, scopeShortcut, ym])

  const suggestionIndex = useMemo<DescriptionIndex>(
    () => buildDescriptionIndex(getDb()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida leituras após mutações no SQLite
    [getDb, version],
  )

  const uncatCount = useMemo(() => rows.reduce((acc, r) => acc + (r.category_id ? 0 : 1), 0), [rows])

  const onCategoryChange = (txId: string, value: string) => {
    const db = getDb()
    const chosen = categories.find((c) => c.id === value)
    const chosenKind = chosen?.kind ?? ''
    const keepsInvestment =
      chosenKind === 'investment_in' || chosenKind === 'investment_out'
    if (keepsInvestment) {
      run(db, 'UPDATE transactions SET category_id = ? WHERE id = ?', [value || null, txId])
    } else {
      run(
        db,
        'UPDATE transactions SET category_id = ?, investment_id = NULL WHERE id = ?',
        [value || null, txId],
      )
    }
    touch()
    persistSoon()
  }

  const onInvestmentChange = (txId: string, value: string) => {
    const db = getDb()
    run(db, 'UPDATE transactions SET investment_id = ? WHERE id = ?', [value || null, txId])
    touch()
    persistSoon()
  }

  const toggleOut = (id: string | null) => {
    const k = id ?? UNCAT_KEY
    setExpandedOut((prev) => (prev === k ? null : k))
  }

  const months = useMemo(() => monthChoices(), [])
  const outflowTotal = data.summary.outflowCents
  const inflowTotal = data.summary.inflowCents

  const slices: DonutSlice[] = outflowSliced.map((c) => ({
    id: c.categoryId ?? 'uncat',
    label: c.categoryName,
    value: c.cents,
    color: c.color,
  }))

  return (
    <div className="space-y-6">
      <header>
        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-semibold tracking-tight text-white"
        >
          Categorizar
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Escolha a <strong className="text-zinc-300">conta</strong> e o{' '}
          <strong className="text-zinc-300">mês</strong> pra ver a distribuição por categoria e
          categorizar (manualmente ou com a IA) em um lugar só. O seletor lembra da sua última
          escolha.
        </p>
      </header>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass space-y-4 rounded-2xl p-5"
      >
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px] flex-1">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Conta
            </label>
            <select
              value={accountId}
              onChange={(e) => {
                const v = e.target.value
                setAccountId(v)
                if (v) setScopeShortcut('all')
              }}
              className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
            >
              <option value="">— escolha um atalho abaixo —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.kind})
                </option>
              ))}
            </select>
            <div className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  { id: 'all', label: 'Todas' },
                  { id: 'contas', label: 'Todas não-cartão' },
                  { id: 'cartao', label: 'Todos os cartões' },
                ] as { id: ScopeShortcut; label: string }[]
              ).map((s) => {
                const active = !accountId && scopeShortcut === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setAccountId('')
                      setScopeShortcut(s.id)
                    }}
                    className={[
                      'rounded-full border px-3 py-1 text-xs font-medium transition',
                      active
                        ? 'border-accent/40 bg-accent/10 text-accent-2'
                        : 'border-white/10 bg-surface-1 text-zinc-400 hover:border-white/20 hover:text-zinc-200',
                    ].join(' ')}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="min-w-[200px]">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Mês</label>
            <select
              value={ym}
              onChange={(e) => setYm(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
            >
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[11px] text-zinc-500">
          Filtro atual: <strong className="text-zinc-300">{filterLabel}</strong> ·{' '}
          {formatYmLabel(ym)}
        </p>
      </motion.section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Lançamentos"
          value={String(data.summary.transactionCount)}
          hint="Total no filtro (exclui transferências)"
        />
        <KpiCard
          label="Sem categoria"
          value={String(uncatCount)}
          tone={uncatCount > 0 ? 'amber' : 'neutral'}
          hint={uncatCount > 0 ? 'Revise estes primeiro ou rode a IA' : 'Tudo categorizado aqui'}
        />
        <KpiCard
          label="Saídas"
          value={formatBRL(outflowTotal)}
          tone={outflowTotal > 0 ? 'rose' : 'neutral'}
          hint={`${data.outflow.length} categoria${data.outflow.length === 1 ? '' : 's'}`}
        />
        <KpiCard
          label="Entradas"
          value={formatBRL(inflowTotal)}
          tone={inflowTotal > 0 ? 'emerald' : 'neutral'}
          hint={`${data.inflow.length} categoria${data.inflow.length === 1 ? '' : 's'}`}
        />
      </section>

      <AiCategorizeButton ym={ym} filter={filter} />

      {data.summary.transactionCount === 0 ? (
        <div className="glass rounded-2xl p-6 text-sm text-zinc-400">
          Nenhum lançamento no filtro selecionado. Troque a conta ou o mês acima.
        </div>
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-[auto,1fr]">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass flex flex-col items-center gap-3 rounded-2xl p-6"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Saídas por categoria
              </p>
              <DonutChart
                slices={slices}
                size={240}
                strokeWidth={26}
                centerLabel={formatBRL(outflowTotal)}
                centerSub={`${data.outflow.length} categoria${data.outflow.length === 1 ? '' : 's'}`}
                emptyMessage="Sem saídas neste filtro"
              />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="glass min-w-0 rounded-2xl p-5"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-100">
                  Detalhamento por categoria
                </h2>
                <span className="text-[11px] text-zinc-500">Total: {formatBRL(outflowTotal)}</span>
              </div>
              <div className="mt-3">
                <CategoryLegend
                  items={outflowSliced}
                  total={outflowTotal}
                  tone="out"
                  expandedKey={expandedOut}
                  onToggle={toggleOut}
                  expandedTransactions={expandedOutTx}
                  emptyMessage="Sem saídas neste filtro."
                />
              </div>
              {inflowSliced.length > 0 ? (
                <div className="mt-5 border-t border-white/10 pt-4">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Entradas por categoria
                  </h3>
                  <ul className="mt-2 divide-y divide-white/5">
                    {inflowSliced.map((it) => (
                      <li
                        key={it.categoryId ?? '__uncat_in__'}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span
                            aria-hidden="true"
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: it.color }}
                          />
                          <span className="truncate text-sm text-zinc-100">{it.categoryName}</span>
                        </div>
                        <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-emerald-200 tabular-nums">
                          {formatBRL(it.cents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </motion.div>
          </section>

          <section className="glass overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Lançamentos para revisar</h2>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Sem categoria aparece no topo. A sugestão aparece quando você já categorizou algo parecido antes.
                </p>
              </div>
              {uncatCount > 0 ? (
                <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-[11px] font-medium text-amber-200">
                  {uncatCount} sem categoria
                </span>
              ) : (
                <span className="text-[11px] text-zinc-500">Tudo categorizado</span>
              )}
            </div>
            <div className="max-h-[min(70vh,720px)] overflow-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur">
                  <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-zinc-500">
                    <th className="min-w-[110px] px-4 py-3 font-medium">Data</th>
                    <th className="px-4 py-3 font-medium">Descrição</th>
                    <th className="px-4 py-3 text-right font-medium">Valor</th>
                    <th className="min-w-[240px] px-4 py-3 font-medium">Categoria</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <CategorizeRow
                      key={r.id}
                      row={r}
                      index={i}
                      categories={categories}
                      investments={investments}
                      suggestionIndex={suggestionIndex}
                      onCategoryChange={onCategoryChange}
                      onInvestmentChange={onInvestmentChange}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-white/10 px-4 py-2 text-xs text-zinc-500">
              Mostrando até 1000 linhas. Refine pela conta ou pelo mês acima.
            </p>
          </section>
        </>
      )}
    </div>
  )
}

function CategorizeRow({
  row: r,
  index: i,
  categories,
  investments,
  suggestionIndex,
  onCategoryChange,
  onInvestmentChange,
}: {
  row: TxRow
  index: number
  categories: { id: string; name: string; kind: string }[]
  investments: Investment[]
  suggestionIndex: DescriptionIndex
  onCategoryChange: (txId: string, value: string) => void
  onInvestmentChange: (txId: string, value: string) => void
}) {
  const neg = r.amount_cents < 0
  const rowColor = colorForCategoryId(r.category_id)
  const isUncat = !r.category_id
  const isInvestment =
    r.category_kind === 'investment_in' || r.category_kind === 'investment_out'
  const suggestion = isUncat ? suggestCategory(suggestionIndex, r.description) : null
  const suggestionColor = suggestion
    ? colorForCategoryId(suggestion.suggestion.categoryId)
    : null

  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: Math.min(i * 0.008, 0.2) }}
      className={[
        'border-b border-white/5 hover:bg-white/[0.03]',
        isUncat ? 'bg-amber-500/[0.04]' : '',
      ].join(' ')}
      style={{ boxShadow: `inset 3px 0 0 ${rowColor}` }}
    >
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-zinc-300">
        {r.occurred_at.slice(0, 10)}
      </td>
      <td className="px-4 py-2.5 text-zinc-200">
        <span className="break-words">{r.description}</span>
        <span
          className="ml-1 align-middle text-[10px] uppercase tracking-wide text-zinc-600"
          title={`Origem: ${r.source} · Conta: ${r.account_name}`}
        >
          · {r.account_name}
        </span>
      </td>
      <td
        className={`whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums ${
          neg ? 'text-rose-200' : 'text-emerald-200'
        }`}
      >
        {formatBRL(r.amount_cents)}
      </td>
      <td className="px-4 py-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${isUncat ? 'opacity-40' : ''}`}
              style={{ backgroundColor: rowColor }}
            />
            <select
              value={r.category_id ?? ''}
              onChange={(e) => onCategoryChange(r.id, e.target.value)}
              className="w-full max-w-[240px] rounded-lg border border-white/10 bg-surface-1 px-2 py-1.5 text-xs text-white outline-none ring-accent/20 focus:ring-1"
            >
              <option value="">Sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.kind})
                </option>
              ))}
            </select>
          </div>
          {suggestion && suggestionColor ? (
            <button
              type="button"
              onClick={() => onCategoryChange(r.id, suggestion.suggestion.categoryId)}
              title={`Já usado ${suggestion.suggestion.supportCount}x com essa descrição (${Math.round(suggestion.suggestion.confidence * 100)}% das vezes).`}
              className="inline-flex w-fit items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: suggestionColor }}
              />
              <span>
                Aplicar{' '}
                <strong className="font-medium text-zinc-100">
                  {suggestion.suggestion.categoryName}
                </strong>
                {suggestion.strength === 'strong' ? (
                  <span className="ml-1 text-zinc-500">
                    ({suggestion.suggestion.supportCount}×)
                  </span>
                ) : (
                  <span className="ml-1 text-zinc-500">(visto antes)</span>
                )}
              </span>
            </button>
          ) : null}
          {isInvestment ? (
            <select
              value={r.investment_id ?? ''}
              onChange={(e) => onInvestmentChange(r.id, e.target.value)}
              title={
                r.category_kind === 'investment_in'
                  ? 'Vincular aporte a um investimento (opcional).'
                  : 'Vincular retirada a um investimento (opcional).'
              }
              className="w-full max-w-[240px] rounded-md border border-emerald-500/20 bg-emerald-400/5 px-2 py-1 text-[11px] text-emerald-100 outline-none ring-emerald-400/30 focus:ring-1"
            >
              <option value="">
                {r.category_kind === 'investment_in'
                  ? 'Sem vínculo — aporte geral'
                  : 'Sem vínculo — retirada geral'}
              </option>
              {investments.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </td>
    </motion.tr>
  )
}
