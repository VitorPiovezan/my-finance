import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CategoryHeatmap } from '../components/CategoryHeatmap'
import { DistributionDonutCard, AccountSpendColumn } from '../components/MonthInsightsPanels'
import { colorForCategoryId, type DonutSlice } from '../components/DonutChart'
import { useMaskedMoney } from '../context/AmountVisibilityContext'
import { useFinanceDb } from '../context/useFinanceDb'
import {
  getCategoryTransactionsInPeriod,
  getMonthAccountSpend,
  getMonthCategorySpend,
  getPeriodSummary,
  getYearCategoryMatrix,
  listYearsWithRecords,
  type AccountSpendRow,
  type CategorySpendRow,
  type CategorySpendTransaction,
  type PeriodSummary,
} from '../lib/queries/categorySpend'
import { ymNow } from '../lib/queries/spendSummary'

type ViewMode = 'year' | 'month'

const UNCAT_KEY = '__uncat__'

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

function yearMonths(year: number): string[] {
  const out: string[] = []
  for (let m = 1; m <= 12; m++) out.push(`${year}-${String(m).padStart(2, '0')}`)
  return out
}

const MONTH_ABBR_PT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
]

function monthAbbr(ym: string): string {
  const m = Number(ym.slice(5, 7))
  return MONTH_ABBR_PT[m - 1] ?? ym.slice(5, 7)
}

function keyForRow(row: CategorySpendRow): string {
  return row.categoryId ?? UNCAT_KEY
}

function KpiCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'neutral' | 'rose' | 'emerald'
}) {
  const color = tone === 'rose' ? 'text-rose-200' : tone === 'emerald' ? 'text-emerald-200' : 'text-white'
  return (
    <div className="glass rounded-2xl p-5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${color}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  )
}

/**
 * Card destacado de total gasto.
 *
 * Comportamento depende de `isCurrentMonth`:
 * - Mês atual: total do topo = Cartão + Gastos futuros. Mostra coluna "Gastos
 *   futuros" entre Cartão e Contas. Rodapé exibe Total recebido + Ganho futuro.
 *   Faz sentido porque futuros são projeção do que vai sair.
 * - Outros períodos (mês passado ou ano): total = Cartão + Contas, sem seção
 *   de futuros (não há projeção quando o período já foi consolidado ou é anual).
 */
function TotalSpendCard({
  summary,
  isCurrentMonth,
}: {
  summary: PeriodSummary
  isCurrentMonth: boolean
}) {
  const { brl } = useMaskedMoney()
  const credit = summary.creditTotalCents
  const account = summary.accountTotalCents
  const future = summary.futureExpenseCents
  const income = summary.incomeCents
  const futureIncome = summary.futureIncomeCents

  const topTotal = isCurrentMonth ? credit + future : credit + account
  const creditPct = topTotal > 0 ? Math.round((credit / topTotal) * 100) : 0
  const futurePct = topTotal > 0 ? Math.round((future / topTotal) * 100) : 0
  const accountPct = topTotal > 0 ? Math.round((account / topTotal) * 100) : 0

  return (
    <div className="glass rounded-2xl p-5 sm:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Total gasto
        </p>
        <p className="text-[11px] text-zinc-500">
          {summary.transactionCount}{' '}
          {summary.transactionCount === 1 ? 'lançamento' : 'lançamentos'} ·{' '}
          {summary.categoriesWithSpend}{' '}
          {summary.categoriesWithSpend === 1 ? 'categoria' : 'categorias'}
        </p>
      </div>
      <p
        className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-rose-200"
        title={
          isCurrentMonth
            ? 'Cartão de crédito + gastos futuros cadastrados para o mês.'
            : 'Cartão de crédito + contas e carteiras.'
        }
      >
        {brl(topTotal)}
      </p>

      {isCurrentMonth ? (
        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-white/5 pt-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Cartão de crédito
            </p>
            <p className="mt-1 truncate text-lg font-semibold tabular-nums text-zinc-100">
              {brl(credit)}
            </p>
            <p className="text-[10px] text-zinc-500">
              {creditPct}% · {summary.creditTransactionCount}{' '}
              {summary.creditTransactionCount === 1 ? 'lanç.' : 'lanç.'}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Gastos futuros
            </p>
            <p
              className={[
                'mt-1 truncate text-lg font-semibold tabular-nums',
                future > 0 ? 'text-amber-200' : 'text-zinc-600',
              ].join(' ')}
              title="Soma de futuros cadastrados no mês (cartão + contas)."
            >
              {brl(future)}
            </p>
            <p className="text-[10px] text-zinc-500">
              {future > 0
                ? `${futurePct}% · ${summary.futureExpenseCount} ${summary.futureExpenseCount === 1 ? 'cadastrado' : 'cadastrados'}`
                : 'nada cadastrado'}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Contas e carteiras
            </p>
            <p className="mt-1 truncate text-lg font-semibold tabular-nums text-zinc-100">
              {brl(account)}
            </p>
            <p
              className="text-[10px] text-zinc-500"
              title="Já pagos; ficam fora da soma do topo."
            >
              fora do total · {summary.accountTransactionCount}{' '}
              {summary.accountTransactionCount === 1 ? 'lanç.' : 'lanç.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/5 pt-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Cartão de crédito
            </p>
            <p className="mt-1 truncate text-lg font-semibold tabular-nums text-zinc-100">
              {brl(credit)}
            </p>
            <p className="text-[10px] text-zinc-500">
              {creditPct}% · {summary.creditTransactionCount}{' '}
              {summary.creditTransactionCount === 1 ? 'lanç.' : 'lanç.'}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Contas e carteiras
            </p>
            <p className="mt-1 truncate text-lg font-semibold tabular-nums text-zinc-100">
              {brl(account)}
            </p>
            <p className="text-[10px] text-zinc-500">
              {accountPct}% · {summary.accountTransactionCount}{' '}
              {summary.accountTransactionCount === 1 ? 'lanç.' : 'lanç.'}
            </p>
          </div>
        </div>
      )}

      <div
        className={[
          'mt-3 grid gap-3 border-t border-white/5 pt-3',
          isCurrentMonth ? 'grid-cols-3' : 'grid-cols-1',
        ].join(' ')}
      >
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Total recebido
          </p>
          <p
            className="mt-1 truncate text-lg font-semibold tabular-nums text-emerald-200"
            title="Soma das entradas reais no período (sem transferências entre contas próprias)."
          >
            {brl(income)}
          </p>
          <p className="text-[10px] text-zinc-500">
            {summary.incomeCount}{' '}
            {summary.incomeCount === 1 ? 'lançamento' : 'lançamentos'}
          </p>
        </div>
        {isCurrentMonth ? (
          <>
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Ganho futuro
              </p>
              <p
                className={[
                  'mt-1 truncate text-lg font-semibold tabular-nums',
                  futureIncome > 0 ? 'text-emerald-300/80' : 'text-zinc-600',
                ].join(' ')}
                title="Soma de futuros cadastrados como entrada (category kind = income)."
              >
                {brl(futureIncome)}
              </p>
              <p className="text-[10px] text-zinc-500">
                {summary.futureIncomeCount > 0
                  ? `${summary.futureIncomeCount} ${summary.futureIncomeCount === 1 ? 'cadastrado' : 'cadastrados'}`
                  : 'nada cadastrado'}
              </p>
            </div>
            {(() => {
              const net = futureIncome - topTotal
              return (
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    Saldo
                  </p>
                  <p
                    className={[
                      'mt-1 truncate text-lg font-semibold tabular-nums',
                      net >= 0 ? 'text-emerald-200' : 'text-rose-200',
                    ].join(' ')}
                    title="Projeção: ganho futuro − total gasto (cartão + futuros)."
                  >
                    {net >= 0 ? '+ ' : ''}
                    {brl(net)}
                  </p>
                  <p className="text-[10px] text-zinc-500">projeção do mês</p>
                </div>
              )
            })()}
          </>
        ) : null}
      </div>
    </div>
  )
}

function Sparkline({
  values,
  color,
  width = 120,
  height = 28,
}: {
  values: number[]
  color: string
  width?: number
  height?: number
}) {
  if (values.length === 0) return null
  const max = Math.max(...values, 1)
  const stepX = values.length > 1 ? width / (values.length - 1) : width
  const points = values
    .map((v, i) => {
      const x = i * stepX
      const y = height - (v / max) * (height - 4) - 2
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const last = values[values.length - 1] ?? 0
  const lastX = (values.length - 1) * stepX
  const lastY = height - (last / max) * (height - 4) - 2
  return (
    <svg width={width} height={height} aria-hidden="true" className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.9}
      />
      {last > 0 ? <circle cx={lastX} cy={lastY} r={2.2} fill={color} /> : null}
    </svg>
  )
}

function CategoryBar({
  row,
  rowKey,
  total,
  expanded,
  onToggle,
  transactions,
}: {
  row: CategorySpendRow
  rowKey: string
  total: number
  expanded: boolean
  onToggle: () => void
  transactions: CategorySpendTransaction[]
}) {
  const { brl } = useMaskedMoney()
  const pct = total > 0 ? (row.totalCents / total) * 100 : 0
  const color = colorForCategoryId(row.categoryId)
  return (
    <li id={`cat-bar-${rowKey}`} className="scroll-mt-24 border-b border-white/5 last:border-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={[
          'flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition',
          'hover:bg-white/5 focus:bg-white/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40',
          expanded ? 'bg-white/[0.04]' : '',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-sm font-medium text-zinc-100">{row.categoryName}</p>
            <p className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-zinc-100">
              {brl(row.totalCents)}
            </p>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(100, pct).toFixed(1)}%`, backgroundColor: color }}
              />
            </div>
            <span className="shrink-0 text-[11px] text-zinc-500 tabular-nums">
              {pct.toFixed(1)}% · {row.count} {row.count === 1 ? 'lanç.' : 'lanç.'}
            </span>
          </div>
        </div>
        <span
          aria-hidden="true"
          className={[
            'text-zinc-500 transition-transform',
            expanded ? 'rotate-90 text-zinc-300' : '',
          ].join(' ')}
        >
          ›
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mb-3 ml-5 mr-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              {transactions.length === 0 ? (
                <p className="text-xs text-zinc-500">Sem lançamentos nesta categoria no período.</p>
              ) : (
                <ul className="divide-y divide-white/5">
                  {transactions.map((t) => (
                    <li key={t.id} className="flex items-start justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-zinc-100" title={t.description}>
                          {t.description}
                        </p>
                        <p className="mt-0.5 text-[11px] text-zinc-500">
                          {t.occurredAt.slice(0, 10)} · {t.accountName} · {t.ym}
                        </p>
                      </div>
                      <p className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-rose-200">
                        {brl(Math.abs(t.amountCents))}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {transactions.length >= 300 ? (
                <p className="mt-2 text-[11px] text-zinc-500">
                  Mostrando os 300 maiores lançamentos do período.
                </p>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  )
}

export function CategoriesAnalyticsPage() {
  const { brl } = useMaskedMoney()
  const { getDb, version } = useFinanceDb()
  const defaultYear = new Date().getFullYear()
  const [searchParams] = useSearchParams()
  // Permite navegação externa via ?period=YYYY-MM (mês) ou ?period=YYYY (ano).
  // Só consulta na montagem — depois o usuário controla pelo seletor visual.
  const initialPeriod = useMemo(() => {
    const raw = searchParams.get('period')
    if (raw && /^\d{4}-\d{2}$/.test(raw)) {
      return { mode: 'month' as ViewMode, ym: raw, year: Number(raw.slice(0, 4)) }
    }
    if (raw && /^\d{4}$/.test(raw)) {
      return { mode: 'year' as ViewMode, ym: ymNow(), year: Number(raw) }
    }
    return { mode: 'year' as ViewMode, ym: ymNow(), year: defaultYear }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- leitura única no mount
  }, [])
  const [mode, setMode] = useState<ViewMode>(initialPeriod.mode)
  const [year, setYear] = useState<number>(initialPeriod.year)
  const [monthYm, setMonthYm] = useState<string>(initialPeriod.ym)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const periodPattern = mode === 'year' ? String(year) : monthYm
  const isCurrentMonth = mode === 'month' && monthYm === ymNow()

  const data = useMemo(() => {
    const db = getDb()
    if (mode === 'year') {
      const rows = getYearCategoryMatrix(db, year)
      const summary = getPeriodSummary(db, String(year))
      return { rows, summary, accounts: [] as AccountSpendRow[] }
    }
    const rows = getMonthCategorySpend(db, monthYm)
    const summary = getPeriodSummary(db, monthYm)
    const accounts = getMonthAccountSpend(db, monthYm)
    return { rows, summary, accounts }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida leituras após mutações no SQLite
  }, [getDb, version, mode, year, monthYm])

  const expandedTransactions = useMemo<CategorySpendTransaction[]>(() => {
    if (expandedKey == null) return []
    const db = getDb()
    const categoryId = expandedKey === UNCAT_KEY ? null : expandedKey
    return getCategoryTransactionsInPeriod(db, categoryId, periodPattern, 300)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida leituras após mutações no SQLite
  }, [getDb, version, expandedKey, periodPattern])

  const yearsAvailable = useMemo(() => {
    const db = getDb()
    const list = listYearsWithRecords(db)
    const set = new Set<number>(list)
    set.add(defaultYear)
    return Array.from(set).sort((a, b) => b - a)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida leituras após mutações no SQLite
  }, [getDb, version, defaultYear])

  const monthOptions = useMemo(() => monthChoices(), [])

  const months = useMemo(() => {
    if (mode !== 'year') return [monthYm]
    return yearMonths(year)
  }, [mode, monthYm, year])

  const donutSlices: DonutSlice[] = useMemo(
    () =>
      data.rows
        .filter((r) => r.totalCents > 0)
        .slice(0, 12)
        .map((r, i) => ({
          id: r.categoryId ?? `uncat-${i}`,
          label: r.categoryName,
          value: r.totalCents,
          color: colorForCategoryId(r.categoryId),
        })),
    [data.rows],
  )

  const toggle = (categoryId: string | null) => {
    const k = categoryId ?? UNCAT_KEY
    setExpandedKey((prev) => (prev === k ? null : k))
  }

  // Ao abrir uma categoria (de qualquer origem: heatmap, ranking...), rola a página
  // até a linha correspondente no ranking pra você não precisar procurar embaixo.
  // Usamos setTimeout (> duração da animação de expand/collapse) pra evitar rolar
  // antes das alturas se acomodarem quando troca de uma categoria aberta pra outra.
  useEffect(() => {
    if (expandedKey == null) return
    const id = `cat-bar-${expandedKey}`
    const timer = window.setTimeout(() => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 260)
    return () => window.clearTimeout(timer)
  }, [expandedKey])

  const periodLabel =
    mode === 'year' ? `Ano de ${year}` : formatYmLabel(monthYm)

  return (
    <div className="space-y-6">
      <header>
        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-semibold tracking-tight text-white"
        >
          Gastos por categoria
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Visualize quanto você gastou em cada categoria no período escolhido — somando
          contas e cartão, sem contar transferências entre contas próprias. Clique em
          qualquer categoria para ver os lançamentos.
        </p>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass flex flex-wrap items-start gap-4 rounded-2xl p-5"
      >
        <div className="min-w-[140px]">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Período
          </label>
          <div className="mt-2 flex w-full overflow-hidden rounded-xl border border-white/10 bg-surface-1">
            <button
              type="button"
              onClick={() => setMode('year')}
              className={[
                'min-w-0 flex-1 px-3 py-2.5 text-xs font-medium transition sm:px-4',
                mode === 'year'
                  ? 'bg-accent/15 text-accent-2'
                  : 'text-zinc-400 hover:text-zinc-200',
              ].join(' ')}
            >
              Ano
            </button>
            <button
              type="button"
              onClick={() => setMode('month')}
              className={[
                'min-w-0 flex-1 border-l border-white/10 px-3 py-2.5 text-xs font-medium transition sm:px-4',
                mode === 'month'
                  ? 'bg-accent/15 text-accent-2'
                  : 'text-zinc-400 hover:text-zinc-200',
              ].join(' ')}
            >
              Mês
            </button>
          </div>
        </div>
        {mode === 'year' ? (
          <div className="min-w-[160px]">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Ano
            </label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
            >
              {yearsAvailable.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="min-w-[200px]">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Mês
            </label>
            <select
              value={monthYm}
              onChange={(e) => setMonthYm(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
            >
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="ml-auto text-right">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Período</p>
          <p className="text-sm font-semibold text-zinc-100">{periodLabel}</p>
        </div>
      </motion.div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TotalSpendCard summary={data.summary} isCurrentMonth={isCurrentMonth} />
        <KpiCard
          label={mode === 'year' ? 'Média mensal' : 'Diário médio'}
          value={brl(
            mode === 'year'
              ? data.summary.monthlyAverageCents
              : Math.round(data.summary.totalCents / 30),
          )}
          hint={mode === 'year' ? 'Total ÷ meses com dados' : 'Total ÷ 30'}
        />
        <KpiCard
          label="Maior categoria"
          value={data.summary.topCategoryName ?? '—'}
          hint={
            data.summary.topCategoryCents > 0
              ? brl(data.summary.topCategoryCents)
              : 'sem dados'
          }
        />
      </section>

      {mode === 'year' ? (
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-zinc-300">Mapa de calor · categoria × mês</h2>
            <span className="text-[11px] text-zinc-500">
              Quanto mais vermelho, maior o gasto no mês
            </span>
          </div>
          <CategoryHeatmap
            rows={data.rows}
            months={months}
            expandedKey={expandedKey}
            onCategoryClick={(id) => toggle(id)}
            onCellClick={(id, ym) => {
              setMode('month')
              setMonthYm(ym)
              setExpandedKey(id ?? UNCAT_KEY)
            }}
          />
        </section>
      ) : null}

      <section
        className={
          mode === 'month'
            ? 'flex flex-col gap-4'
            : 'grid gap-4 lg:grid-cols-[auto,1fr]'
        }
      >
        {mode === 'month' ? (
          <div className="flex min-w-0 flex-col gap-4 min-[400px]:flex-row min-[400px]:items-stretch">
            <DistributionDonutCard
              donutSlices={donutSlices}
              summary={data.summary}
              className="min-w-0 flex-1 basis-0"
            />
            <AccountSpendColumn
              rows={data.accounts}
              periodTotalCents={data.summary.totalCents}
              className="min-w-0 flex-1 basis-0"
            />
          </div>
        ) : (
          <DistributionDonutCard donutSlices={donutSlices} summary={data.summary} />
        )}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass min-w-0 rounded-2xl p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-100">
              Ranking de categorias {mode === 'year' ? 'no ano' : 'no mês'}
            </h2>
            <span className="text-[11px] text-zinc-500">
              Total: {brl(data.summary.totalCents)}
            </span>
          </div>
          {data.rows.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">Sem gastos neste período.</p>
          ) : (
            <ul className="mt-3">
              {data.rows.map((row) => {
                const k = keyForRow(row)
                const expanded = expandedKey === k
                return (
                  <CategoryBar
                    key={k}
                    rowKey={k}
                    row={row}
                    total={data.summary.totalCents}
                    expanded={expanded}
                    onToggle={() => toggle(row.categoryId)}
                    transactions={expanded ? expandedTransactions : []}
                  />
                )
              })}
            </ul>
          )}
        </motion.div>
      </section>

      {mode === 'year' ? (
        <section className="glass rounded-2xl p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-100">Tendência por categoria</h2>
            <span className="text-[11px] text-zinc-500">Top 8 · mensal ao longo do ano</span>
          </div>
          <ul className="mt-3 divide-y divide-white/5">
            {data.rows.slice(0, 8).map((row) => {
              const values = months.map((ym) => row.byMonth[ym] ?? 0)
              const color = colorForCategoryId(row.categoryId)
              const peak = values.reduce(
                (acc, v, i) => (v > acc.v ? { v, i } : acc),
                { v: 0, i: -1 },
              )
              const peakLabel =
                peak.i >= 0 && peak.v > 0
                  ? `pico em ${months[peak.i]?.slice(5)} · ${brl(peak.v)}`
                  : 'sem pico'
              return (
                <li key={keyForRow(row)} className="flex items-center gap-3 py-2">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-zinc-100">{row.categoryName}</p>
                    <p className="text-[11px] text-zinc-500">{peakLabel}</p>
                  </div>
                  <Sparkline values={values} color={color} />
                  <p className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-zinc-100">
                    {brl(row.totalCents)}
                  </p>
                </li>
              )
            })}
          </ul>
          <p className="mt-3 text-[11px] text-zinc-500">
            Quer ver os lançamentos? Clique na categoria no mapa de calor acima ou na
            lista de ranking.{' '}
            <Link to="/lancamentos" className="text-accent-2 hover:underline">
              Ir para Lançamentos
            </Link>
          </p>
        </section>
      ) : null}

      {mode === 'year' ? (
        <CategoryLinesSection
          rows={data.rows}
          months={months}
          onCategoryClick={(id) => toggle(id)}
        />
      ) : null}
    </div>
  )
}

function niceCeil(n: number): number {
  if (n <= 0) return 1
  const exp = Math.floor(Math.log10(n))
  const base = 10 ** exp
  const m = n / base
  let nice: number
  if (m <= 1) nice = 1
  else if (m <= 2) nice = 2
  else if (m <= 5) nice = 5
  else nice = 10
  return nice * base
}

function CategoryLinesSection({
  rows,
  months,
  onCategoryClick,
}: {
  rows: CategorySpendRow[]
  months: string[]
  onCategoryClick: (categoryId: string | null) => void
}) {
  const { brl, brlCompact } = useMaskedMoney()
  const rowsWithSpend = useMemo(() => rows.filter((r) => r.totalCents > 0), [rows])
  const defaultActive = useMemo(
    () =>
      new Set<string>(
        rowsWithSpend.slice(0, 6).map((r) => r.categoryId ?? UNCAT_KEY),
      ),
    [rowsWithSpend],
  )
  const [active, setActive] = useState<Set<string>>(defaultActive)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  // Resetar seleção quando o conjunto de rows muda (ex.: trocou o ano).
  useEffect(() => {
    setActive(defaultActive)
  }, [defaultActive])

  const toggleActive = (key: string) => {
    setActive((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const visibleRows = useMemo(
    () => rowsWithSpend.filter((r) => active.has(r.categoryId ?? UNCAT_KEY)),
    [rowsWithSpend, active],
  )

  const rawMax = useMemo(() => {
    let max = 0
    for (const r of visibleRows) {
      for (const ym of months) {
        const v = r.byMonth[ym] ?? 0
        if (v > max) max = v
      }
    }
    return max
  }, [visibleRows, months])

  const niceMax = niceCeil(rawMax)
  const tickCount = 5
  const tickValues = Array.from({ length: tickCount + 1 }, (_, i) =>
    Math.round((niceMax / tickCount) * i),
  )

  const width = 900
  const height = 340
  const padding = { top: 20, right: 24, bottom: 36, left: 72 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom
  const stepX = months.length > 1 ? innerW / (months.length - 1) : innerW

  const xAt = (i: number) => padding.left + i * stepX
  const yAt = (v: number) =>
    padding.top + innerH - (niceMax > 0 ? (v / niceMax) * innerH : innerH)

  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-100">
          Variação mensal por categoria
        </h2>
        <span className="text-[11px] text-zinc-500">
          Clique na legenda para mostrar/ocultar · clique no nome para ver lançamentos
        </span>
      </div>

      {rowsWithSpend.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">Sem gastos neste período.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setActive(
                  new Set(rowsWithSpend.map((r) => r.categoryId ?? UNCAT_KEY)),
                )
              }
              className="rounded-full border border-white/10 bg-surface-1 px-2.5 py-1 text-[11px] text-zinc-300 hover:text-white"
            >
              Todas
            </button>
            <button
              type="button"
              onClick={() => setActive(new Set())}
              className="rounded-full border border-white/10 bg-surface-1 px-2.5 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
            >
              Limpar
            </button>
            <span className="mx-1 h-4 w-px bg-white/10" aria-hidden="true" />
            {rowsWithSpend.map((r) => {
              const key = r.categoryId ?? UNCAT_KEY
              const isActive = active.has(key)
              const color = colorForCategoryId(r.categoryId)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleActive(key)}
                  onDoubleClick={() => onCategoryClick(r.categoryId)}
                  title={`${r.categoryName} · ${brl(r.totalCents)}${
                    isActive ? '' : ' (oculto)'
                  }`}
                  className={[
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition',
                    isActive
                      ? 'border-white/15 bg-white/5 text-zinc-100'
                      : 'border-white/5 bg-transparent text-zinc-500 hover:text-zinc-300',
                  ].join(' ')}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: isActive ? color : 'rgba(255,255,255,0.2)',
                    }}
                  />
                  <span className="max-w-[140px] truncate">{r.categoryName}</span>
                </button>
              )
            })}
          </div>

          <div className="mt-4">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="h-auto w-full"
              preserveAspectRatio="none"
              onMouseLeave={() => setHoverIdx(null)}
            >
              {tickValues.map((t, i) => {
                const y = yAt(t)
                return (
                  <g key={`grid-${i}`}>
                    <line
                      x1={padding.left}
                      x2={padding.left + innerW}
                      y1={y}
                      y2={y}
                      stroke="rgba(255,255,255,0.06)"
                      strokeDasharray={i === 0 ? undefined : '3 4'}
                    />
                    <text
                      x={padding.left - 10}
                      y={y}
                      dy={3}
                      textAnchor="end"
                      fontSize="10"
                      fill="rgba(161,161,170,0.85)"
                    >
                      {brlCompact(t)}
                    </text>
                  </g>
                )
              })}

              {months.map((ym, i) => {
                const x = xAt(i)
                const y = padding.top + innerH + 18
                return (
                  <text
                    key={`xlbl-${ym}`}
                    x={x}
                    y={y}
                    textAnchor="middle"
                    fontSize="10"
                    fill="rgba(161,161,170,0.85)"
                  >
                    {monthAbbr(ym).toUpperCase()}
                  </text>
                )
              })}

              {hoverIdx != null ? (
                <line
                  x1={xAt(hoverIdx)}
                  x2={xAt(hoverIdx)}
                  y1={padding.top}
                  y2={padding.top + innerH}
                  stroke="rgba(255,255,255,0.15)"
                  strokeDasharray="3 3"
                />
              ) : null}

              {visibleRows.map((r) => {
                const color = colorForCategoryId(r.categoryId)
                const values = months.map((ym) => r.byMonth[ym] ?? 0)
                const points = values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ')
                return (
                  <g key={`line-${r.categoryId ?? 'uncat'}`}>
                    <polyline
                      points={points}
                      fill="none"
                      stroke={color}
                      strokeWidth={1.8}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      opacity={0.95}
                    />
                    {values.map((v, i) =>
                      v > 0 ? (
                        <circle
                          key={`dot-${i}`}
                          cx={xAt(i)}
                          cy={yAt(v)}
                          r={hoverIdx === i ? 3.4 : 2.4}
                          fill={color}
                        />
                      ) : null,
                    )}
                  </g>
                )
              })}

              {months.map((_, i) => (
                <rect
                  key={`hit-${i}`}
                  x={xAt(i) - stepX / 2}
                  y={padding.top}
                  width={stepX}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(i)}
                />
              ))}
            </svg>

            {hoverIdx != null ? (
              <HoverSummary
                ym={months[hoverIdx] ?? ''}
                rows={visibleRows}
              />
            ) : (
              <p className="mt-2 text-center text-[11px] text-zinc-500">
                {visibleRows.length} categoria{visibleRows.length === 1 ? '' : 's'}{' '}
                visíve{visibleRows.length === 1 ? 'l' : 'is'} ·{' '}
                {rowsWithSpend.length - visibleRows.length > 0
                  ? `${rowsWithSpend.length - visibleRows.length} ocultas`
                  : 'todas com dados'}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function HoverSummary({
  ym,
  rows,
}: {
  ym: string
  rows: CategorySpendRow[]
}) {
  const { brl } = useMaskedMoney()
  const items = rows
    .map((r) => ({
      id: r.categoryId ?? UNCAT_KEY,
      name: r.categoryName,
      value: r.byMonth[ym] ?? 0,
      color: colorForCategoryId(r.categoryId),
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value)

  return (
    <div className="mt-2 rounded-xl border border-white/5 bg-surface-1/60 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">
        {formatYmLabel(ym)}
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-zinc-500">Sem registros neste mês.</p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center gap-1.5 text-xs text-zinc-200"
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: it.color }}
              />
              <span>{it.name}</span>
              <span className="tabular-nums text-zinc-400">
                {brl(it.value)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
