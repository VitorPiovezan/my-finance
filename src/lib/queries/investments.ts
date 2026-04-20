import type { Database, SqlValue } from 'sql.js'
import { queryAll, queryOne, run } from '../db/query'

export type Investment = {
  id: string
  name: string
  institution: string | null
  color: string | null
  initialBalanceCents: number
  initialDate: string
  notes: string | null
  createdAt: string
  closedAt: string | null
}

export type InvestmentSummary = Investment & {
  /** Total de aportes (não inclui saldo inicial). */
  contributionsCents: number
  /** Total de retiradas/resgates. */
  withdrawalsCents: number
  /** Saldo nominal = initial + contributions − withdrawals. */
  balanceCents: number
  contributionsCount: number
  withdrawalsCount: number
}

export type InvestmentTotals = {
  /** Saldo nominal somado de todos os investimentos abertos. */
  balanceCents: number
  /** Soma de saldos iniciais (apenas referência). */
  initialBalanceCents: number
  /** Aportes do mês filtrado (sem sinal). */
  contributionsCents: number
  /** Retiradas do mês filtrado (sem sinal). */
  withdrawalsCents: number
  contributionsCount: number
  withdrawalsCount: number
}

export type InvestmentMovement = {
  id: string
  occurredAt: string
  description: string
  amountCents: number
  direction: 'in' | 'out'
  categoryName: string | null
  accountName: string | null
  scheduled: boolean
}

function rowToInvestment(r: Record<string, SqlValue>): Investment {
  return {
    id: String(r.id),
    name: String(r.name),
    institution: r.institution ? String(r.institution) : null,
    color: r.color ? String(r.color) : null,
    initialBalanceCents: Number(r.initial_balance_cents ?? 0),
    initialDate: String(r.initial_date),
    notes: r.notes ? String(r.notes) : null,
    createdAt: String(r.created_at),
    closedAt: r.closed_at ? String(r.closed_at) : null,
  }
}

export function listInvestments(db: Database, includeClosed = false): Investment[] {
  const sql = includeClosed
    ? `SELECT * FROM investments ORDER BY closed_at IS NULL DESC, name`
    : `SELECT * FROM investments WHERE closed_at IS NULL ORDER BY name`
  return queryAll(db, sql).map(rowToInvestment)
}

export function getInvestment(db: Database, id: string): Investment | null {
  const row = queryOne(db, `SELECT * FROM investments WHERE id = ?`, [id])
  return row ? rowToInvestment(row) : null
}

export type CreateInvestmentInput = {
  id?: string
  name: string
  institution?: string | null
  color?: string | null
  initialBalanceCents: number
  initialDate: string
  notes?: string | null
}

