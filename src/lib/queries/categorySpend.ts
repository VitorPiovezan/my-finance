import type { Database, SqlValue } from 'sql.js'
import { queryAll, queryOne } from '../db/query'
import { SQL_EFFECTIVE_SPEND_MONTH } from './effectiveSpendMonth'

/** `AND t.account_id IN (…)` quando `ids` não vazio; caso contrário string vazia. */
function accountIdClause(ids: string[] | undefined): { clause: string; params: SqlValue[] } {
  if (!ids?.length) return { clause: '', params: [] }
  const qs = ids.map(() => '?').join(', ')
  return { clause: ` AND t.account_id IN (${qs})`, params: [...ids] as SqlValue[] }
}

/**
 * Análise de gastos por categoria em um período (ano ou mês).
 *
 * Define como "gasto" toda transação com `amount_cents < 0` (saída) em qualquer conta,
 * excluindo transferências entre contas próprias (kind='transfer'). Dessa forma, uma
 * compra no cartão aparece como gasto, mas o pagamento da fatura (que é transferência)
 * não é contabilizado em dobro.
 */

export type CategorySpendRow = {
  categoryId: string | null
  categoryName: string
  categoryKind: 'expense' | 'income' | 'transfer' | 'uncategorized' | string
  /** Total gasto em centavos no período inteiro. */
  totalCents: number
  /** Contagem de lançamentos no período. */
  count: number
  /** Gasto por mês (YYYY-MM -> cents). Só populado em consultas anuais. */
  byMonth: Record<string, number>
  /** Contagem por mês (YYYY-MM -> n). */
  countByMonth: Record<string, number>
}

export type CategorySpendTransaction = {
  id: string
  occurredAt: string
  ym: string
  description: string
  amountCents: number
  accountName: string
  accountKind: string
  categoryId: string | null
  categoryName: string | null
}

/** Gasto agregado por conta em um único mês (mesmas regras que getMonthCategorySpend). */
export type AccountSpendRow = {
  accountId: string
  accountName: string
  accountKind: string
  /** Realizado: `source != 'scheduled'` (já lançado). */
  realCents: number
  /** Futuro: `source = 'scheduled'` (agendado / previsto no mês). */
  futureCents: number
  /** Real + futuro (mesma soma do ranking por categoria). */
  totalCents: number
  count: number
  realCount: number
  futureCount: number
}

export type PeriodSummary = {
  /** Gasto real (sem futuros). */
  totalCents: number
  /** Parcela do gasto real com cartão de crédito (account.kind = 'credit'). */
  creditTotalCents: number
  /** Parcela do gasto real com contas não-crédito (corrente, wallet, poupança...). */
  accountTotalCents: number
  /** Lançamentos reais no cartão de crédito. */
  creditTransactionCount: number
  /** Lançamentos reais em contas não-crédito. */
  accountTransactionCount: number
  /** Média mensal gasta no período (só gasto real; divide pela qtd de meses com dados). */
  monthlyAverageCents: number
  /** Quantidade de categorias com pelo menos um gasto real. */
  categoriesWithSpend: number
  /** Nome da categoria que mais consumiu (considerando só gasto real). */
  topCategoryName: string | null
  topCategoryCents: number
  /** Quantidade total de lançamentos reais de gasto que entraram no período. */
  transactionCount: number
  /** Soma de gastos futuros (scheduled_payments convertidos via view). */
  futureExpenseCents: number
  /** Quantidade de futuros de gasto no período. */
  futureExpenseCount: number
  /** Soma de entradas reais (receitas) no período, sem transferências. */
  incomeCents: number
  /** Quantidade de lançamentos de entrada no período. */
  incomeCount: number
  /** Soma de ganhos futuros no período (scheduled_payments com categoria income). */
  futureIncomeCents: number
  /** Quantidade de futuros de ganho no período. */
  futureIncomeCount: number
}

/** Retorna anos (`YYYY`) que têm pelo menos um lançamento. Ordenado desc. */
export function listYearsWithRecords(db: Database): number[] {
  const rows = queryAll(
    db,
    `
    SELECT DISTINCT SUBSTR(${SQL_EFFECTIVE_SPEND_MONTH}, 1, 4) AS y
    FROM v_tx_plus_future t
    WHERE (${SQL_EFFECTIVE_SPEND_MONTH}) IS NOT NULL
    ORDER BY y DESC
    `,
  )
  const out: number[] = []
  for (const r of rows) {
    const v = Number(r.y)
    if (Number.isFinite(v) && v >= 1900 && v <= 3000) out.push(v)
  }
  return out
}

