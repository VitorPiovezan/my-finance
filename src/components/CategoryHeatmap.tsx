import { useMaskedMoney } from '../context/AmountVisibilityContext'
import { colorForCategoryId } from './DonutChart'
import type { CategorySpendRow } from '../lib/queries/categorySpend'

export type HeatmapProps = {
  rows: CategorySpendRow[]
  /** Lista de meses (YYYY-MM) em ordem. */
  months: string[]
  /** Qual categoria (key) está expandida — destaca visualmente. Opcional. */
  expandedKey?: string | null
  /** Callback quando o usuário clica numa categoria (linha toda). */
  onCategoryClick?: (categoryId: string | null) => void
  /** Callback quando clica numa célula específica (mês de uma categoria). */
  onCellClick?: (categoryId: string | null, ym: string) => void
}

function monthShortLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!m) return ym
  const dt = new Date(y, m - 1, 1)
  return dt.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
}

function cellKey(categoryKey: string, ym: string) {
  return `${categoryKey}|${ym}`
}

/**
 * Heatmap categoria × mês. Intensidade é relativa ao MAIOR valor do ano inteiro
 * (maior gasto mês × categoria), o que destaca visualmente os picos do ano.
 *
 * Implementado em tabela HTML (simples, acessível, responsivo) em vez de SVG.
 */
export function CategoryHeatmap({
  rows,
  months,
  expandedKey = null,
  onCategoryClick,
  onCellClick,
}: HeatmapProps) {
  const { brl, brlNoSymbol } = useMaskedMoney()
  const maxCents = rows.reduce((acc, row) => {
    for (const ym of months) {
      const v = row.byMonth[ym] ?? 0
      if (v > acc) acc = v
    }
    return acc
  }, 0)

  const monthTotals: Record<string, number> = {}
  let grandTotal = 0
  for (const ym of months) monthTotals[ym] = 0
  for (const row of rows) {
    for (const ym of months) {
      const v = row.byMonth[ym] ?? 0
      monthTotals[ym] += v
      grandTotal += v
    }
  }

  if (rows.length === 0) {
    return (
      <div className="glass rounded-2xl p-8 text-center text-sm text-zinc-500">
        Sem gastos no período.
      </div>
    )
  }

  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="max-h-[640px] overflow-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur">
            <tr className="text-[11px] uppercase tracking-wide text-zinc-500">
              <th className="sticky left-0 z-20 bg-surface-2/95 px-4 py-3 text-left font-medium">
                Categoria
              </th>
              {months.map((ym) => (
                <th key={ym} className="px-1 py-3 text-center font-medium">
                  {monthShortLabel(ym)}
                </th>
              ))}
              <th className="px-4 py-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = row.categoryId ?? '__uncat__'
              const color = colorForCategoryId(row.categoryId)
              const isExpanded = expandedKey === key
              return (
                <tr
                  key={key}
                  className={[
                    'border-t border-white/5 transition-colors',
                    isExpanded ? 'bg-white/[0.04]' : 'hover:bg-white/[0.03]',
                  ].join(' ')}
                  style={{ boxShadow: `inset 3px 0 0 ${color}` }}
                >
                  <td className="sticky left-0 z-[5] bg-surface-2/95 px-4 py-2.5 backdrop-blur">
                    <button
                      type="button"
                      onClick={() => onCategoryClick?.(row.categoryId)}
                      className="flex min-w-0 items-center gap-2 text-left"
                    >
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span className="truncate text-sm font-medium text-zinc-100">
                        {row.categoryName}
                      </span>
                      <span
                        aria-hidden="true"
                        className={[
                          'text-zinc-500 transition-transform',
                          isExpanded ? 'rotate-90 text-zinc-300' : '',
                        ].join(' ')}
                      >
                        ›
                      </span>
                    </button>
                  </td>
                  {months.map((ym) => {
                    const value = row.byMonth[ym] ?? 0
                    const count = row.countByMonth[ym] ?? 0
                    const intensity = maxCents > 0 ? value / maxCents : 0
                    const alpha = Math.min(0.85, intensity * 0.95)
                    const bg =
                      value > 0
                        ? `rgba(244, 63, 94, ${alpha.toFixed(3)})`
                        : 'transparent'
                    const strong = intensity > 0.4
                    return (
                      <td
                        key={cellKey(key, ym)}
                        className="px-0.5 py-1"
                      >
                        <button
                          type="button"
                          onClick={() => onCellClick?.(row.categoryId, ym)}
                          disabled={value <= 0}
                          title={
                            value > 0
                              ? `${row.categoryName} · ${monthShortLabel(ym)} · ${brl(value)} (${count} ${count === 1 ? 'lançamento' : 'lançamentos'})`
                              : `${row.categoryName} · ${monthShortLabel(ym)} · sem gastos`
                          }
                          className={[
                            'flex h-8 w-full items-center justify-center rounded-md border text-[10px] tabular-nums transition',
                            value > 0
                              ? 'border-white/10 hover:border-white/30 cursor-pointer'
                              : 'border-white/[0.04] cursor-default',
                            strong ? 'text-white font-medium' : 'text-zinc-400',
                          ].join(' ')}
                          style={{ backgroundColor: bg }}
                        >
                          {value > 0 ? brlNoSymbol(value) : '·'}
                        </button>
                      </td>
                    )
                  })}
                  <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums text-zinc-100">
                    {brl(row.totalCents)}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-10 bg-surface-2/95 backdrop-blur">
            <tr className="border-t border-white/10 text-[11px] uppercase tracking-wide text-zinc-400">
              <th
                scope="row"
                className="sticky left-0 z-[5] bg-surface-2/95 px-4 py-3 text-left font-medium"
              >
                Total do mês
              </th>
              {months.map((ym) => {
                const v = monthTotals[ym] ?? 0
                return (
                  <td
                    key={`total-${ym}`}
                    className="px-1 py-3 text-center font-medium tabular-nums text-zinc-200"
                    title={
                      v > 0
                        ? `${monthShortLabel(ym)} · ${brl(v)}`
                        : `${monthShortLabel(ym)} · sem gastos`
                    }
                  >
                    {v > 0 ? brlNoSymbol(v) : '·'}
                  </td>
                )
              })}
              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-zinc-100">
                {brl(grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="border-t border-white/10 px-4 py-2 text-[11px] text-zinc-500">
        Intensidade relativa ao maior gasto de um único mês no ano. Clique em uma categoria para ver os lançamentos.
      </p>
    </div>
  )
}