export function createInvestment(db: Database, input: CreateInvestmentInput): string {
  const id = input.id ?? cryptoRandomId()
  const now = new Date().toISOString()
  run(
    db,
    `INSERT INTO investments (id, name, institution, color, initial_balance_cents, initial_date, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name.trim(),
      input.institution?.trim() || null,
      input.color?.trim() || null,
      Math.max(0, Math.round(input.initialBalanceCents)),
      input.initialDate,
      input.notes?.trim() || null,
      now,
    ],
  )
  return id
}

export type UpdateInvestmentInput = Partial<Omit<CreateInvestmentInput, 'id'>> & {
  closedAt?: string | null
}

export function updateInvestment(db: Database, id: string, input: UpdateInvestmentInput): void {
  const fields: string[] = []
  const params: SqlValue[] = []
  if (input.name !== undefined) {
    fields.push('name = ?')
    params.push(input.name.trim())
  }
  if (input.institution !== undefined) {
    fields.push('institution = ?')
    params.push(input.institution?.trim() || null)
  }
  if (input.color !== undefined) {
    fields.push('color = ?')
    params.push(input.color?.trim() || null)
  }
  if (input.initialBalanceCents !== undefined) {
    fields.push('initial_balance_cents = ?')
    params.push(Math.max(0, Math.round(input.initialBalanceCents)))
  }
  if (input.initialDate !== undefined) {
    fields.push('initial_date = ?')
    params.push(input.initialDate)
  }
  if (input.notes !== undefined) {
    fields.push('notes = ?')
    params.push(input.notes?.trim() || null)
  }
  if (input.closedAt !== undefined) {
    fields.push('closed_at = ?')
    params.push(input.closedAt)
  }
  if (fields.length === 0) return
  params.push(id)
  run(db, `UPDATE investments SET ${fields.join(', ')} WHERE id = ?`, params)
}

export function deleteInvestment(db: Database, id: string): void {
  // Solta os vínculos nas transações antes (não apagamos as tx do usuário).
  run(db, `UPDATE transactions SET investment_id = NULL WHERE investment_id = ?`, [id])
  run(db, `UPDATE scheduled_payments SET investment_id = NULL WHERE investment_id = ?`, [id])
  run(db, `DELETE FROM investments WHERE id = ?`, [id])
}

/**
 * Agregado por investimento: aportes, retiradas e saldo nominal. Considera
 * apenas movimentos vinculados (`investment_id IS ?`). Aportes/retiradas sem
 * vínculo entram no total geral (ver `getInvestmentTotals`) mas não aqui.
 */
export function getInvestmentSummaries(db: Database): InvestmentSummary[] {
  const invs = listInvestments(db, true)
  if (invs.length === 0) return []
  const rows = queryAll(
    db,
    `
    SELECT
      i.id,
      COALESCE(SUM(CASE WHEN c.kind = 'investment_in' THEN ABS(t.amount_cents) ELSE 0 END), 0) AS contributions,
      COALESCE(SUM(CASE WHEN c.kind = 'investment_out' THEN ABS(t.amount_cents) ELSE 0 END), 0) AS withdrawals,
      COALESCE(SUM(CASE WHEN c.kind = 'investment_in' THEN 1 ELSE 0 END), 0) AS contributions_cnt,
      COALESCE(SUM(CASE WHEN c.kind = 'investment_out' THEN 1 ELSE 0 END), 0) AS withdrawals_cnt
    FROM investments i
    LEFT JOIN transactions t ON t.investment_id = i.id
    LEFT JOIN categories c ON c.id = t.category_id
    GROUP BY i.id
    `,
  )
  const byId = new Map(rows.map((r) => [String(r.id), r]))
  return invs.map((inv) => {
    const r = byId.get(inv.id)
    const contributions = Number(r?.contributions ?? 0)
    const withdrawals = Number(r?.withdrawals ?? 0)
    return {
      ...inv,
      contributionsCents: contributions,
      withdrawalsCents: withdrawals,
      contributionsCount: Number(r?.contributions_cnt ?? 0),
      withdrawalsCount: Number(r?.withdrawals_cnt ?? 0),
      balanceCents: inv.initialBalanceCents + contributions - withdrawals,
    }
  })
}

/**
 * Totais gerais de investimentos (sem depender de vínculo). Bom pro card do
 * dashboard e resumos globais.
 */
export function getInvestmentTotals(db: Database, ym: string | null): InvestmentTotals {
  const initialRow = queryOne(
    db,
    `SELECT COALESCE(SUM(initial_balance_cents), 0) AS total
     FROM investments WHERE closed_at IS NULL`,
  )
  const initialBalance = Number(initialRow?.total ?? 0)

  // Totais globais (todos os meses) — usado pra saldo nominal total.
  const globalRow = queryOne(
    db,
    `
    SELECT
      COALESCE(SUM(CASE WHEN c.kind = 'investment_in' THEN ABS(t.amount_cents) ELSE 0 END), 0) AS contributions,
      COALESCE(SUM(CASE WHEN c.kind = 'investment_out' THEN ABS(t.amount_cents) ELSE 0 END), 0) AS withdrawals
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE c.kind IN ('investment_in','investment_out')
    `,
  )
  const globalContributions = Number(globalRow?.contributions ?? 0)
  const globalWithdrawals = Number(globalRow?.withdrawals ?? 0)

  // Totais do mês (incluindo futuros agendados quando `ym` for informado).
  let monthContributions = 0
  let monthWithdrawals = 0
  let monthContribCount = 0
  let monthWithdrawCount = 0
  if (ym) {
    const monthRow = queryOne(
      db,
      `
      SELECT
        COALESCE(SUM(CASE WHEN c.kind = 'investment_in' THEN ABS(t.amount_cents) ELSE 0 END), 0) AS contributions,
        COALESCE(SUM(CASE WHEN c.kind = 'investment_out' THEN ABS(t.amount_cents) ELSE 0 END), 0) AS withdrawals,
        COALESCE(SUM(CASE WHEN c.kind = 'investment_in' THEN 1 ELSE 0 END), 0) AS contributions_cnt,
        COALESCE(SUM(CASE WHEN c.kind = 'investment_out' THEN 1 ELSE 0 END), 0) AS withdrawals_cnt
      FROM v_tx_plus_future t
      JOIN categories c ON c.id = t.category_id
      WHERE substr(t.occurred_at, 1, 7) = ?
        AND c.kind IN ('investment_in','investment_out')
      `,
      [ym],
    )
    monthContributions = Number(monthRow?.contributions ?? 0)
    monthWithdrawals = Number(monthRow?.withdrawals ?? 0)
    monthContribCount = Number(monthRow?.contributions_cnt ?? 0)
    monthWithdrawCount = Number(monthRow?.withdrawals_cnt ?? 0)
  }

  return {
    balanceCents: initialBalance + globalContributions - globalWithdrawals,
    initialBalanceCents: initialBalance,
    contributionsCents: monthContributions,
    withdrawalsCents: monthWithdrawals,
    contributionsCount: monthContribCount,
    withdrawalsCount: monthWithdrawCount,
  }
}

/**
 * Extrato de movimentos vinculados a um investimento específico. Ordenado
 * cronologicamente descendente. Retorna transações e futuros agendados.
 */
export function getInvestmentMovements(
  db: Database,
  investmentId: string,
): InvestmentMovement[] {
  const rows = queryAll(
    db,
    `
    SELECT
      t.id,
      t.occurred_at,
      t.description,
      t.amount_cents,
      t.source,
      c.kind AS category_kind,
      c.name AS category_name,
      a.name AS account_name
    FROM v_tx_plus_future t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE t.investment_id = ?
      AND c.kind IN ('investment_in','investment_out')
    ORDER BY t.occurred_at DESC, t.id DESC
    `,
    [investmentId],
  )
  return rows.map((r) => ({
    id: String(r.id),
    occurredAt: String(r.occurred_at),
    description: String(r.description),
    amountCents: Number(r.amount_cents ?? 0),
    direction: String(r.category_kind) === 'investment_in' ? 'in' : 'out',
    categoryName: r.category_name ? String(r.category_name) : null,
    accountName: r.account_name ? String(r.account_name) : null,
    scheduled: String(r.source) === 'scheduled',
  }))
}

/** Resumo mensal (últimos N meses) de aportes e retiradas — pra sparklines. */
export function getInvestmentsMonthlySeries(
  db: Database,
  monthsBack = 12,
): { ym: string; contributionsCents: number; withdrawalsCents: number }[] {
  const rows = queryAll(
    db,
    `
    SELECT
      substr(t.occurred_at, 1, 7) AS ym,
      SUM(CASE WHEN c.kind = 'investment_in' THEN ABS(t.amount_cents) ELSE 0 END) AS contributions,
      SUM(CASE WHEN c.kind = 'investment_out' THEN ABS(t.amount_cents) ELSE 0 END) AS withdrawals
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE c.kind IN ('investment_in','investment_out')
    GROUP BY ym
    ORDER BY ym DESC
    LIMIT ?
    `,
    [monthsBack],
  )
  return rows
    .map((r) => ({
      ym: String(r.ym),
      contributionsCents: Number(r.contributions ?? 0),
      withdrawalsCents: Number(r.withdrawals ?? 0),
    }))
    .reverse()
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `inv_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}