/**
 * Constrói a matriz `categoria × mês` com totais por mês para o ano informado.
 * Ordena por `totalCents` desc (categorias que mais gastaram no ano primeiro).
 */
export function getYearCategoryMatrix(db: Database, year: number): CategorySpendRow[] {
  const prefix = `${year}-%`
  const rows = queryAll(
    db,
    `
    SELECT
      t.category_id AS category_id,
      COALESCE(c.name, 'Sem categoria') AS category_name,
      COALESCE(c.kind, 'uncategorized') AS category_kind,
      (${SQL_EFFECTIVE_SPEND_MONTH}) AS ym,
      SUM(-t.amount_cents) AS spend_cents,
      COUNT(*) AS cnt
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE (${SQL_EFFECTIVE_SPEND_MONTH}) LIKE ?
      AND t.amount_cents < 0
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
    GROUP BY t.category_id, ym
    `,
    [prefix],
  )

  const byCat = new Map<string, CategorySpendRow>()
  for (const r of rows) {
    const catId = r.category_id ? String(r.category_id) : null
    const key = catId ?? '__uncat__'
    const ym = String(r.ym ?? '')
    const spend = Number(r.spend_cents ?? 0)
    const cnt = Number(r.cnt ?? 0)
    let row = byCat.get(key)
    if (!row) {
      row = {
        categoryId: catId,
        categoryName: String(r.category_name ?? 'Sem categoria'),
        categoryKind: String(r.category_kind ?? 'uncategorized'),
        totalCents: 0,
        count: 0,
        byMonth: {},
        countByMonth: {},
      }
      byCat.set(key, row)
    }
    row.byMonth[ym] = (row.byMonth[ym] ?? 0) + spend
    row.countByMonth[ym] = (row.countByMonth[ym] ?? 0) + cnt
    row.totalCents += spend
    row.count += cnt
  }

  return Array.from(byCat.values()).sort((a, b) => b.totalCents - a.totalCents)
}

/** Gasto por categoria em um único mês (YYYY-MM). Opcionalmente restringe a contas. */
export function getMonthCategorySpend(
  db: Database,
  ym: string,
  accountIds?: string[],
): CategorySpendRow[] {
  const af = accountIdClause(accountIds)
  const rows = queryAll(
    db,
    `
    SELECT
      t.category_id AS category_id,
      COALESCE(c.name, 'Sem categoria') AS category_name,
      COALESCE(c.kind, 'uncategorized') AS category_kind,
      SUM(-t.amount_cents) AS spend_cents,
      COUNT(*) AS cnt
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE (${SQL_EFFECTIVE_SPEND_MONTH}) = ?
      AND t.amount_cents < 0
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
      ${af.clause}
    GROUP BY t.category_id
    ORDER BY spend_cents DESC
    `,
    [ym, ...af.params],
  )
  return rows.map((r) => ({
    categoryId: r.category_id ? String(r.category_id) : null,
    categoryName: String(r.category_name ?? 'Sem categoria'),
    categoryKind: String(r.category_kind ?? 'uncategorized'),
    totalCents: Number(r.spend_cents ?? 0),
    count: Number(r.cnt ?? 0),
    byMonth: { [ym]: Number(r.spend_cents ?? 0) },
    countByMonth: { [ym]: Number(r.cnt ?? 0) },
  }))
}

