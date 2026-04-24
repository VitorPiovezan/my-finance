import type { SqlValue } from 'sql.js'
import { motion } from 'framer-motion'
import { useMemo, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { colorForCategoryId, type DonutSlice } from '../components/DonutChart'
import { AccountSpendColumn, DistributionDonutCard } from '../components/MonthInsightsPanels'
import { useFinanceDb } from '../context/useFinanceDb'
import { queryAll, run } from '../lib/db/query'
import {
  buildDescriptionIndex,
  suggestCategory,
  type DescriptionIndex,
} from '../lib/learning/descriptionIndex'
import { useMaskedMoney } from '../context/AmountVisibilityContext'
import { formatBRL, parseBRLToCents } from '../lib/money'
import { SQL_EFFECTIVE_SPEND_MONTH } from '../lib/queries/effectiveSpendMonth'
import { listInvestments, type Investment } from '../lib/queries/investments'
import {
  getMonthAccountSpend,
  getMonthCategorySpend,
  getPeriodSummary,
} from '../lib/queries/categorySpend'
import { ymNow } from '../lib/queries/spendSummary'

function monthChoices(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [{ value: '', label: 'Qualquer mês' }]
  const d = new Date()
  for (let i = 0; i < 36; i++) {
    const dt = new Date(d.getFullYear(), d.getMonth() - i, 1)
    const v = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
    const label = dt.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    out.push({ value: v, label: label.charAt(0).toUpperCase() + label.slice(1) })
  }
  return out
}

function billingRefEditOptions(): { value: string; label: string }[] {
  const rest = monthChoices().filter((m) => m.value !== '')
  return [{ value: '', label: 'Pela data' }, ...rest]
}

function sanitizeSearch(s: string): string {
  return s.trim().replace(/[%_\\]/g, ' ')
}

/** Valor absoluto em pt-BR para campo de edição (sem R$). */
function centsToBRLInput(cents: number): string {
  return (Math.abs(cents) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

type GroupMode = 'date' | 'category'

const UNCAT_GROUP_KEY = '__uncat__'

const UNCAT_FILTER_VALUE = '__uncat__'

export function LancamentosPage() {
  const { brl } = useMaskedMoney()
  const { getDb, touch, persistSoon, version } = useFinanceDb()
  /** Vazio = todas as contas. */
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [monthYm, setMonthYm] = useState(ymNow())
  /** Resumo do mês (gráficos): começa recolhido. */
  const [resumoMesOpen, setResumoMesOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [groupMode, setGroupMode] = useState<GroupMode>('category')

  const accounts = useMemo(() => {
    const db = getDb()
    return queryAll(db, `SELECT id, name, kind FROM accounts WHERE deleted_at IS NULL ORDER BY name`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDb, version])

  const categories = useMemo(() => {
    const db = getDb()
    return queryAll(db, `SELECT id, name, kind FROM categories ORDER BY kind, name`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDb, version])

  const investments = useMemo<Investment[]>(() => {
    return listInvestments(getDb(), false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDb, version])

  const { rows, spendCents, incomeCents } = useMemo(() => {
    const db = getDb()
    const params: SqlValue[] = []
    const parts = ['a.deleted_at IS NULL']
    if (selectedAccountIds.length > 0) {
      const ph = selectedAccountIds.map(() => '?').join(', ')
      parts.push(`t.account_id IN (${ph})`)
      params.push(...selectedAccountIds)
    }
    if (monthYm) {
      parts.push(`(${SQL_EFFECTIVE_SPEND_MONTH}) = ?`)
      params.push(monthYm)
    }
    const safeSearch = sanitizeSearch(search)
    if (safeSearch.length > 0) {
      parts.push('t.description LIKE ?')
      params.push(`%${safeSearch}%`)
    }
    if (categoryFilter === UNCAT_FILTER_VALUE) {
      parts.push('t.category_id IS NULL')
    } else if (categoryFilter) {
      parts.push('t.category_id = ?')
      params.push(categoryFilter)
    }
    const where = parts.join(' AND ')
    const sql = `
      SELECT
        t.id,
        t.occurred_at,
        (${SQL_EFFECTIVE_SPEND_MONTH}) AS spend_month,
        t.billing_ref_ym,
        t.description,
        t.amount_cents,
        t.source,
        t.category_id,
        t.investment_id,
        a.name AS account_name,
        a.kind AS account_kind,
        c.name AS category_name,
        c.kind AS category_kind
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE ${where}
      ORDER BY t.occurred_at DESC, t.id DESC
      LIMIT 1000
    `
    const list = queryAll(db, sql, params)
    let spend = 0
    let income = 0
    for (const r of list) {
      const n = Number(r.amount_cents)
      if (n < 0) spend += -n
      else if (n > 0) income += n
    }
    return { rows: list, spendCents: spend, incomeCents: income }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDb, version, selectedAccountIds, monthYm, search, categoryFilter])

  const accountFilterForInsights =
    selectedAccountIds.length > 0 ? selectedAccountIds : undefined

  const monthInsights = useMemo(() => {
    if (!monthYm) return null
    const db = getDb()
    const summary = getPeriodSummary(db, monthYm, accountFilterForInsights)
    const catRows = getMonthCategorySpend(db, monthYm, accountFilterForInsights)
    const accRows = getMonthAccountSpend(db, monthYm, accountFilterForInsights)
    return { summary, catRows, accRows }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDb, version, monthYm, accountFilterForInsights])

  const insightDonutSlices: DonutSlice[] = useMemo(() => {
    if (!monthInsights) return []
    return monthInsights.catRows
      .filter((r) => r.totalCents > 0)
      .slice(0, 12)
      .map((r, i) => ({
        id: r.categoryId ?? `uncat-${i}`,
        label: r.categoryName,
        value: r.totalCents,
        color: colorForCategoryId(r.categoryId),
      }))
  }, [monthInsights])

  const onCategoryChange = (txId: string, value: string) => {
    const db = getDb()
    // Ao mudar pra uma categoria que não é investimento, limpa o vínculo
    // pra não deixar `investment_id` órfão apontando pra categoria atual.
    const chosen = categories.find((c) => String(c.id) === value)
    const chosenKind = chosen ? String(chosen.kind) : ''
    const keepsInvestment =
      chosenKind === 'investment_in' || chosenKind === 'investment_out'
    if (keepsInvestment) {
      run(db, 'UPDATE transactions SET category_id = ? WHERE id = ?', [value || null, txId])
    } else {
      run(db, 'UPDATE transactions SET category_id = ?, investment_id = NULL WHERE id = ?', [
        value || null,
        txId,
      ])
    }
    touch()
    persistSoon()
  }

  const onInvestmentChange = (txId: string, value: string) => {
    const db = getDb()
    run(db, 'UPDATE transactions SET investment_id = ? WHERE id = ?', [value || null, txId])
    touch()
    persistSoon()
  }

  const onBillingRefChange = (txId: string, value: string) => {
    const db = getDb()
    run(db, 'UPDATE transactions SET billing_ref_ym = ? WHERE id = ?', [value || null, txId])
    touch()
    persistSoon()
  }

  const onAmountChange = (txId: string, amountCents: number) => {
    const db = getDb()
    run(db, 'UPDATE transactions SET amount_cents = ? WHERE id = ?', [amountCents, txId])
    touch()
    persistSoon()
  }

  const onDelete = (txId: string, description: string, amountCents: number) => {
    const pretty = `${description.slice(0, 60)}${description.length > 60 ? '…' : ''}`
    const valueLabel = formatBRL(amountCents)
    const ok = window.confirm(
      `Excluir este lançamento?\n\n${pretty}\nValor: ${valueLabel}\n\nEssa ação não pode ser desfeita.`,
    )
    if (!ok) return
    const db = getDb()
    run(db, 'DELETE FROM transactions WHERE id = ?', [txId])
    touch()
    persistSoon()
  }

  const months = useMemo(() => monthChoices(), [])
  const billingOpts = useMemo(() => billingRefEditOptions(), [])

  type Row = (typeof rows)[number]
  type Group = { key: string; name: string; rows: Row[]; totalAbsCents: number }

  const groups = useMemo<Group[]>(() => {
    if (groupMode !== 'category') return []
    const map = new Map<string, Group>()
    for (const r of rows) {
      const isUncat = !r.category_id
      const key = isUncat ? UNCAT_GROUP_KEY : String(r.category_id)
      const name = isUncat ? 'Sem categoria' : String(r.category_name ?? 'Sem categoria')
      let g = map.get(key)
      if (!g) {
        g = { key, name, rows: [], totalAbsCents: 0 }
        map.set(key, g)
      }
      g.rows.push(r)
      g.totalAbsCents += Math.abs(Number(r.amount_cents))
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.key === UNCAT_GROUP_KEY) return -1
      if (b.key === UNCAT_GROUP_KEY) return 1
      return a.name.localeCompare(b.name, 'pt-BR')
    })
  }, [rows, groupMode])

  const uncatCount = useMemo(
    () => rows.reduce((acc, r) => acc + (r.category_id ? 0 : 1), 0),
    [rows],
  )

  const suggestionIndex = useMemo<DescriptionIndex>(
    () => buildDescriptionIndex(getDb()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida leituras após mutações no SQLite
    [getDb, version],
  )

  return (
    <div className="space-y-6">
      <header>
        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-semibold tracking-tight text-white"
        >
          Lançamentos
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          O filtro <strong className="text-zinc-300">Mês</strong> usa o mês que você definiu ao <strong className="text-zinc-300">importar o extrato</strong> (coluna &quot;mês de referência&quot;), e se estiver vazio usa o mês da data do lançamento. Você pode corrigir linha a linha pelo seletor pequeno abaixo da data.
        </p>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass relative z-40 isolate flex flex-wrap items-end gap-4 rounded-2xl p-5"
      >
        <div className="relative z-50 min-w-[200px] flex-1">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Contas</label>
          <details className="group mt-2">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2 marker:hidden [&::-webkit-details-marker]:hidden">
              <span className="truncate">
                {selectedAccountIds.length === 0
                  ? 'Todas'
                  : `${selectedAccountIds.length} selecionada${selectedAccountIds.length === 1 ? '' : 's'}`}
              </span>
              <span className="text-zinc-500">▾</span>
            </summary>
            <div className="absolute left-0 right-0 top-full z-[200] mt-1 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-surface-1 p-2 shadow-xl">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-200 hover:bg-white/5">
                <input
                  type="checkbox"
                  className="rounded border-white/20 bg-surface-0 text-accent focus:ring-accent/40"
                  checked={selectedAccountIds.length === 0}
                  onChange={() => setSelectedAccountIds([])}
                />
                Todas
              </label>
              <div className="my-1 border-t border-white/10" />
              {accounts.map((a) => {
                const id = String(a.id)
                const on = selectedAccountIds.includes(id)
                return (
                  <label
                    key={id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-200 hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      className="rounded border-white/20 bg-surface-0 text-accent focus:ring-accent/40"
                      checked={on}
                      onChange={() => {
                        setSelectedAccountIds((prev) =>
                          on ? prev.filter((x) => x !== id) : [...prev, id],
                        )
                      }}
                    />
                    <span className="min-w-0 truncate" title={String(a.name)}>
                      {String(a.name)}
                    </span>
                    <span className="shrink-0 text-[10px] text-zinc-500">({String(a.kind)})</span>
                  </label>
                )
              })}
            </div>
          </details>
        </div>
        <div className="min-w-[200px]">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Mês (referência ou data)</label>
          <select
            value={monthYm}
            onChange={(e) => setMonthYm(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
          >
            {months.map((m) => (
              <option key={m.value || 'any'} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[200px] flex-[2]">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Buscar na descrição</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Mercado, Uber…"
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
          />
        </div>
        <div className="min-w-[200px] flex-1">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Categoria</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
          >
            <option value="">Todas</option>
            <option value={UNCAT_FILTER_VALUE}>Sem categoria</option>
            {categories.map((c) => (
              <option key={String(c.id)} value={String(c.id)}>
                {String(c.name)} ({String(c.kind)})
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[180px]">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Ordenar por</label>
          <div className="mt-2 inline-flex overflow-hidden rounded-xl border border-white/10 bg-surface-1">
            <button
              type="button"
              onClick={() => setGroupMode('category')}
              className={[
                'px-3 py-2 text-xs font-medium transition',
                groupMode === 'category'
                  ? 'bg-accent/15 text-accent-2'
                  : 'text-zinc-400 hover:text-zinc-200',
              ].join(' ')}
            >
              Categoria
            </button>
            <button
              type="button"
              onClick={() => setGroupMode('date')}
              className={[
                'border-l border-white/10 px-3 py-2 text-xs font-medium transition',
                groupMode === 'date'
                  ? 'bg-accent/15 text-accent-2'
                  : 'text-zinc-400 hover:text-zinc-200',
              ].join(' ')}
            >
              Data
            </button>
          </div>
        </div>
      </motion.div>

      <div className="relative z-0 grid gap-3 sm:grid-cols-3">
        <div className="glass rounded-xl px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Saídas no filtro</p>
          <p className="mt-1 text-xl font-semibold text-rose-200">{brl(spendCents)}</p>
        </div>
        <div className="glass rounded-xl px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Entradas no filtro</p>
          <p className="mt-1 text-xl font-semibold text-emerald-200">{brl(incomeCents)}</p>
        </div>
        <div className="glass rounded-xl px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Sem categoria</p>
          <p
            className={`mt-1 text-xl font-semibold tabular-nums ${
              uncatCount > 0 ? 'text-amber-200' : 'text-zinc-400'
            }`}
          >
            {uncatCount} {uncatCount === 1 ? 'lançamento' : 'lançamentos'}
          </p>
        </div>
      </div>

      {monthYm && monthInsights ? (
        <details
          open={resumoMesOpen}
          onToggle={(e) => setResumoMesOpen(e.currentTarget.open)}
          className="glass relative z-0 overflow-hidden rounded-2xl border border-white/5"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden hover:bg-white/[0.03]">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Resumo do mês (categorias e contas)
            </span>
            <span className="shrink-0 text-[11px] text-zinc-500">
              {resumoMesOpen ? 'recolher' : 'expandir'}
            </span>
          </summary>
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.02 }}
            className="space-y-2 border-t border-white/10 px-4 pb-4 pt-3"
          >
            <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-stretch">
              <AccountSpendColumn
                rows={monthInsights.accRows}
                periodTotalCents={monthInsights.summary.totalCents}
                className="min-w-0 w-full md:flex-1 md:basis-0"
              />
              <DistributionDonutCard
                donutSlices={insightDonutSlices}
                summary={monthInsights.summary}
                className="min-w-0 w-full md:flex-1 md:basis-0"
              />
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-500">
              Mesma base da tela{' '}
              <Link to="/por-categoria" className="text-accent-2 hover:underline">
                Por categoria
              </Link>{' '}
              (<code className="text-zinc-400">v_tx_plus_future</code>, sem transferências entre contas).
              Respeita o filtro de contas acima.
            </p>
          </motion.div>
        </details>
      ) : null}

      <div className="glass overflow-hidden rounded-2xl">
        <div className="max-h-[min(70vh,720px)] overflow-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur">
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-zinc-500">
                <th className="min-w-[140px] px-4 py-3 font-medium">Data</th>
                <th className="min-w-[100px] max-w-[160px] px-4 py-3 font-medium">Conta</th>
                <th className="min-w-[160px] px-4 py-3 font-medium">Descrição</th>
                <th className="w-[100px] whitespace-nowrap px-4 py-3 text-right font-medium">
                  Valor
                </th>
                <th className="min-w-[240px] px-4 py-3 font-medium">Categoria</th>
                <th className="w-[88px] whitespace-nowrap px-2 py-3 text-center font-medium">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-zinc-500">
                    Nenhum lançamento com esses filtros.
                  </td>
                </tr>
              ) : groupMode === 'category' ? (
                groups.flatMap((g) => {
                  const isUncat = g.key === UNCAT_GROUP_KEY
                  const headerTone = isUncat
                    ? 'bg-amber-500/[0.08] text-amber-100'
                    : 'bg-white/[0.05] text-zinc-200'
                  const groupColor = colorForCategoryId(isUncat ? null : g.key)
                  return [
                    <tr
                      key={`hdr-${g.key}`}
                      className={`border-y border-white/10 ${headerTone}`}
                      style={{ boxShadow: `inset 3px 0 0 ${groupColor}` }}
                    >
                      <td colSpan={6} className="px-4 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: groupColor }}
                            />
                            <span className="text-sm font-semibold">{g.name}</span>
                            <span className="text-[11px] text-zinc-400">
                              {g.rows.length} {g.rows.length === 1 ? 'lançamento' : 'lançamentos'}
                              {isUncat ? ' · revise estes primeiro' : ''}
                            </span>
                          </div>
                          <span className="text-xs font-medium tabular-nums text-zinc-300">
                            {brl(g.totalAbsCents)}
                          </span>
                        </div>
                      </td>
                    </tr>,
                    ...g.rows.map((r, i) => (
                      <LancamentoRow
                        key={String(r.id)}
                        row={r}
                        index={i}
                        categories={categories}
                        investments={investments}
                        billingOpts={billingOpts}
                        suggestionIndex={suggestionIndex}
                        onCategoryChange={onCategoryChange}
                        onBillingRefChange={onBillingRefChange}
                        onInvestmentChange={onInvestmentChange}
                        onAmountChange={onAmountChange}
                        onDelete={onDelete}
                      />
                    )),
                  ]
                })
              ) : (
                rows.map((r, i) => (
                  <LancamentoRow
                    key={String(r.id)}
                    row={r}
                    index={i}
                    categories={categories}
                    investments={investments}
                    billingOpts={billingOpts}
                    suggestionIndex={suggestionIndex}
                    onCategoryChange={onCategoryChange}
                    onBillingRefChange={onBillingRefChange}
                    onInvestmentChange={onInvestmentChange}
                    onAmountChange={onAmountChange}
                    onDelete={onDelete}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-white/10 px-4 py-2 text-xs text-zinc-500">
          Mostrando até 1000 linhas. Ajuste conta / mês / busca para refinar.
        </p>
      </div>
    </div>
  )
}

type LancamentoRowProps = {
  row: Record<string, SqlValue>
  index: number
  categories: Record<string, SqlValue>[]
  investments: Investment[]
  billingOpts: { value: string; label: string }[]
  suggestionIndex: DescriptionIndex
  onCategoryChange: (txId: string, value: string) => void
  onBillingRefChange: (txId: string, value: string) => void
  onInvestmentChange: (txId: string, value: string) => void
  onAmountChange: (txId: string, amountCents: number) => void
  onDelete: (txId: string, description: string, amountCents: number) => void
}

function LancamentoRow({
  row: r,
  index: i,
  categories,
  investments,
  billingOpts,
  suggestionIndex,
  onCategoryChange,
  onBillingRefChange,
  onInvestmentChange,
  onAmountChange,
  onDelete,
}: LancamentoRowProps) {
  const { brl } = useMaskedMoney()
  const amt = Number(r.amount_cents)
  const neg = amt < 0
  const [editingAmount, setEditingAmount] = useState(false)
  const [draftAmount, setDraftAmount] = useState('')

  const startEditAmount = () => {
    setDraftAmount(`${neg ? '-' : ''}${centsToBRLInput(amt)}`)
    setEditingAmount(true)
  }

  const commitAmount = () => {
    const parsed = parseBRLToCents(draftAmount)
    if (parsed === null) {
      setEditingAmount(false)
      return
    }
    if (parsed !== amt) {
      onAmountChange(String(r.id), parsed)
    }
    setEditingAmount(false)
  }

  const onAmountKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitAmount()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setEditingAmount(false)
    }
  }
  const rowColor = colorForCategoryId(r.category_id ? String(r.category_id) : null)
  const isUncat = !r.category_id
  const categoryKind = r.category_kind ? String(r.category_kind) : ''
  const isInvestment =
    categoryKind === 'investment_in' || categoryKind === 'investment_out'
  const suggestion = isUncat
    ? suggestCategory(suggestionIndex, String(r.description ?? ''))
    : null
  const suggestionColor = suggestion
    ? colorForCategoryId(suggestion.suggestion.categoryId)
    : null
  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: Math.min(i * 0.01, 0.25) }}
      className="border-b border-white/5 hover:bg-white/[0.03]"
      style={{ boxShadow: `inset 3px 0 0 ${rowColor}` }}
    >
      <td className="whitespace-nowrap px-4 py-2">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs text-zinc-300">
            {String(r.occurred_at).slice(0, 10)}
          </span>
          <select
            value={r.billing_ref_ym ? String(r.billing_ref_ym) : ''}
            onChange={(e) => onBillingRefChange(String(r.id), e.target.value)}
            title="Mês de referência do extrato (Mês ref.)"
            className="w-fit max-w-[140px] rounded-md border border-white/5 bg-transparent px-1.5 py-0.5 text-[10px] text-zinc-400 outline-none ring-accent/20 hover:border-white/20 hover:text-zinc-200 focus:ring-1"
          >
            {billingOpts.map((o) => (
              <option key={o.value || 'auto'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </td>
      <td
        className="max-w-[140px] truncate px-4 py-2.5 text-zinc-300"
        title={String(r.account_name)}
      >
        {String(r.account_name)}
      </td>
      <td className="px-4 py-2.5 text-zinc-200">
        <span className="break-words">{String(r.description)}</span>
        <span
          className="ml-1 align-middle text-[10px] uppercase tracking-wide text-zinc-600"
          title={`Origem: ${String(r.source)}`}
        >
          · {String(r.source)}
        </span>
      </td>
      <td
        className={`px-4 py-2 text-right font-medium tabular-nums ${
          neg ? 'text-rose-200' : 'text-emerald-200'
        }`}
      >
        {editingAmount ? (
          <input
            value={draftAmount}
            onChange={(e) => setDraftAmount(e.target.value)}
            onBlur={(e) => {
              const next = e.relatedTarget as HTMLElement | null
              if (next?.closest?.('[data-lancamento-actions]')) return
              commitAmount()
            }}
            onKeyDown={onAmountKeyDown}
            autoFocus
            inputMode="decimal"
            title="Valor em reais (use − para despesa, se quiser trocar o sinal)"
            className="w-full min-w-[7rem] rounded-lg border border-white/15 bg-surface-1 px-2 py-1.5 text-right text-sm text-white outline-none ring-accent/30 focus:ring-1"
          />
        ) : (
          <span className="inline-block whitespace-nowrap py-0.5">{brl(amt)}</span>
        )}
      </td>
      <td className="min-w-0 px-4 py-2 align-top">
        <div className="flex flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${isUncat ? 'opacity-40' : ''}`}
              style={{ backgroundColor: rowColor }}
            />
            <select
              value={r.category_id ? String(r.category_id) : ''}
              onChange={(e) => onCategoryChange(String(r.id), e.target.value)}
              className="min-w-0 max-w-full rounded-lg border border-white/10 bg-surface-1 px-2 py-1.5 text-xs text-white outline-none ring-accent/20 focus:ring-1"
            >
              <option value="">Sem categoria</option>
              {categories.map((c) => (
                <option key={String(c.id)} value={String(c.id)}>
                  {String(c.name)} ({String(c.kind)})
                </option>
              ))}
            </select>
          </div>
          {suggestion && suggestionColor ? (
            <button
              type="button"
              onClick={() =>
                onCategoryChange(String(r.id), suggestion.suggestion.categoryId)
              }
              title={`Já usado ${suggestion.suggestion.supportCount}x com essa descrição (${Math.round(suggestion.suggestion.confidence * 100)}% das vezes).`}
              className="inline-flex w-fit items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: suggestionColor }}
              />
              <span>
                Aplicar{' '}
                <strong className="font-medium text-zinc-100">
                  {suggestion.suggestion.categoryName}
                </strong>
                {suggestion.strength === 'strong' ? (
                  <span className="ml-1 text-zinc-500">
                    ({suggestion.suggestion.supportCount}×)
                  </span>
                ) : (
                  <span className="ml-1 text-zinc-500">(visto antes)</span>
                )}
              </span>
            </button>
          ) : null}
          {isInvestment ? (
            <select
              value={r.investment_id ? String(r.investment_id) : ''}
              onChange={(e) => onInvestmentChange(String(r.id), e.target.value)}
              title={
                categoryKind === 'investment_in'
                  ? 'Vincular aporte a um investimento (opcional).'
                  : 'Vincular retirada a um investimento (opcional).'
              }
              className="max-w-full rounded-md border border-emerald-500/20 bg-emerald-400/5 px-2 py-1 text-[11px] text-emerald-100 outline-none ring-emerald-400/30 focus:ring-1"
            >
              <option value="">
                {categoryKind === 'investment_in'
                  ? 'Sem vínculo — aporte geral'
                  : 'Sem vínculo — retirada geral'}
              </option>
              {investments.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </td>
      <td className="w-[88px] px-1 py-2 text-center align-top">
        <div
          className="flex items-center justify-center gap-0.5"
          data-lancamento-actions
        >
          <button
            type="button"
            onClick={() => (editingAmount ? commitAmount() : startEditAmount())}
            aria-label={editingAmount ? 'Salvar valor' : 'Editar valor'}
            title={editingAmount ? 'Salvar valor (Enter ou clique)' : 'Editar valor'}
            className={[
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-transparent transition',
              editingAmount
                ? 'border-accent/40 text-accent-2 hover:bg-accent/10'
                : 'border-white/5 text-zinc-500 hover:border-white/20 hover:bg-white/[0.06] hover:text-zinc-200',
            ].join(' ')}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() =>
              onDelete(
                String(r.id),
                String(r.description ?? ''),
                Number(r.amount_cents),
              )
            }
            aria-label="Excluir lançamento"
            title="Excluir lançamento"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-transparent text-zinc-500 transition hover:border-rose-400/30 hover:bg-rose-500/10 hover:text-rose-200"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </td>
    </motion.tr>
  )
}
