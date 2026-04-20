import type { Database, SqlValue } from 'sql.js'
import { queryAll, queryOne } from '../db/query'
import { SQL_EFFECTIVE_SPEND_MONTH } from './effectiveSpendMonth'
import { SQL_IS_TRANSFER, SQL_NOT_TRANSFER_JOIN, SQL_NOT_TRANSFER_WHERE } from './transferFilter'

export type AnalysisScope = 'contas' | 'cartao'

/**
 * Filtro flexível de análise: pode limitar por escopo (todas as contas
 * não-cartão vs. todos os cartões) ou por uma conta específica. Quando
 * `accountId` está presente ele tem prioridade e o `scope` é ignorado.
 * Sem nenhum dos dois, não limita por conta (tudo entra).
 */
export type AnalysisFilter = {
  scope?: AnalysisScope
  accountId?: string
}

export type CategoryBreakdown = {
  categoryId: string | null
  categoryName: string
  categoryKind: 'expense' | 'income' | 'transfer' | 'uncategorized'
  cents: number
  count: number
}

export type TopTransaction = {
  id: string
  occurredAt: string
  description: string
  amountCents: number
  accountName: string
  accountKind: string
  categoryName: string | null
}

export type AnalysisSummary = {
  inflowCents: number
  outflowCents: number
  netCents: number
  transactionCount: number
  /** Quantidade de transferências (kind='transfer') ignoradas no escopo/mês. */
  transferCount: number
  /** Total em módulo movimentado em transferências — só para referência. */
  transferVolumeCents: number
}

/** Converte um `AnalysisFilter` em um fragmento SQL + params pro `WHERE`. */
export function analysisFilterWhere(
  filter: AnalysisFilter,
): { sql: string; params: SqlValue[] } {
  if (filter.accountId) {
    return { sql: 't.account_id = ?', params: [filter.accountId] }
  }
  if (filter.scope === 'cartao') return { sql: "a.kind = 'credit'", params: [] }
  if (filter.scope === 'contas') return { sql: "a.kind != 'credit'", params: [] }
  return { sql: '1=1', params: [] }
}

export function getAnalysisSummary(
  db: Database,
  ym: string,
  filter: AnalysisFilter,
): AnalysisSummary {
  const w = analysisFilterWhere(filter)
  const row = queryOne(
    db,
    `
    SELECT
      COALESCE(SUM(CASE WHEN t.amount_cents > 0 AND ${SQL_NOT_TRANSFER_WHERE} THEN t.amount_cents ELSE 0 END), 0) AS inflow,
      COALESCE(SUM(CASE WHEN t.amount_cents < 0 AND ${SQL_NOT_TRANSFER_WHERE} THEN -t.amount_cents ELSE 0 END), 0) AS outflow,
      COALESCE(SUM(CASE WHEN ${SQL_NOT_TRANSFER_WHERE} THEN t.amount_cents ELSE 0 END), 0) AS net,
      COALESCE(SUM(CASE WHEN ${SQL_NOT_TRANSFER_WHERE} THEN 1 ELSE 0 END), 0) AS cnt,
      COALESCE(SUM(CASE WHEN ${SQL_IS_TRANSFER} THEN 1 ELSE 0 END), 0) AS transfer_count,
      COALESCE(SUM(CASE WHEN ${SQL_IS_TRANSFER} THEN ABS(t.amount_cents) ELSE 0 END), 0) AS transfer_volume
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    ${SQL_NOT_TRANSFER_JOIN}
    WHERE ${w.sql} AND (${SQL_EFFECTIVE_SPEND_MONTH}) = ?
    `,
    [...w.params, ym],
  )
  return {
    inflowCents: Number(row?.inflow ?? 0),
    outflowCents: Number(row?.outflow ?? 0),
    netCents: Number(row?.net ?? 0),
    transactionCount: Number(row?.cnt ?? 0),
    transferCount: Number(row?.transfer_count ?? 0),
    transferVolumeCents: Number(row?.transfer_volume ?? 0),
  }
}

export function getOutflowByCategory(
  db: Database,
  ym: string,
  filter: AnalysisFilter,
): CategoryBreakdown[] {
  const w = analysisFilterWhere(filter)
  const rows = queryAll(
    db,
    `
    SELECT
      t.category_id AS category_id,
      COALESCE(c.name, 'Sem categoria') AS category_name,
      COALESCE(c.kind, 'uncategorized') AS category_kind,
      SUM(-t.amount_cents) AS cents,
      COUNT(*) AS cnt
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE ${w.sql}
      AND (${SQL_EFFECTIVE_SPEND_MONTH}) = ?
      AND t.amount_cents < 0
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
    GROUP BY t.category_id
    ORDER BY cents DESC
    `,
    [...w.params, ym],
  )
  return rows.map((r) => ({
    categoryId: r.category_id ? String(r.category_id) : null,
    categoryName: String(r.category_name),
    categoryKind: String(r.category_kind) as CategoryBreakdown['categoryKind'],
    cents: Number(r.cents ?? 0),
    count: Number(r.cnt ?? 0),
  }))
}

