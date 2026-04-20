import { motion } from 'framer-motion'
import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { colorForCategoryId } from '../components/DonutChart'
import { useFinanceDb } from '../context/useFinanceDb'
import { formatBRL } from '../lib/money'
import {
  compareCategoriesBetweenMonths,
  getMonthPulse,
  getYearRecords,
  type CategoryDelta,
  type MonthPulse,
  type YearRecords,
} from '../lib/queries/dashboardHighlights'
import { ymNow, ymPrevious } from '../lib/queries/spendSummary'

function formatYmLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const dt = new Date(y, m - 1, 1)
  const label = dt.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function formatShortMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const dt = new Date(y, m - 1, 1)
  const label = dt.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
  return label.replace('.', '').replace(' de ', '/')
}

function signedBRL(cents: number): string {
  if (cents > 0) return `+${formatBRL(cents)}`
  if (cents < 0) return `-${formatBRL(Math.abs(cents))}`
  return formatBRL(0)
}

function pct(ratio: number): string {
  const v = Math.round(ratio * 100)
  return `${v > 0 ? '+' : ''}${v}%`
}

function toneForLeftover(cents: number): string {
  if (cents < 0) return 'text-rose-200'
  if (cents > 0) return 'text-emerald-200'
  return 'text-white'
}

function Section({
  title,
  hint,
  children,
  delay,
}: {
  title: string
  hint?: string
  children: ReactNode
  delay: number
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-zinc-300">{title}</h2>
        {hint ? <span className="text-[11px] text-zinc-500">{hint}</span> : null}
      </div>
      {children}
    </motion.section>
  )
}

function StatColumn({
  label,
  value,
  valueClassName = 'text-white',
  hint,
}: {
  label: string
  value: string
  valueClassName?: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${valueClassName}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-zinc-500">{hint}</p> : null}
    </div>
  )
}

/**
 * Hero do mês atual. Entrega os três números-chave (ganho, gasto, sobra
 * projetada) de uma vez, com a linha de ritmo em cima explicando "estamos
 * caminhando em que ritmo?" e a barra de progresso comparando com a média
 * dos últimos meses mesmo dia.
 */
