import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AiCategorizeButton } from '../components/AiCategorizeButton'
import { CATEGORY_PALETTE, DonutChart, type DonutSlice } from '../components/DonutChart'
import { useFinanceDb } from '../context/useFinanceDb'
import { formatBRL } from '../lib/money'
import {
  getAnalysisSummary,
  getInflowByCategory,
  getOutflowByCategory,
  getTopTransactions,
  getTransactionsByCategory,
  type AnalysisScope,
  type CategoryBreakdown,
  type TopTransaction,
} from '../lib/queries/analysis'
import { ymNow, ymPrevious } from '../lib/queries/spendSummary'

const UNCAT_KEY = '__uncat__'
const legendKey = (id: string | null) => id ?? UNCAT_KEY

const SCOPE_LABEL: Record<AnalysisScope, { title: string; blurb: string }> = {
  contas: {
    title: 'Conta e carteiras',
    blurb: 'Análise do fluxo das suas contas não-cartão (corrente, wallet, etc.) no mês.',
  },
  cartao: {
    title: 'Cartão de crédito',
    blurb: 'Distribuição das compras no cartão pelo mês de referência do extrato.',
  },
}

function isScope(v: string | undefined): v is AnalysisScope {
  return v === 'contas' || v === 'cartao'
}

function isYm(v: string | undefined): v is string {
  return !!v && /^\d{4}-\d{2}$/.test(v)
}

function formatYmLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const dt = new Date(y, m - 1, 1)
  const label = dt.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function CategoryLegend({
  items,
  total,
  emptyMessage,
  tone,
  expandedKey,
  onToggle,
  expandedTransactions,
  expandedLoading,
}: {
  items: (CategoryBreakdown & { color: string })[]
  total: number
  emptyMessage: string
  tone: 'out' | 'in'
  expandedKey: string | null
  onToggle: (categoryId: string | null) => void
  expandedTransactions: TopTransaction[]
  expandedLoading?: boolean
}) {
  if (items.length === 0) {
    return <p className="text-sm text-zinc-500">{emptyMessage}</p>
  }
  const amountColor = tone === 'in' ? 'text-emerald-200' : 'text-rose-200'
  return (
    <ul className="divide-y divide-white/5">
      {items.map((it) => {
        const pct = total > 0 ? (it.cents / total) * 100 : 0
        const key = legendKey(it.categoryId)
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
                    {expandedLoading ? (
                      <p className="text-xs text-zinc-500">Carregando...</p>
                    ) : expandedTransactions.length === 0 ? (
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

function TopList({
  title,
  items,
  tone,
  emptyMessage,
}: {
  title: string
  items: TopTransaction[]
  tone: 'out' | 'in'
  emptyMessage: string
}) {
  const color = tone === 'out' ? 'text-rose-200' : 'text-emerald-200'
  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{emptyMessage}</p>
      ) : (
        <ul className="mt-3 divide-y divide-white/5">
          {items.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm text-zinc-100" title={t.description}>
                  {t.description}
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {t.occurredAt.slice(0, 10)} · {t.accountName}
                  {t.categoryName ? ` · ${t.categoryName}` : ''}
                </p>
              </div>
              <p className={`shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums ${color}`}>
                {formatBRL(Math.abs(t.amountCents))}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SummaryStat({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string
  value: string
  tone?: 'neutral' | 'positive' | 'negative'
  hint?: string
}) {
  const color =
    tone === 'positive' ? 'text-emerald-200' : tone === 'negative' ? 'text-rose-200' : 'text-white'
  return (
    <div className="glass rounded-2xl p-5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${color}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  )
}

export function AnalysisPage() {
  const { scope: rawScope, ym: rawYm } = useParams<{ scope: string; ym: string }>()
  const { getDb, version } = useFinanceDb()

  const valid = isScope(rawScope) && isYm(rawYm)
  const scope: AnalysisScope = isScope(rawScope) ? rawScope : 'contas'
  const ym: string = isYm(rawYm) ? rawYm : ymNow()
  const cur = ymNow()
  const prev = ymPrevious(cur)

  const data = useMemo(() => {
    if (!valid) {
      return null
    }
    const db = getDb()
    const filter = { scope }
    return {
      summary: getAnalysisSummary(db, ym, filter),
      prevSummary: getAnalysisSummary(db, ymPrevious(ym), filter),
      outflow: getOutflowByCategory(db, ym, filter),
      inflow: getInflowByCategory(db, ym, filter),
      topOut: getTopTransactions(db, ym, filter, 'out', 10),
      topIn: getTopTransactions(db, ym, filter, 'in', 10),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida leituras após mutações no SQLite
  }, [getDb, version, scope, ym, valid])

  const outflowSliced = useMemo<(CategoryBreakdown & { color: string })[]>(
    () => (data?.outflow ?? []).map((c, i) => ({ ...c, color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] })),
    [data],
  )
  const inflowSliced = useMemo<(CategoryBreakdown & { color: string })[]>(
    () => (data?.inflow ?? []).map((c, i) => ({ ...c, color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] })),
    [data],
  )

  const [expandedOut, setExpandedOut] = useState<string | null>(null)
  const [expandedIn, setExpandedIn] = useState<string | null>(null)

  const expandedOutTx = useMemo<TopTransaction[]>(() => {
    if (!valid || expandedOut == null) return []
    const db = getDb()
    const categoryId = expandedOut === UNCAT_KEY ? null : expandedOut
    return getTransactionsByCategory(db, ym, { scope }, categoryId, 'out', 200)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida leituras após mutações no SQLite
  }, [getDb, version, scope, ym, valid, expandedOut])

  const expandedInTx = useMemo<TopTransaction[]>(() => {
    if (!valid || expandedIn == null) return []
    const db = getDb()
    const categoryId = expandedIn === UNCAT_KEY ? null : expandedIn
    return getTransactionsByCategory(db, ym, { scope }, categoryId, 'in', 200)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida leituras após mutações no SQLite
  }, [getDb, version, scope, ym, valid, expandedIn])

  if (!valid || !data) {
    return <Navigate to="/" replace />
  }

  const toggleOut = (id: string | null) => {
    const k = legendKey(id)
    setExpandedOut((prev) => (prev === k ? null : k))
  }
  const toggleIn = (id: string | null) => {
    const k = legendKey(id)
    setExpandedIn((prev) => (prev === k ? null : k))
  }

  const meta = SCOPE_LABEL[scope]

  const outflowTotal = data.summary.outflowCents
  const inflowTotal = data.summary.inflowCents

  const slices: DonutSlice[] = outflowSliced.map((c) => ({
    id: c.categoryId ?? 'uncat',
    label: c.categoryName,
    value: c.cents,
    color: c.color,
  }))

  const monthLabel = formatYmLabel(ym)
  const quickLinks = [
    { ym, label: monthLabel, active: true },
    { ym: ymPrevious(ym), label: formatYmLabel(ymPrevious(ym)), active: false },
    ...(ym !== cur ? [{ ym: cur, label: formatYmLabel(cur), active: false }] : []),
    ...(ym !== prev && ymPrevious(ym) !== prev ? [{ ym: prev, label: formatYmLabel(prev), active: false }] : []),
  ]

  const netLabel = scope === 'cartao' ? 'Saldo no mês' : 'Diferença'
  const netTone: 'positive' | 'negative' | 'neutral' =
    data.summary.netCents > 0 ? 'positive' : data.summary.netCents < 0 ? 'negative' : 'neutral'

  const prevOutflowLabel = formatBRL(data.prevSummary.outflowCents)

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-3">
        <Link to="/" className="inline-flex w-fit items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <span aria-hidden="true">←</span> Voltar à visão geral
        </Link>
        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-semibold tracking-tight text-white"
        >
          {meta.title}
          <span className="ml-3 text-base font-medium text-zinc-400">{monthLabel}</span>
        </motion.h1>
        <p className="max-w-2xl text-sm text-zinc-400">
          {meta.blurb}{' '}
          <span className="text-zinc-500">
            Transferências entre contas próprias (categoria <em>Transferências</em>) não entram nos totais.
          </span>
        </p>
        {data.summary.transferCount > 0 ? (
          <div className="glass mt-1 inline-flex w-fit items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-zinc-400">
            <span>
              <strong className="text-zinc-200">{data.summary.transferCount}</strong>{' '}
              {data.summary.transferCount === 1 ? 'transferência ignorada' : 'transferências ignoradas'} ·{' '}
              <span className="tabular-nums">{formatBRL(data.summary.transferVolumeCents)}</span> movidos
            </span>
            <Link to="/lancamentos" className="text-accent-2 hover:underline">
              ver lançamentos →
            </Link>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-1">
          {quickLinks.map((q) => (
            <Link
              key={q.ym}
              to={`/analise/${scope}/${q.ym}`}
              className={[
                'rounded-full border px-3 py-1 text-xs font-medium transition',
                q.active
                  ? 'border-accent/40 bg-accent/10 text-accent-2'
                  : 'border-white/10 bg-surface-1 text-zinc-400 hover:border-white/20 hover:text-zinc-200',
              ].join(' ')}
            >
              {q.label}
            </Link>
          ))}
          <Link
            to={`/lancamentos?scope=${scope}&ym=${ym}`}
            className="rounded-full border border-white/10 bg-surface-1 px-3 py-1 text-xs font-medium text-zinc-400 hover:border-white/20 hover:text-zinc-200"
          >
            Ver todos os lançamentos →
          </Link>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryStat
          label={scope === 'cartao' ? 'Pagamentos ao cartão' : 'Entradas'}
          value={formatBRL(inflowTotal)}
          tone={inflowTotal > 0 ? 'positive' : 'neutral'}
          hint={scope === 'cartao' ? 'Estornos e créditos no cartão' : 'Soma dos créditos no mês'}
        />
        <SummaryStat
          label={scope === 'cartao' ? 'Compras' : 'Saídas'}
          value={formatBRL(outflowTotal)}
          tone={outflowTotal > 0 ? 'negative' : 'neutral'}
          hint={`Mês anterior: ${prevOutflowLabel}`}
        />
        <SummaryStat
          label={netLabel}
          value={formatBRL(data.summary.netCents)}
          tone={netTone}
          hint={
            scope === 'cartao'
              ? 'Pagamentos menos compras (normalmente negativo)'
              : 'Entradas − saídas no mês'
          }
        />
        <SummaryStat
          label="Lançamentos"
          value={String(data.summary.transactionCount)}
          hint={`${data.outflow.length} categoria${data.outflow.length === 1 ? '' : 's'} com saída`}
        />
      </section>

      <AiCategorizeButton ym={ym} filter={{ scope }} />

      <section className="grid gap-4 lg:grid-cols-[auto,1fr]">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass flex flex-col items-center gap-3 rounded-2xl p-6"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {scope === 'cartao' ? 'Compras por categoria' : 'Saídas por categoria'}
          </p>
          <DonutChart
            slices={slices}
            size={240}
            strokeWidth={26}
            centerLabel={formatBRL(outflowTotal)}
            centerSub={`${data.outflow.length} categoria${data.outflow.length === 1 ? '' : 's'}`}
            emptyMessage="Sem saídas no mês"
          />
          <p className="max-w-[240px] text-center text-[11px] text-zinc-500">
            Passe o mouse sobre uma fatia para destacar a categoria.
          </p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass min-w-0 rounded-2xl p-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-100">Detalhamento por categoria</h2>
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
              emptyMessage={scope === 'cartao' ? 'Sem compras neste mês.' : 'Sem saídas neste mês.'}
            />
          </div>
        </motion.div>
      </section>

      {scope === 'contas' ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <TopList
            title="Maiores saídas"
            items={data.topOut}
            tone="out"
            emptyMessage="Sem saídas no período."
          />
          <TopList
            title="Maiores entradas"
            items={data.topIn}
            tone="in"
            emptyMessage="Sem entradas no período."
          />
        </section>
      ) : (
        <section className="grid gap-4 lg:grid-cols-2">
          <TopList
            title="Maiores compras"
            items={data.topOut}
            tone="out"
            emptyMessage="Sem compras no período."
          />
          <div className="glass rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-zinc-100">Entradas / estornos</h3>
            <div className="mt-3">
              <CategoryLegend
                items={inflowSliced}
                total={inflowTotal}
                tone="in"
                expandedKey={expandedIn}
                onToggle={toggleIn}
                expandedTransactions={expandedInTx}
                emptyMessage="Nada além das compras neste mês."
              />
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