export function getInflowByCategory(
  db: Database,
  ym: string,
  filter: AnalysisFilter,
): CategoryBreakdown[] {
  const w = analysisFilterWhere(filter)
  const rows = queryAll(
    db,
    `
    SELECT
      t.category_id AS category_id,
      COALESCE(c.name, 'Sem categoria') AS category_name,
      COALESCE(c.kind, 'uncategorized') AS category_kind,
      SUM(t.amount_cents) AS cents,
      COUNT(*) AS cnt
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE ${w.sql}
      AND (${SQL_EFFECTIVE_SPEND_MONTH}) = ?
      AND t.amount_cents > 0
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
    GROUP BY t.category_id
    ORDER BY cents DESC
    `,
    [...w.params, ym],
  )
  return rows.map((r) => ({
    categoryId: r.category_id ? String(r.category_id) : null,
    categoryName: String(r.category_name),
    categoryKind: String(r.category_kind) as CategoryBreakdown['categoryKind'],
    cents: Number(r.cents ?? 0),
    count: Number(r.count ?? 0),
  }))
}

export function getTransactionsByCategory(
  db: Database,
  ym: string,
  filter: AnalysisFilter,
  categoryId: string | null,
  direction: 'out' | 'in' | 'all' = 'out',
  limit = 200,
): TopTransaction[] {
  const w = analysisFilterWhere(filter)
  const dirCond =
    direction === 'out'
      ? 'AND t.amount_cents < 0'
      : direction === 'in'
        ? 'AND t.amount_cents > 0'
        : ''
  const catCond = categoryId == null ? 't.category_id IS NULL' : 't.category_id = ?'
  const order = direction === 'in' ? 't.amount_cents DESC' : 't.amount_cents ASC'
  const params: SqlValue[] = [...w.params, ym]
  if (categoryId != null) params.push(categoryId)
  params.push(limit)
  const rows = queryAll(
    db,
    `
    SELECT
      t.id,
      t.occurred_at,
      t.description,
      t.amount_cents,
      a.name AS account_name,
      a.kind AS account_kind,
      c.name AS category_name
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE ${w.sql}
      AND (${SQL_EFFECTIVE_SPEND_MONTH}) = ?
      AND ${catCond}
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
      ${dirCond}
    ORDER BY ${order}, t.id DESC
    LIMIT ?
    `,
    params,
  )
  return rows.map((r) => ({
    id: String(r.id),
    occurredAt: String(r.occurred_at),
    description: String(r.description),
    amountCents: Number(r.amount_cents),
    accountName: String(r.account_name),
    accountKind: String(r.account_kind),
    categoryName: r.category_name ? String(r.category_name) : null,
  }))
}

export function getTopTransactions(
  db: Database,
  ym: string,
  filter: AnalysisFilter,
  direction: 'out' | 'in',
  limit = 10,
): TopTransaction[] {
  const w = analysisFilterWhere(filter)
  const dirCond = direction === 'out' ? 't.amount_cents < 0' : 't.amount_cents > 0'
  const order = direction === 'out' ? 't.amount_cents ASC' : 't.amount_cents DESC'
  const rows = queryAll(
    db,
    `
    SELECT
      t.id,
      t.occurred_at,
      t.description,
      t.amount_cents,
      a.name AS account_name,
      a.kind AS account_kind,
      c.name AS category_name
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE ${w.sql}
      AND (${SQL_EFFECTIVE_SPEND_MONTH}) = ?
      AND ${dirCond}
      AND (c.kind IS NULL OR c.kind NOT IN ('transfer','investment_in','investment_out'))
    ORDER BY ${order}, t.id DESC
    LIMIT ?
    `,
    [...w.params, ym, limit],
  )
  return rows.map((r) => ({
    id: String(r.id),
    occurredAt: String(r.occurred_at),
    description: String(r.description),
    amountCents: Number(r.amount_cents),
    accountName: String(r.account_name),
    accountKind: String(r.account_kind),
    categoryName: r.category_name ? String(r.category_name) : null,
  }))
}