/** Gasto por conta registrada em um único mês (YYYY-MM), ordenado do maior total para o menor. */
export function getMonthAccountSpend(db: Database, ym: string, accountIds?: string[]): AccountSpendRow[] {
  const af = accountIdClause(accountIds)
  const rows = queryAll(
    db,
    `
    SELECT
      a.id AS account_id,
      a.name AS account_name,
      a.kind AS account_kind,
      COALESCE(SUM(-t.amount_cents), 0) AS total_cents,
      COALESCE(SUM(CASE WHEN t.source != 'scheduled' THEN -t.amount_cents ELSE 0 END), 0) AS real_cents,
      COALESCE(SUM(CASE WHEN t.source = 'scheduled' THEN -t.amount_cents ELSE 0 END), 0) AS future_cents,
      COUNT(*) AS cnt,
      SUM(CASE WHEN t.source != 'scheduled' THEN 1 ELSE 0 END) AS real_cnt,
      SUM(CASE WHEN t.source = 'scheduled' THEN 1 ELSE 0 END) AS future_cnt
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE (${SQL_EFFECTIVE_SPEND_MONTH}) = ?
      AND t.amount_cents < 0
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
      ${af.clause}
    GROUP BY t.account_id
    ORDER BY total_cents DESC
    `,
    [ym, ...af.params],
  )
  return rows.map((r) => ({
    accountId: String(r.account_id ?? ''),
    accountName: String(r.account_name ?? 'Conta'),
    accountKind: String(r.account_kind ?? 'other'),
    realCents: Number(r.real_cents ?? 0),
    futureCents: Number(r.future_cents ?? 0),
    totalCents: Number(r.total_cents ?? 0),
    count: Number(r.cnt ?? 0),
    realCount: Number(r.real_cnt ?? 0),
    futureCount: Number(r.future_cnt ?? 0),
  }))
}

/**
 * Retorna o sumário do período. `periodPattern` aceita tanto `YYYY` (ano, usa `LIKE`) quanto
 * `YYYY-MM` (um mês, usa `=`).
 */
export function getPeriodSummary(
  db: Database,
  periodPattern: string,
  accountIds?: string[],
): PeriodSummary {
  const isMonth = /^\d{4}-\d{2}$/.test(periodPattern)
  const whereFrag = isMonth
    ? `(${SQL_EFFECTIVE_SPEND_MONTH}) = ?`
    : `(${SQL_EFFECTIVE_SPEND_MONTH}) LIKE ?`
  const param: SqlValue = isMonth ? periodPattern : `${periodPattern}-%`
  const af = accountIdClause(accountIds)
  const baseParams: SqlValue[] = [param, ...af.params]
  // Totais do período incluindo futuros no total geral, mas segregando o split
  // Cartão/Contas (reais) de Gastos futuros (scheduled). Dessa forma os cards
  // somam corretamente (credit + account + future = total) e o ranking/heatmap
  // abaixo, que inclui futuros, permanece consistente com esses totais.
  const totalRow = queryOne(
    db,
    `
    SELECT
      COALESCE(SUM(-t.amount_cents), 0) AS total_cents,
      COALESCE(SUM(CASE WHEN a.kind = 'credit' AND t.source != 'scheduled' THEN -t.amount_cents ELSE 0 END), 0) AS credit_cents,
      COALESCE(SUM(CASE WHEN a.kind != 'credit' AND t.source != 'scheduled' THEN -t.amount_cents ELSE 0 END), 0) AS account_cents,
      SUM(CASE WHEN a.kind = 'credit' AND t.source != 'scheduled' THEN 1 ELSE 0 END) AS credit_cnt,
      SUM(CASE WHEN a.kind != 'credit' AND t.source != 'scheduled' THEN 1 ELSE 0 END) AS account_cnt,
      COUNT(*) AS cnt,
      COUNT(DISTINCT (${SQL_EFFECTIVE_SPEND_MONTH})) AS months_with_data,
      COUNT(DISTINCT COALESCE(t.category_id, '__uncat__')) AS category_count
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE ${whereFrag}
      AND t.amount_cents < 0
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
      ${af.clause}
    `,
    baseParams,
  )
  // Maior categoria considera tudo que aparece no ranking (real + futuros).
  const topRow = queryOne(
    db,
    `
    SELECT COALESCE(c.name, 'Sem categoria') AS name, SUM(-t.amount_cents) AS cents
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE ${whereFrag}
      AND t.amount_cents < 0
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
      ${af.clause}
    GROUP BY t.category_id
    ORDER BY cents DESC
    LIMIT 1
    `,
    baseParams,
  )
  // Futuros (só gasto) + receita real no mesmo período.
  const extraRow = queryOne(
    db,
    `
    SELECT
      COALESCE(SUM(CASE WHEN t.amount_cents < 0 AND t.source = 'scheduled' THEN -t.amount_cents ELSE 0 END), 0) AS future_expense_cents,
      SUM(CASE WHEN t.amount_cents < 0 AND t.source = 'scheduled' THEN 1 ELSE 0 END) AS future_expense_cnt,
      COALESCE(SUM(CASE WHEN t.amount_cents > 0 AND t.source != 'scheduled' THEN t.amount_cents ELSE 0 END), 0) AS income_cents,
      SUM(CASE WHEN t.amount_cents > 0 AND t.source != 'scheduled' THEN 1 ELSE 0 END) AS income_cnt,
      COALESCE(SUM(CASE WHEN t.amount_cents > 0 AND t.source = 'scheduled' THEN t.amount_cents ELSE 0 END), 0) AS future_income_cents,
      SUM(CASE WHEN t.amount_cents > 0 AND t.source = 'scheduled' THEN 1 ELSE 0 END) AS future_income_cnt
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE ${whereFrag}
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
      ${af.clause}
    `,
    baseParams,
  )
  const total = Number(totalRow?.total_cents ?? 0)
  const monthsWithData = Math.max(1, Number(totalRow?.months_with_data ?? 1))
  return {
    totalCents: total,
    creditTotalCents: Number(totalRow?.credit_cents ?? 0),
    accountTotalCents: Number(totalRow?.account_cents ?? 0),
    creditTransactionCount: Number(totalRow?.credit_cnt ?? 0),
    accountTransactionCount: Number(totalRow?.account_cnt ?? 0),
    monthlyAverageCents: Math.round(total / monthsWithData),
    categoriesWithSpend: Number(totalRow?.category_count ?? 0),
    transactionCount: Number(totalRow?.cnt ?? 0),
    topCategoryName: topRow?.name ? String(topRow.name) : null,
    topCategoryCents: Number(topRow?.cents ?? 0),
    futureExpenseCents: Number(extraRow?.future_expense_cents ?? 0),
    futureExpenseCount: Number(extraRow?.future_expense_cnt ?? 0),
    incomeCents: Number(extraRow?.income_cents ?? 0),
    incomeCount: Number(extraRow?.income_cnt ?? 0),
    futureIncomeCents: Number(extraRow?.future_income_cents ?? 0),
    futureIncomeCount: Number(extraRow?.future_income_cnt ?? 0),
  }
}