function MonthHero({ ym, pulse }: { ym: string; pulse: MonthPulse }) {
  const {
    realExpenseCents,
    realExpenseCreditCents,
    realExpenseAccountCents,
    pendingExpenseCents,
    realIncomeCents,
    pendingIncomeCents,
    dailyRealRateCents,
    previousMonthSameDayExpenseCents,
    trailingMonthlyAverageCents,
    daysElapsed,
    daysInMonth,
  } = pulse

  // Regra do mês atual: gasto que forma saldo = cartão + futuros. Conta
  // corrente/carteira aparece como informação, mas fica fora do saldo pra
  // evitar contar pagamento de cartão duas vezes.
  const spendForLeftoverCents = realExpenseCreditCents + pendingExpenseCents
  const totalIncome = realIncomeCents + pendingIncomeCents
  const projectedLeftover = totalIncome - spendForLeftoverCents

  // Barra de "gasto do mês em relação à média". Normaliza pelo gasto médio
  // mensal dos últimos meses — se já passamos disso, enche e fica vermelho.
  const expectedSoFarCents =
    trailingMonthlyAverageCents > 0
      ? Math.round((trailingMonthlyAverageCents * daysElapsed) / daysInMonth)
      : 0
  const ratioOfAvg =
    trailingMonthlyAverageCents > 0 ? realExpenseCents / trailingMonthlyAverageCents : 0
  const progressFill = Math.max(0, Math.min(1, ratioOfAvg))
  const overLimit = ratioOfAvg > 1
  const pctOfMonth = Math.round((daysElapsed / daysInMonth) * 100)

  const prevDiff =
    previousMonthSameDayExpenseCents > 0
      ? (realExpenseCents - previousMonthSameDayExpenseCents) / previousMonthSameDayExpenseCents
      : null

  return (
    <div className="glass relative overflow-hidden rounded-2xl p-6">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/[0.08] via-transparent to-accent-2/[0.06]" />
      <div className="relative space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Mês atual
            </p>
            <h3 className="text-2xl font-semibold tracking-tight text-white">
              {formatYmLabel(ym)}
            </h3>
          </div>
          <p className="text-[11px] text-zinc-500">
            Dia {daysElapsed} de {daysInMonth} · {pctOfMonth}% do mês
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatColumn
            label="Ganhos"
            value={formatBRL(totalIncome)}
            valueClassName="text-emerald-200"
            hint={
              pendingIncomeCents > 0
                ? `${formatBRL(realIncomeCents)} real · ${formatBRL(pendingIncomeCents)} futuro`
                : 'Só entradas reais no mês'
            }
          />
          <StatColumn
            label="Gastos (cartão + futuros)"
            value={formatBRL(spendForLeftoverCents)}
            valueClassName="text-rose-200"
            hint={
              pendingExpenseCents > 0
                ? `${formatBRL(realExpenseCreditCents)} cartão · ${formatBRL(pendingExpenseCents)} futuro`
                : `${formatBRL(realExpenseCreditCents)} no cartão`
            }
          />
          <StatColumn
            label="Saldo do mês"
            value={signedBRL(projectedLeftover)}
            valueClassName={toneForLeftover(projectedLeftover)}
            hint="Ganhos − (cartão + futuros)"
          />
        </div>

        {realExpenseAccountCents > 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5 text-[11px] text-zinc-400">
            <span className="font-medium text-zinc-300">
              + {formatBRL(realExpenseAccountCents)}
            </span>{' '}
            saíram de contas/carteiras neste mês —{' '}
            <span className="text-zinc-500">
              não entram no saldo pra não contar pagamento do cartão duas vezes.
            </span>
          </div>
        ) : null}

        {trailingMonthlyAverageCents > 0 ? (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Ritmo vs. média dos últimos meses
              </p>
              <p className={`text-[11px] tabular-nums ${overLimit ? 'text-rose-200' : 'text-zinc-400'}`}>
                {formatBRL(realExpenseCents)} / {formatBRL(trailingMonthlyAverageCents)} ·{' '}
                {Math.round(ratioOfAvg * 100)}%
              </p>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className={`h-full rounded-full ${overLimit ? 'bg-rose-400/80' : 'bg-emerald-400/80'}`}
                style={{ width: `${Math.max(2, progressFill * 100)}%` }}
              />
              {expectedSoFarCents > 0 && trailingMonthlyAverageCents > 0 ? (
                <div
                  className="absolute top-0 h-full w-px bg-white/40"
                  title={`Esperado até aqui: ${formatBRL(expectedSoFarCents)}`}
                  style={{ left: `${(daysElapsed / daysInMonth) * 100}%` }}
                />
              ) : null}
            </div>
            <p className="mt-1.5 text-[11px] text-zinc-500">
              A marca branca no meio é onde a gente <em>deveria</em> estar no dia {daysElapsed}.
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Ritmo diário real
            </p>
            <p className="mt-1 text-lg font-semibold tracking-tight text-white tabular-nums">
              {formatBRL(dailyRealRateCents)} <span className="text-xs font-normal text-zinc-500">/ dia</span>
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {formatBRL(realExpenseCents)} em {daysElapsed} {daysElapsed === 1 ? 'dia' : 'dias'}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Mês passado até o dia {daysElapsed}
            </p>
            <p className="mt-1 text-lg font-semibold tracking-tight text-white tabular-nums">
              {formatBRL(previousMonthSameDayExpenseCents)}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {prevDiff == null
                ? 'Sem referência do mês passado na mesma altura.'
                : prevDiff > 0
                  ? `Você está ${pct(prevDiff)} acima do mesmo dia do mês passado.`
                  : prevDiff < 0
                    ? `Você está ${pct(prevDiff)} abaixo do mesmo dia do mês passado.`
                    : 'Empatado com o mesmo dia do mês passado.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Projeção de fim do mês. Combina o ritmo diário (só gastos reais até agora)
 * com os gastos futuros já agendados pra estimar onde o mês vai fechar.
 */
function MonthProjectionCard({ ym, pulse }: { ym: string; pulse: MonthPulse }) {
  const {
    realExpenseCreditCents,
    realExpenseAccountCents,
    pendingExpenseCents,
    realIncomeCents,
    pendingIncomeCents,
    dailyRealCreditRateCents,
    daysElapsed,
    daysInMonth,
  } = pulse

  const daysLeft = Math.max(0, daysInMonth - daysElapsed)
  // Mesma regra do hero: projeção considera só cartão + futuros pra formar
  // saldo (gastos de conta ficam fora pra evitar contar pagamento do cartão
  // duas vezes). O ritmo aqui também é só do cartão.
  const projectedRhythmSpendCents = dailyRealCreditRateCents * daysLeft
  const projectedTotalExpense =
    realExpenseCreditCents + projectedRhythmSpendCents + pendingExpenseCents
  const projectedTotalIncome = realIncomeCents + pendingIncomeCents
  const projectedLeftover = projectedTotalIncome - projectedTotalExpense

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Projeção de fim do mês
        </p>
        <p className="text-[11px] text-zinc-500">
          Baseado em {formatBRL(dailyRealCreditRateCents)}/dia (cartão) × {daysLeft}{' '}
          {daysLeft === 1 ? 'dia restante' : 'dias restantes'}
        </p>
      </div>

      <p className="mt-3 text-sm text-zinc-300">
        No ritmo atual,{' '}
        <strong className="text-white">{formatYmLabel(ym)}</strong> deve fechar com:
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <StatColumn
          label="Gasto projetado"
          value={formatBRL(projectedTotalExpense)}
          valueClassName="text-rose-200"
          hint={`Cartão ${formatBRL(realExpenseCreditCents)} + proj. ${formatBRL(projectedRhythmSpendCents)}${
            pendingExpenseCents > 0 ? ` + fut. ${formatBRL(pendingExpenseCents)}` : ''
          }`}
        />
        <StatColumn
          label="Ganho projetado"
          value={formatBRL(projectedTotalIncome)}
          valueClassName="text-emerald-200"
          hint={
            pendingIncomeCents > 0
              ? `Real ${formatBRL(realIncomeCents)} + fut. ${formatBRL(pendingIncomeCents)}`
              : 'Só entradas já confirmadas'
          }
        />
        <StatColumn
          label="Sobra projetada"
          value={signedBRL(projectedLeftover)}
          valueClassName={toneForLeftover(projectedLeftover)}
          hint={
            projectedLeftover < 0
              ? 'Cuidado: projeção aponta pra fechar no vermelho.'
              : 'Projeção pra fechar no verde.'
          }
        />
      </div>

      {realExpenseAccountCents > 0 ? (
        <p className="mt-3 text-[11px] text-zinc-500">
          <span className="text-zinc-400">
            + {formatBRL(realExpenseAccountCents)} em contas/carteiras
          </span>{' '}
          não entram na projeção pra não duplicar pagamento do cartão.
        </p>
      ) : null}
    </div>
  )
}

function DeltaRow({ row, kind }: { row: CategoryDelta; kind: 'up' | 'down' }) {
  const color = colorForCategoryId(row.categoryId)
  const isUp = kind === 'up'
  const arrow = isUp ? '↑' : '↓'
  const arrowColor = isUp ? 'text-rose-300' : 'text-emerald-300'
  const deltaLabel =
    row.deltaPct == null
      ? row.previousCents === 0
        ? 'Novo'
        : ''
      : pct(row.deltaPct)
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-zinc-100">{row.categoryName}</p>
        <p className="mt-0.5 truncate text-[11px] text-zinc-500">
          {formatBRL(row.currentCents)} agora · antes {formatBRL(row.previousCents)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={`text-sm font-semibold tabular-nums ${arrowColor}`}>
          <span aria-hidden="true">{arrow}</span> {signedBRL(row.deltaCents)}
        </p>
        {deltaLabel ? (
          <p className="text-[11px] text-zinc-500 tabular-nums">{deltaLabel}</p>
        ) : null}
      </div>
    </li>
  )
}

function VariationCards({
  currentYm,
  previousYm,
  deltas,
}: {
  currentYm: string
  previousYm: string
  deltas: CategoryDelta[]
}) {
  const ups = deltas
    .filter((d) => d.deltaCents > 0)
    .sort((a, b) => b.deltaCents - a.deltaCents)
    .slice(0, 3)
  const downs = deltas
    .filter((d) => d.deltaCents < 0)
    .sort((a, b) => a.deltaCents - b.deltaCents)
    .slice(0, 3)

  if (ups.length === 0 && downs.length === 0) {
    return (
      <div className="glass rounded-2xl p-5 text-sm text-zinc-400">
        Ainda não dá pra comparar {formatShortMonthLabel(currentYm)} com{' '}
        {formatShortMonthLabel(previousYm)} — falta dado em algum dos dois.
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="glass rounded-2xl p-5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Subiram mais</p>
          <span className="text-[11px] text-zinc-500">
            vs. {formatShortMonthLabel(previousYm)}
          </span>
        </div>
        {ups.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Nenhuma categoria subiu neste mês.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {ups.map((row) => (
              <DeltaRow key={row.categoryId ?? '__uncat_up__'} row={row} kind="up" />
            ))}
          </ul>
        )}
      </div>
      <div className="glass rounded-2xl p-5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Caíram mais</p>
          <span className="text-[11px] text-zinc-500">
            vs. {formatShortMonthLabel(previousYm)}
          </span>
        </div>
        {downs.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Nenhuma categoria caiu neste mês.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {downs.map((row) => (
              <DeltaRow key={row.categoryId ?? '__uncat_down__'} row={row} kind="down" />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function RecordCard({
  label,
  value,
  subtitle,
  tone = 'neutral',
  to,
}: {
  label: string
  value: string
  subtitle?: string
  tone?: 'neutral' | 'rose' | 'emerald'
  to?: string
}) {
  const color =
    tone === 'rose' ? 'text-rose-200' : tone === 'emerald' ? 'text-emerald-200' : 'text-white'
  const inner = (
    <div className="glass h-full rounded-2xl p-5 transition group-hover:border-white/20 group-hover:bg-white/[0.05]">
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-2 text-xl font-semibold tracking-tight tabular-nums ${color}`}>{value}</p>
      {subtitle ? <p className="mt-1 text-xs text-zinc-400">{subtitle}</p> : null}
    </div>
  )
  if (to)
    return (
      <Link to={to} aria-label={`${label}: ${value}`} className="group block outline-none">
        {inner}
      </Link>
    )
  return <div className="group block">{inner}</div>
}

function RecordsGrid({ year, records }: { year: number; records: YearRecords }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <RecordCard
        label="Maior gasto do ano"
        value={records.biggestExpense ? formatBRL(-records.biggestExpense.amountCents) : '—'}
        subtitle={
          records.biggestExpense
            ? `${records.biggestExpense.description} · ${records.biggestExpense.accountName} · ${records.biggestExpense.occurredAt.slice(0, 10)}`
            : `Nenhum gasto registrado em ${year}`
        }
        tone="rose"
      />
      <RecordCard
        label="Top categoria do ano"
        value={records.topCategory ? formatBRL(records.topCategory.cents) : '—'}
        subtitle={records.topCategory ? records.topCategory.name : 'Sem dados de categoria ainda'}
        tone="rose"
      />
      <RecordCard
        label="Melhor mês de sobra"
        value={records.bestMonth ? signedBRL(records.bestMonth.leftoverCents) : '—'}
        subtitle={
          records.bestMonth
            ? `${formatYmLabel(records.bestMonth.ym)} — ganhos − gastos`
            : 'Precisa de pelo menos um mês com dados'
        }
        tone={records.bestMonth && records.bestMonth.leftoverCents >= 0 ? 'emerald' : 'neutral'}
        to={records.bestMonth ? `/por-categoria?period=${records.bestMonth.ym}` : undefined}
      />
      <RecordCard
        label="Pior mês de sobra"
        value={records.worstMonth ? signedBRL(records.worstMonth.leftoverCents) : '—'}
        subtitle={
          records.worstMonth
            ? `${formatYmLabel(records.worstMonth.ym)} — ganhos − gastos`
            : 'Precisa de pelo menos um mês com dados'
        }
        tone={records.worstMonth && records.worstMonth.leftoverCents < 0 ? 'rose' : 'neutral'}
        to={records.worstMonth ? `/por-categoria?period=${records.worstMonth.ym}` : undefined}
      />
    </div>
  )
}

export function DashboardPage() {
  const { getDb, version } = useFinanceDb()
  const cur = ymNow()
  const prev = ymPrevious(cur)
  const year = Number(cur.slice(0, 4))

  const { pulse, deltas, records } = useMemo(() => {
    const db = getDb()
    return {
      pulse: getMonthPulse(db, cur),
      deltas: compareCategoriesBetweenMonths(db, cur, prev),
      records: getYearRecords(db, year),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida leituras após mutações no SQLite
  }, [getDb, version, cur, prev, year])

  const hasAnyMonthData =
    pulse.realExpenseCents +
      pulse.realIncomeCents +
      pulse.pendingExpenseCents +
      pulse.pendingIncomeCents >
    0

  return (
    <div className="space-y-8">
      <header>
        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-semibold tracking-tight text-white"
        >
          Visão geral
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Um apanhado rápido do mês atual, pra onde ele caminha e o que mudou em relação ao
          mês passado. Pro detalhe por categoria, conta ou cartão, use{' '}
          <Link to="/por-categoria" className="text-accent-2 hover:underline">
            Por categoria
          </Link>
          .
        </p>
      </header>

      {hasAnyMonthData ? (
        <>
          <Section title="Como está o mês" delay={0}>
            <MonthHero ym={cur} pulse={pulse} />
          </Section>

          <Section
            title="Projeção"
            hint={`Do ritmo real + futuros agendados em ${formatYmLabel(cur)}`}
            delay={0.05}
          >
            <MonthProjectionCard ym={cur} pulse={pulse} />
          </Section>

          <Section
            title="Destaques de variação"
            hint={`${formatShortMonthLabel(cur)} vs. ${formatShortMonthLabel(prev)}`}
            delay={0.1}
          >
            <VariationCards currentYm={cur} previousYm={prev} deltas={deltas} />
          </Section>

          <Section
            title="Recordes do ano"
            hint={`${year} · ${records.monthsCovered} ${
              records.monthsCovered === 1 ? 'mês com dados' : 'meses com dados'
            }`}
            delay={0.15}
          >
            <RecordsGrid year={year} records={records} />
          </Section>
        </>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-6 text-sm text-zinc-400"
        >
          Nenhum lançamento em {formatYmLabel(cur)} ainda. Use{' '}
          <Link to="/sincronizar" className="text-accent-2 hover:underline">
            Sincronizar
          </Link>{' '}
          pra importar um extrato, ou adicione um lançamento manual em{' '}
          <Link to="/lancamentos" className="text-accent-2 hover:underline">
            Lançamentos
          </Link>
          .
        </motion.div>
      )}
    </div>
  )
}
