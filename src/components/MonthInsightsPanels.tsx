import { motion } from 'framer-motion'
import { DonutChart, colorForCategoryId, type DonutSlice } from './DonutChart'
import { useMaskedMoney } from '../context/AmountVisibilityContext'
import type { AccountSpendRow, PeriodSummary } from '../lib/queries/categorySpend'

export function accountKindLabelPt(kind: string): string {
  if (kind === 'credit') return 'Cartão'
  if (kind === 'wallet') return 'Carteira'
  if (kind === 'checking') return 'Conta corrente'
  if (kind === 'other') return 'Outra'
  return kind
}

export function DistributionDonutCard({
  donutSlices: slices,
  summary,
  className = '',
}: {
  donutSlices: DonutSlice[]
  summary: PeriodSummary
  className?: string
}) {
  const { brl } = useMaskedMoney()
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={['glass flex flex-col items-center gap-3 rounded-2xl p-6', className]
        .filter(Boolean)
        .join(' ')}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Distribuição no período
      </p>
      <DonutChart
        slices={slices}
        size={220}
        strokeWidth={24}
        centerLabel={brl(summary.totalCents)}
        centerSub={`${summary.categoriesWithSpend} categoria${summary.categoriesWithSpend === 1 ? '' : 's'}`}
        emptyMessage="Sem gastos no período"
      />
      <p className="max-w-[220px] text-center text-[11px] text-zinc-500">
        Top 12 categorias. Cores iguais em outras telas.
      </p>
    </motion.div>
  )
}

export function AccountSpendColumn({
  rows,
  periodTotalCents,
  className = '',
}: {
  rows: AccountSpendRow[]
  periodTotalCents: number
  className?: string
}) {
  const { brl } = useMaskedMoney()
  const hasFutureSpend = rows.some((r) => r.futureCents > 0)
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.03 }}
      className={['glass flex min-h-0 min-w-0 flex-col rounded-2xl p-5', className].filter(Boolean).join(' ')}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Gasto por conta</p>
      <p className="mt-1 text-[11px] leading-snug text-zinc-500">
        Contas com lançamento no mês.
        {hasFutureSpend ? (
          <>
            {' '}
            <span className="text-zinc-600">Real</span> = já lançado;{' '}
            <span className="text-zinc-600">Futuro</span> = agendado.
          </>
        ) : null}{' '}
        Mesma base do gráfico (sem transferências entre contas).
      </p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">Sem gastos neste mês.</p>
      ) : (
        <div className="mt-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div
            className={[
              'mb-1.5 grid items-end gap-x-2 border-b border-white/5 px-2.5 pb-2 text-[9px] font-medium uppercase tracking-wide text-zinc-500',
              hasFutureSpend
                ? 'grid-cols-[minmax(0,1fr)_repeat(3,5.25rem)] sm:grid-cols-[minmax(0,1fr)_repeat(3,5.75rem)]'
                : 'grid-cols-[minmax(0,1fr)_minmax(5.25rem,auto)] sm:grid-cols-[minmax(0,1fr)_minmax(6rem,auto)]',
            ].join(' ')}
            aria-hidden
          >
            <span className="min-w-0 text-left normal-case text-zinc-600">Conta</span>
            {hasFutureSpend ? (
              <>
                <span className="text-right">Real</span>
                <span className="text-right">Futuro</span>
              </>
            ) : null}
            <span className="text-right">Total</span>
          </div>
          <ul className="max-h-[min(340px,52vh)] space-y-2 overflow-y-auto pr-0.5">
            {rows.map((row) => {
              const color = colorForCategoryId(row.accountId)
              const pct =
                periodTotalCents > 0 ? (row.totalCents / periodTotalCents) * 100 : 0
              return (
                <li
                  key={row.accountId}
                  className="rounded-lg border border-white/5 bg-white/2 px-2.5 py-2"
                >
                  <div
                    className={[
                      'grid items-center gap-x-2',
                      hasFutureSpend
                        ? 'grid-cols-[minmax(0,1fr)_repeat(3,5.25rem)] sm:grid-cols-[minmax(0,1fr)_repeat(3,5.75rem)]'
                        : 'grid-cols-[minmax(0,1fr)_minmax(5.25rem,auto)] sm:grid-cols-[minmax(0,1fr)_minmax(6rem,auto)]',
                    ].join(' ')}
                  >
                    <p
                      className="truncate text-sm font-medium leading-tight text-zinc-100"
                      title={row.accountName}
                    >
                      {row.accountName}
                    </p>
                    {hasFutureSpend ? (
                      <>
                        <p className="text-right text-[11px] font-medium tabular-nums leading-tight text-zinc-200 sm:text-xs">
                          {brl(row.realCents)}
                        </p>
                        <p
                          className={[
                            'text-right text-[11px] font-medium tabular-nums leading-tight sm:text-xs',
                            row.futureCents > 0 ? 'text-amber-200/95' : 'text-zinc-600',
                          ].join(' ')}
                        >
                          {brl(row.futureCents)}
                        </p>
                      </>
                    ) : null}
                    <p className="text-right text-sm font-semibold tabular-nums leading-tight text-zinc-50">
                      {brl(row.totalCents)}
                    </p>
                  </div>
                  <p className="mt-1.5 text-[10px] text-zinc-500">
                    {accountKindLabelPt(row.accountKind)} · {row.count}{' '}
                    {row.count === 1 ? 'lançamento' : 'lançamentos'}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, pct).toFixed(1)}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                    <span className="shrink-0 text-[10px] text-zinc-500 tabular-nums">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </motion.div>
  )
}