/**
 * Lançamentos de uma categoria no período. Usado na expansão da linha.
 * `categoryId = null` retorna "Sem categoria".
 */
export function getCategoryTransactionsInPeriod(
  db: Database,
  categoryId: string | null,
  periodPattern: string,
  limit = 300,
): CategorySpendTransaction[] {
  const isMonth = /^\d{4}-\d{2}$/.test(periodPattern)
  const periodWhere = isMonth
    ? `(${SQL_EFFECTIVE_SPEND_MONTH}) = ?`
    : `(${SQL_EFFECTIVE_SPEND_MONTH}) LIKE ?`
  const periodParam: SqlValue = isMonth ? periodPattern : `${periodPattern}-%`
  const catWhere = categoryId == null ? 't.category_id IS NULL' : 't.category_id = ?'
  const params: SqlValue[] = [periodParam]
  if (categoryId != null) params.push(categoryId)
  params.push(limit)
  const rows = queryAll(
    db,
    `
    SELECT
      t.id,
      t.occurred_at,
      (${SQL_EFFECTIVE_SPEND_MONTH}) AS ym,
      t.description,
      t.amount_cents,
      a.name AS account_name,
      a.kind AS account_kind,
      t.category_id,
      c.name AS category_name
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE ${periodWhere}
      AND ${catWhere}
      AND t.amount_cents < 0
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
    ORDER BY t.amount_cents ASC, t.occurred_at DESC, t.id DESC
    LIMIT ?
    `,
    params,
  )
  return rows.map((r) => ({
    id: String(r.id),
    occurredAt: String(r.occurred_at),
    ym: String(r.ym ?? ''),
    description: String(r.description ?? ''),
    amountCents: Number(r.amount_cents ?? 0),
    accountName: String(r.account_name ?? ''),
    accountKind: String(r.account_kind ?? ''),
    categoryId: r.category_id ? String(r.category_id) : null,
    categoryName: r.category_name ? String(r.category_name) : null,
  }))
}
