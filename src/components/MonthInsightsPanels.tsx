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
      <div className="w-full max-w-[220px] shrink-0">
        <DonutChart
          slices={slices}
          size={220}
          strokeWidth={24}
          centerLabel={brl(summary.totalCents)}
          centerSub={`${summary.categoriesWithSpend} categoria${summary.categoriesWithSpend === 1 ? '' : 's'}`}
          emptyMessage="Sem gastos no período"
        />
      </div>
      <p className="max-w-sm text-center text-[11px] text-zinc-500">
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
          {/* Mobile: sem coluna "Conta" + valores numa faixa; evita esmagar o nome. */}
          {hasFutureSpend ? (
            <div
              className="mb-1.5 grid grid-cols-3 border-b border-white/5 px-2.5 pb-2 text-[9px] font-medium uppercase tracking-wide text-zinc-500 md:hidden"
              aria-hidden
            >
              <span className="text-left">Real</span>
              <span className="text-center">Futuro</span>
              <span className="text-right">Total</span>
            </div>
          ) : null}
          <div
            className={[
              'mb-1.5 hidden items-end gap-x-2 border-b border-white/5 px-2.5 pb-2 text-[9px] font-medium uppercase tracking-wide text-zinc-500 md:grid',
              hasFutureSpend
                ? 'md:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,5.5rem))]'
                : 'md:grid-cols-[minmax(0,1fr)_minmax(0,6.5rem)]',
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
                  {hasFutureSpend ? (
                    <div className="grid max-md:grid-cols-1 max-md:gap-y-2 md:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,5.5rem))] md:items-center md:gap-x-2">
                      <p
                        className="min-w-0 break-words text-sm font-medium leading-snug text-zinc-100 md:truncate md:leading-tight"
                        title={row.accountName}
                      >
                        {row.accountName}
                      </p>
                      <div className="grid grid-cols-3 gap-1 md:contents">
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
                        <p className="text-right text-sm font-semibold tabular-nums leading-tight text-zinc-50">
                          {brl(row.totalCents)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,6.5rem)] sm:items-center sm:gap-x-2">
                      <p
                        className="min-w-0 break-words text-sm font-medium leading-snug text-zinc-100 sm:truncate sm:leading-tight"
                        title={row.accountName}
                      >
                        {row.accountName}
                      </p>
                      <p className="shrink-0 text-right text-sm font-semibold tabular-nums leading-tight text-zinc-50 sm:pt-0">
                        {brl(row.totalCents)}
                      </p>
                    </div>
                  )}
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
