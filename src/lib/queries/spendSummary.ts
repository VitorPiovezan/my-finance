import type { Database } from 'sql.js'
import { queryAll, queryOne } from '../db/query'
import { SQL_EFFECTIVE_SPEND_MONTH } from './effectiveSpendMonth'
import { SQL_IS_TRANSFER, SQL_NOT_TRANSFER_JOIN, SQL_NOT_TRANSFER_WHERE } from './transferFilter'

export type SpendSplit = {
  creditSpendCents: number
  /** Soma de lançamentos positivos (não-cartão) no mês — sem transferências. */
  accountInflowCents: number
  /** Total de saídas em valor absoluto (não-cartão) — sem transferências. */
  accountOutflowCents: number
  /** Fluxo líquido (entradas − saídas) — sem transferências. */
  accountNetCents: number
  /** Quantidade de transferências (conta + cartão) ocultadas no mês. */
  transferCount: number
  /** Volume total movido em transferências (soma de |amount|). */
  transferVolumeCents: number
}

export function spendByMonth(db: Database, ym: string): SpendSplit {
  const row = queryOne(
    db,
    `
    SELECT
      COALESCE(SUM(CASE WHEN a.kind = 'credit' AND t.amount_cents < 0 AND ${SQL_NOT_TRANSFER_WHERE} THEN -t.amount_cents ELSE 0 END), 0) AS credit_spend,
      COALESCE(SUM(CASE WHEN a.kind != 'credit' AND t.amount_cents > 0 AND ${SQL_NOT_TRANSFER_WHERE} THEN t.amount_cents ELSE 0 END), 0) AS account_inflow,
      COALESCE(SUM(CASE WHEN a.kind != 'credit' AND t.amount_cents < 0 AND ${SQL_NOT_TRANSFER_WHERE} THEN -t.amount_cents ELSE 0 END), 0) AS account_outflow,
      COALESCE(SUM(CASE WHEN a.kind != 'credit' AND ${SQL_NOT_TRANSFER_WHERE} THEN t.amount_cents ELSE 0 END), 0) AS account_net,
      COALESCE(SUM(CASE WHEN ${SQL_IS_TRANSFER} THEN 1 ELSE 0 END), 0) AS transfer_count,
      COALESCE(SUM(CASE WHEN ${SQL_IS_TRANSFER} THEN ABS(t.amount_cents) ELSE 0 END), 0) AS transfer_volume
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    ${SQL_NOT_TRANSFER_JOIN}
    WHERE (${SQL_EFFECTIVE_SPEND_MONTH}) = ?
    `,
    [ym],
  )
  return {
    creditSpendCents: Number(row?.credit_spend ?? 0),
    accountInflowCents: Number(row?.account_inflow ?? 0),
    accountOutflowCents: Number(row?.account_outflow ?? 0),
    accountNetCents: Number(row?.account_net ?? 0),
    transferCount: Number(row?.transfer_count ?? 0),
    transferVolumeCents: Number(row?.transfer_volume ?? 0),
  }
}

export function ymNow(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function ymPrevious(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const dt = new Date(y, m - 2, 1)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  return `${yy}-${mm}`
}

/**
 * Lista, em ordem decrescente, todos os meses (`YYYY-MM`) que têm pelo menos uma transação
 * segundo o mesmo critério de mês usado no dashboard (mês de referência do extrato, ou
 * mês civil da data quando o primeiro estiver vazio).
 */
export function listMonthsWithRecords(db: Database): string[] {
  const rows = queryAll(
    db,
    `
    SELECT DISTINCT (${SQL_EFFECTIVE_SPEND_MONTH}) AS ym
    FROM v_tx_plus_future t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    WHERE (${SQL_EFFECTIVE_SPEND_MONTH}) IS NOT NULL
    ORDER BY ym DESC
    `,
  )
  return rows
    .map((r) => String(r.ym ?? ''))
    .filter((v) => /^\d{4}-\d{2}$/.test(v))
}
