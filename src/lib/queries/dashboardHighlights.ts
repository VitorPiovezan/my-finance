import type { Database, SqlValue } from 'sql.js'
import { queryAll, queryOne } from '../db/query'
import { SQL_EFFECTIVE_SPEND_MONTH } from './effectiveSpendMonth'

/**
 * Queries dedicadas à Visão geral.
 *
 * A página nova não repete o detalhamento mensal de contas/cartão (isso vive em
 * "Por categoria"). Ela responde perguntas diferentes: como está o mês atual
 * em relação à média, quais categorias estão disparando, pra onde o mês caminha
 * e quais foram os extremos do ano.
 *
 * Convenções reaproveitadas:
 * - "gasto" é `amount_cents < 0` em transações não-transferência.
 * - futuros entram via `v_tx_plus_future` com `source = 'scheduled'`.
 */

/** Totais pontuais do mês usados no hero. */
export type MonthPulse = {
  /** Gastos já ocorridos (cartão + conta/carteira). Positivo. É `credit + account`. */
  realExpenseCents: number
  /**
   * Gastos já ocorridos só em cartão de crédito. Positivo.
   * Detalhe pra UI; o total que entra no hero/projeção é `realExpenseCents` +
   * `pendingExpenseCents` (contas corrente/carteira/outras entram, exceto
   * categorias transferência/investimento na query).
   */
  realExpenseCreditCents: number
  /** Gastos já ocorridos em contas/carteiras (kind != 'credit'). Positivo. Detalhe pra UI. */
  realExpenseAccountCents: number
  /** Gastos agendados pendentes ainda referentes ao mês. Positivo. */
  pendingExpenseCents: number
  /** Entradas já recebidas no mês. Positivo. */
  realIncomeCents: number
  /** Entradas agendadas pendentes no mês. Positivo. */
  pendingIncomeCents: number
  /**
   * Futuros só em conta corrente + carteira (o mesmo escopo de
   * `getLiquidityRealBalanceCents`). Usado pra “saldo previsto” sem duplicar
   * o que já entrou no saldo atual via lançamentos realizados.
   */
  pendingExpenseLiquidityCents: number
  pendingIncomeLiquidityCents: number
  /** Ritmo diário real considerando todo gasto real (cartão + conta). */
  dailyRealRateCents: number
  /** Ritmo diário real só do cartão (usado pra projetar saldo). */
  dailyRealCreditRateCents: number
  /** Gasto acumulado até o dia atual, mas no mês anterior (para comparação same-DoM). */
  previousMonthSameDayExpenseCents: number
  /** Média mensal de gastos reais nos últimos até 3 meses anteriores (mês fechado). */
  trailingMonthlyAverageCents: number
  /** Dia atual dentro do mês (1..N) usado na aritmética de ritmo. Só faz sentido pro mês corrente. */
  daysElapsed: number
  /** Dias totais do mês. */
  daysInMonth: number
}

