import { motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFinanceDb } from '../context/useFinanceDb'
import { formatBRL } from '../lib/money'
import {
  createInvestment,
  deleteInvestment,
  getInvestmentMovements,
  getInvestmentSummaries,
  getInvestmentTotals,
  updateInvestment,
  type InvestmentMovement,
  type InvestmentSummary,
} from '../lib/queries/investments'
import { ymNow } from '../lib/queries/spendSummary'

function parseBrlToCents(raw: string): number {
  const cleaned = raw.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const num = Number(cleaned)
  if (!isFinite(num)) return 0
  return Math.round(num * 100)
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

function todayIso(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function formatBrDate(iso: string): string {
  const [date] = iso.split('T')
  const parts = date.split('-')
  if (parts.length !== 3) return iso
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

type FormState = {
  id: string | null
  name: string
  institution: string
  initialBalance: string
  initialDate: string
  notes: string
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  institution: '',
  initialBalance: '0,00',
  initialDate: todayIso(),
  notes: '',
}

export function InvestmentsPage() {
  const { getDb, touch, persistSoon, version } = useFinanceDb()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formOpen, setFormOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const { summaries, totals, movementsByInvestment } = useMemo(() => {
    const db = getDb()
    const sums = getInvestmentSummaries(db)
    const tots = getInvestmentTotals(db, ymNow())
    const map = new Map<string, InvestmentMovement[]>()
    if (expanded) {
      map.set(expanded, getInvestmentMovements(db, expanded))
    }
    return { summaries: sums, totals: tots, movementsByInvestment: map }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida após mutações no SQLite
  }, [getDb, version, expanded])

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }

  const openEdit = (inv: InvestmentSummary) => {
    setForm({
      id: inv.id,
      name: inv.name,
      institution: inv.institution ?? '',
      initialBalance: centsToInput(inv.initialBalanceCents),
      initialDate: inv.initialDate.slice(0, 10),
      notes: inv.notes ?? '',
    })
    setFormOpen(true)
  }

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = form.name.trim()
    if (!trimmed) return
    const db = getDb()
    const initialBalanceCents = parseBrlToCents(form.initialBalance)
    if (form.id) {
      updateInvestment(db, form.id, {
        name: trimmed,
        institution: form.institution,
        initialBalanceCents,
        initialDate: form.initialDate,
        notes: form.notes,
      })
    } else {
      createInvestment(db, {
        name: trimmed,
        institution: form.institution || null,
        initialBalanceCents,
        initialDate: form.initialDate,
        notes: form.notes || null,
      })
    }
    touch()
    persistSoon()
    setForm(EMPTY_FORM)
    setFormOpen(false)
  }

  const onDelete = (inv: InvestmentSummary) => {
    const movementsNote =
      inv.contributionsCount + inv.withdrawalsCount > 0
        ? ` Os ${inv.contributionsCount + inv.withdrawalsCount} movimentos vinculados perdem o vínculo, mas as transações em si continuam no banco.`
        : ''
    const ok = window.confirm(
      `Apagar o investimento "${inv.name}"?${movementsNote}\n\nNão dá pra desfazer.`,
    )
    if (!ok) return
    deleteInvestment(getDb(), inv.id)
    touch()
    persistSoon()
    if (expanded === inv.id) setExpanded(null)
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl font-semibold tracking-tight text-white"
          >
            Investimentos
          </motion.h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Saldo nominal guardado (sem rendimento). Cadastre cada investimento com o valor
            que já tinha antes e marque aportes e retiradas através da categoria nos lançamentos
            — assim eles aparecem aqui e saem dos totais de gasto/receita.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-xl bg-accent/20 px-4 py-2 text-sm font-medium text-accent-2 ring-1 ring-accent/30 hover:bg-accent/25"
        >
          + Novo investimento
        </button>
      </header>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass rounded-2xl p-5"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Saldo total (nominal)
            </p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-emerald-100 tabular-nums">
              {formatBRL(totals.balanceCents)}
            </p>
            {totals.initialBalanceCents > 0 ? (
              <p className="mt-1 text-[11px] text-zinc-500">
                Inclui {formatBRL(totals.initialBalanceCents)} de saldo inicial.
              </p>
            ) : null}
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Aportes no mês
            </p>
            <p className="mt-1 text-xl font-semibold text-emerald-200 tabular-nums">
              {formatBRL(totals.contributionsCents)}
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">
              {totals.contributionsCount}{' '}
              {totals.contributionsCount === 1 ? 'movimento' : 'movimentos'}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Retiradas no mês
            </p>
            <p className="mt-1 text-xl font-semibold text-amber-200 tabular-nums">
              {formatBRL(totals.withdrawalsCents)}
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">
              {totals.withdrawalsCount}{' '}
              {totals.withdrawalsCount === 1 ? 'resgate' : 'resgates'}
            </p>
          </div>
        </div>
      </motion.section>

      {formOpen ? (
        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={submitForm}
          className="glass space-y-4 rounded-2xl p-5"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-100">
              {form.id ? 'Editar investimento' : 'Novo investimento'}
            </h2>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="text-[11px] text-zinc-500 hover:text-zinc-300"
            >
              Cancelar
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Nome
              </span>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                placeholder="Ex.: CDB Inter, Tesouro Selic…"
                className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Instituição <span className="text-zinc-600">(opcional)</span>
              </span>
              <input
                value={form.institution}
                onChange={(e) =>
                  setForm((s) => ({ ...s, institution: e.target.value }))
                }
                placeholder="Ex.: Inter, Nubank, XP…"
                className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Saldo inicial (R$)
              </span>
              <input
                inputMode="decimal"
                value={form.initialBalance}
                onChange={(e) =>
                  setForm((s) => ({ ...s, initialBalance: e.target.value }))
                }
                placeholder="0,00"
                className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 font-mono text-sm text-white outline-none ring-accent/30 focus:ring-2"
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                O quanto já estava guardado antes de começar a usar o app.
              </p>
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Data do saldo inicial
              </span>
              <input
                type="date"
                value={form.initialDate}
                onChange={(e) =>
                  setForm((s) => ({ ...s, initialDate: e.target.value }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
              />
            </label>
            <label className="sm:col-span-2 block">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Notas <span className="text-zinc-600">(opcional)</span>
              </span>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
                rows={2}
                placeholder="Taxa, prazo, observações…"
                className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded-xl bg-accent/20 px-4 py-2 text-sm font-medium text-accent-2 ring-1 ring-accent/30 hover:bg-accent/25"
            >
              {form.id ? 'Salvar alterações' : 'Criar investimento'}
            </button>
          </div>
        </motion.form>
      ) : null}

      {summaries.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-6 text-sm text-zinc-400"
        >
          Nenhum investimento cadastrado ainda. Clique em <strong>Novo investimento</strong> e
          registre o que já tinha guardado — depois marque aportes/retiradas nos lançamentos
          usando as categorias <strong>Aporte (investimento)</strong> e{' '}
          <strong>Retirada de investimento</strong>.
        </motion.div>
      ) : (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          {summaries.map((inv) => {
            const isOpen = expanded === inv.id
            const movements = movementsByInvestment.get(inv.id) ?? []
            return (
              <div
                key={inv.id}
                className="glass overflow-hidden rounded-2xl transition hover:border-white/20"
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : inv.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 p-5 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-white">{inv.name}</h3>
                      {inv.closedAt ? (
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                          encerrado
                        </span>
                      ) : null}
                    </div>
                    {inv.institution ? (
                      <p className="mt-0.5 text-[11px] text-zinc-500">{inv.institution}</p>
                    ) : null}
                    <p className="mt-2 text-xl font-semibold text-emerald-100 tabular-nums">
                      {formatBRL(inv.balanceCents)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      Inicial {formatBRL(inv.initialBalanceCents)} +{' '}
                      <span className="text-emerald-200">
                        {formatBRL(inv.contributionsCents)}
                      </span>{' '}
                      −{' '}
                      <span className="text-amber-200">{formatBRL(inv.withdrawalsCents)}</span>
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-zinc-500">
                    {isOpen ? 'Fechar' : 'Ver extrato'}
                  </span>
                </button>

                {isOpen ? (
                  <div className="border-t border-white/10 p-5">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(inv)}
                        className="rounded-xl border border-white/10 bg-surface-2 px-3 py-1.5 text-xs text-zinc-200 hover:bg-surface-3"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(inv)}
                        className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs text-rose-200 hover:bg-danger/20"
                      >
                        Excluir
                      </button>
                    </div>

                    {inv.notes ? (
                      <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-zinc-400">
                        {inv.notes}
                      </p>
                    ) : null}

                    <div className="mt-4">
                      <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                        Movimentos vinculados
                      </h4>
                      {movements.length === 0 ? (
                        <p className="mt-2 text-[11px] text-zinc-500">
                          Sem movimentos por aqui ainda. Em <Link to="/lancamentos" className="text-accent-2 hover:underline">Lançamentos</Link> vincule uma transação a este investimento ao escolher a categoria de aporte/retirada.
                        </p>
                      ) : (
                        <ul className="mt-2 divide-y divide-white/5 rounded-xl border border-white/10 bg-white/[0.02]">
                          {movements.map((m) => (
                            <li
                              key={m.id}
                              className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-zinc-100">
                                  {m.description}
                                  {m.scheduled ? (
                                    <span className="ml-2 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
                                      agendado
                                    </span>
                                  ) : null}
                                </p>
                                <p className="mt-0.5 text-[11px] text-zinc-500">
                                  {formatBrDate(m.occurredAt)}
                                  {m.accountName ? ` · ${m.accountName}` : ''}
                                  {m.categoryName ? ` · ${m.categoryName}` : ''}
                                </p>
                              </div>
                              <p
                                className={`shrink-0 text-sm font-semibold tabular-nums ${
                                  m.direction === 'in' ? 'text-emerald-200' : 'text-amber-200'
                                }`}
                              >
                                {m.direction === 'in' ? '+' : '−'}
                                {formatBRL(Math.abs(m.amountCents))}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </motion.section>
      )}
    </div>
  )
}