function daysInMonthOf(ym: string): number {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/** Constrói o pulso do mês corrente. Passe `today` pra testes. */
export function getMonthPulse(db: Database, ym: string, today = new Date()): MonthPulse {
  const daysInMonth = daysInMonthOf(ym)
  const [y, m] = ym.split('-').map(Number)
  const isCurrent =
    today.getFullYear() === y && today.getMonth() + 1 === m
  const daysElapsed = isCurrent ? clamp(today.getDate(), 1, daysInMonth) : daysInMonth

  const row = queryOne(
    db,
    `
    SELECT
      COALESCE(SUM(CASE WHEN t.amount_cents < 0 AND t.source != 'scheduled' AND a.kind  = 'credit' THEN -t.amount_cents ELSE 0 END), 0) AS real_expense_credit,
      COALESCE(SUM(CASE WHEN t.amount_cents < 0 AND t.source != 'scheduled' AND a.kind != 'credit' THEN -t.amount_cents ELSE 0 END), 0) AS real_expense_account,
      COALESCE(SUM(CASE WHEN t.amount_cents < 0 AND t.source  = 'scheduled' THEN -t.amount_cents ELSE 0 END), 0) AS pending_expense,
      COALESCE(SUM(CASE WHEN t.amount_cents < 0 AND t.source  = 'scheduled' AND a.kind IN ('checking','wallet') THEN -t.amount_cents ELSE 0 END), 0) AS pending_expense_liquidity,
      COALESCE(SUM(CASE WHEN t.amount_cents > 0 AND t.source != 'scheduled' THEN  t.amount_cents ELSE 0 END), 0) AS real_income,
      COALESCE(SUM(CASE WHEN t.amount_cents > 0 AND t.source  = 'scheduled' THEN  t.amount_cents ELSE 0 END), 0) AS pending_income,
      COALESCE(SUM(CASE WHEN t.amount_cents > 0 AND t.source  = 'scheduled' AND a.kind IN ('checking','wallet') THEN  t.amount_cents ELSE 0 END), 0) AS pending_income_liquidity
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE (${SQL_EFFECTIVE_SPEND_MONTH}) = ?
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
    `,
    [ym],
  )

  const realExpenseCreditCents = Number(row?.real_expense_credit ?? 0)
  const realExpenseAccountCents = Number(row?.real_expense_account ?? 0)
  const realExpenseCents = realExpenseCreditCents + realExpenseAccountCents
  const pendingExpenseCents = Number(row?.pending_expense ?? 0)
  const pendingExpenseLiquidityCents = Number(row?.pending_expense_liquidity ?? 0)
  const realIncomeCents = Number(row?.real_income ?? 0)
  const pendingIncomeCents = Number(row?.pending_income ?? 0)
  const pendingIncomeLiquidityCents = Number(row?.pending_income_liquidity ?? 0)

  // Comparação "mesmo dia do mês passado": gasto real acumulado até `daysElapsed`
  // no mês anterior ao `ym`. Vale só pra contextualizar o ritmo — pode ser 0.
  const prevY = m === 1 ? y - 1 : y
  const prevM = m === 1 ? 12 : m - 1
  const prevYm = `${prevY}-${String(prevM).padStart(2, '0')}`
  const prevRow = queryOne(
    db,
    `
    SELECT COALESCE(SUM(-t.amount_cents), 0) AS cents
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE (${SQL_EFFECTIVE_SPEND_MONTH}) = ?
      AND t.amount_cents < 0
      AND t.source != 'scheduled'
      AND CAST(strftime('%d', t.occurred_at) AS INTEGER) <= ?
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
    `,
    [prevYm, daysElapsed],
  )
  const previousMonthSameDayExpenseCents = Number(prevRow?.cents ?? 0)

  // Média mensal de gasto nos até 3 meses fechados imediatamente anteriores.
  const prevMonths: string[] = []
  for (let i = 1; i <= 3; i++) {
    const dt = new Date(y, m - 1 - i, 1)
    prevMonths.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`)
  }
  const avgRow = queryOne(
    db,
    `
    SELECT
      COALESCE(SUM(-t.amount_cents), 0) AS cents,
      COUNT(DISTINCT (${SQL_EFFECTIVE_SPEND_MONTH})) AS months_with_data
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE (${SQL_EFFECTIVE_SPEND_MONTH}) IN (${prevMonths.map(() => '?').join(',')})
      AND t.amount_cents < 0
      AND t.source != 'scheduled'
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
    `,
    prevMonths as SqlValue[],
  )
  const avgTotal = Number(avgRow?.cents ?? 0)
  const avgMonths = Math.max(1, Number(avgRow?.months_with_data ?? 0))
  const trailingMonthlyAverageCents =
    Number(avgRow?.months_with_data ?? 0) === 0 ? 0 : Math.round(avgTotal / avgMonths)

  const dailyRealRateCents =
    daysElapsed > 0 ? Math.round(realExpenseCents / daysElapsed) : 0
  const dailyRealCreditRateCents =
    daysElapsed > 0 ? Math.round(realExpenseCreditCents / daysElapsed) : 0

  return {
    realExpenseCents,
    realExpenseCreditCents,
    realExpenseAccountCents,
    pendingExpenseCents,
    realIncomeCents,
    pendingIncomeCents,
    pendingExpenseLiquidityCents,
    pendingIncomeLiquidityCents,
    dailyRealRateCents,
    dailyRealCreditRateCents,
    previousMonthSameDayExpenseCents,
    trailingMonthlyAverageCents,
    daysElapsed,
    daysInMonth,
  }
}

/** Uma linha na comparação de categorias entre dois meses. */
export type CategoryDelta = {
  categoryId: string | null
  categoryName: string
  currentCents: number
  previousCents: number
  deltaCents: number
  /** Variação percentual relativa ao mês anterior. null quando o anterior era 0. */
  deltaPct: number | null
}

/**
 * Compara gasto por categoria entre dois meses. Retorna todas as categorias que
 * tiveram gasto em qualquer um dos dois lados. A UI escolhe como partir daqui
 * (topo de altas, topo de quedas, etc).
 */
export function compareCategoriesBetweenMonths(
  db: Database,
  currentYm: string,
  previousYm: string,
): CategoryDelta[] {
  const rows = queryAll(
    db,
    `
    SELECT
      t.category_id AS cat_id,
      COALESCE(c.name, 'Sem categoria') AS name,
      (${SQL_EFFECTIVE_SPEND_MONTH}) AS ym,
      SUM(-t.amount_cents) AS cents
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE (${SQL_EFFECTIVE_SPEND_MONTH}) IN (?, ?)
      AND t.amount_cents < 0
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
    GROUP BY t.category_id, ym
    `,
    [currentYm, previousYm],
  )

  type Acc = {
    categoryId: string | null
    categoryName: string
    currentCents: number
    previousCents: number
  }
  const byKey = new Map<string, Acc>()
  for (const r of rows) {
    const catId = r.cat_id ? String(r.cat_id) : null
    const key = catId ?? '__uncat__'
    const ym = String(r.ym ?? '')
    const cents = Number(r.cents ?? 0)
    let acc = byKey.get(key)
    if (!acc) {
      acc = {
        categoryId: catId,
        categoryName: String(r.name ?? 'Sem categoria'),
        currentCents: 0,
        previousCents: 0,
      }
      byKey.set(key, acc)
    }
    if (ym === currentYm) acc.currentCents += cents
    else if (ym === previousYm) acc.previousCents += cents
  }

  const out: CategoryDelta[] = []
  for (const acc of byKey.values()) {
    const deltaCents = acc.currentCents - acc.previousCents
    const deltaPct = acc.previousCents === 0 ? null : deltaCents / acc.previousCents
    out.push({
      categoryId: acc.categoryId,
      categoryName: acc.categoryName,
      currentCents: acc.currentCents,
      previousCents: acc.previousCents,
      deltaCents,
      deltaPct,
    })
  }
  return out
}

export type YearRecords = {
  /** Maior gasto individual do ano (valor em módulo). */
  biggestExpense: {
    id: string
    description: string
    amountCents: number
    occurredAt: string
    accountName: string
    categoryName: string | null
  } | null
  /** Categoria que mais consumiu no ano. */
  topCategory: { name: string; cents: number } | null
  /** Mês com melhor sobra (income - expense) no ano. */
  bestMonth: { ym: string; leftoverCents: number } | null
  /** Mês com pior sobra. Pode ser negativo. */
  worstMonth: { ym: string; leftoverCents: number } | null
  /** Meses do ano que tiveram algum lançamento. */
  monthsCovered: number
}

/** Sumário de "destaques" do ano. Usa ano civil (YYYY). */
export function getYearRecords(db: Database, year: number): YearRecords {
  const prefix = `${year}-%`

  const biggest = queryOne(
    db,
    `
    SELECT
      t.id,
      t.description,
      t.amount_cents,
      t.occurred_at,
      a.name AS account_name,
      c.name AS category_name
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE (${SQL_EFFECTIVE_SPEND_MONTH}) LIKE ?
      AND t.amount_cents < 0
      AND t.source != 'scheduled'
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
    ORDER BY t.amount_cents ASC
    LIMIT 1
    `,
    [prefix],
  )

  const top = queryOne(
    db,
    `
    SELECT COALESCE(c.name, 'Sem categoria') AS name, SUM(-t.amount_cents) AS cents
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE (${SQL_EFFECTIVE_SPEND_MONTH}) LIKE ?
      AND t.amount_cents < 0
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
    GROUP BY t.category_id
    ORDER BY cents DESC
    LIMIT 1
    `,
    [prefix],
  )

  const months = queryAll(
    db,
    `
    SELECT
      (${SQL_EFFECTIVE_SPEND_MONTH}) AS ym,
      COALESCE(SUM(CASE WHEN t.amount_cents > 0 AND t.source != 'scheduled' THEN  t.amount_cents ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN t.amount_cents < 0 AND t.source != 'scheduled' THEN -t.amount_cents ELSE 0 END), 0) AS expense
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE (${SQL_EFFECTIVE_SPEND_MONTH}) LIKE ?
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
    GROUP BY ym
    HAVING income > 0 OR expense > 0
    `,
    [prefix],
  )

  let best: { ym: string; leftoverCents: number } | null = null
  let worst: { ym: string; leftoverCents: number } | null = null
  for (const r of months) {
    const ym = String(r.ym ?? '')
    const leftover = Number(r.income ?? 0) - Number(r.expense ?? 0)
    if (best == null || leftover > best.leftoverCents) best = { ym, leftoverCents: leftover }
    if (worst == null || leftover < worst.leftoverCents) worst = { ym, leftoverCents: leftover }
  }

  return {
    biggestExpense: biggest
      ? {
          id: String(biggest.id),
          description: String(biggest.description ?? ''),
          amountCents: Number(biggest.amount_cents ?? 0),
          occurredAt: String(biggest.occurred_at ?? ''),
          accountName: String(biggest.account_name ?? ''),
          categoryName: biggest.category_name ? String(biggest.category_name) : null,
        }
      : null,
    topCategory: top && top.cents != null ? { name: String(top.name ?? '—'), cents: Number(top.cents) } : null,
    bestMonth: best,
    worstMonth: worst,
    monthsCovered: months.length,
  }
}

/**
 * Saldo líquido em contas corrente + carteira: Σ (lançamentos + offset de calibração).
 * O offset é ajustado na tela Contas para bater com o extrato; novos lançamentos
 * nessas contas atualizam o total automaticamente. Cartão de crédito não entra.
 */
export function getLiquidityRealBalanceCents(db: Database): number {
  const row = queryOne(
    db,
    `SELECT COALESCE(SUM(
         COALESCE((SELECT SUM(amount_cents) FROM transactions WHERE account_id = a.id), 0)
         + a.real_balance_offset_cents
       ), 0) AS total
     FROM accounts a
     WHERE a.deleted_at IS NULL AND a.kind IN ('checking', 'wallet')`,
  )
  return Number(row?.total ?? 0)
}
