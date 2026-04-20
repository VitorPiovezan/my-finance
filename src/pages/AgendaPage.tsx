import { AnimatePresence, motion } from 'framer-motion'
import { type FormEvent, useMemo, useState } from 'react'
import { useFinanceDb } from '../context/useFinanceDb'
import { queryAll, run } from '../lib/db/query'
import { newId } from '../lib/id'
import { useMaskedMoney } from '../context/AmountVisibilityContext'
import { parseBRLToCents } from '../lib/money'

const KINDS = [
  { value: 'boleto', label: 'Boleto' },
  { value: 'pix', label: 'Pix agendado' },
  { value: 'invoice', label: 'Fatura' },
  { value: 'card', label: 'Cartão' },
  { value: 'other', label: 'Outro' },
] as const

type PresetKind = (typeof KINDS)[number]['value']

/**
 * Atalho editável persistido em DB (`quick_presets`). Cada atalho vira um chip
 * clicável que cria um `scheduled_payment` com vencimento no fim do mês atual.
 * Usar DB (e não constantes no código / localStorage) evita vazar nomes e
 * valores pessoais quando o repositório for público.
 */
type QuickPreset = {
  id: string
  title: string
  amountCents: number
  kind: PresetKind
  accountId: string
  categoryId: string
}

function endOfCurrentMonthIso(): string {
  const now = new Date()
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const y = last.getFullYear()
  const m = String(last.getMonth() + 1).padStart(2, '0')
  const d = String(last.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function centsToBRLInput(cents: number): string {
  return (Math.abs(cents) / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function AgendaPage() {
  const { brl } = useMaskedMoney()
  const { getDb, touch, persistSoon, version } = useFinanceDb()
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [due, setDue] = useState('')
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('boleto')
  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')

  const accounts = useMemo(() => {
    const db = getDb()
    return queryAll(db, `SELECT id, name FROM accounts WHERE deleted_at IS NULL ORDER BY name`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDb, version])

  const categories = useMemo(() => {
    const db = getDb()
    return queryAll(db, `SELECT id, name, kind FROM categories ORDER BY kind, name`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDb, version])

  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
  /**
   * Se a seção de atalhos está recolhida. Preferência de UI, não é sensível —
   * persiste em localStorage pra não "reabrir" toda vez que a página carrega.
   */
  const [presetsCollapsed, setPresetsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('agenda-presets-collapsed') === '1'
    } catch {
      return false
    }
  })
  const togglePresetsCollapsed = () => {
    setPresetsCollapsed((cur) => {
      const next = !cur
      try {
        localStorage.setItem('agenda-presets-collapsed', next ? '1' : '0')
      } catch {
        // ignora
      }
      if (next) {
        // Ao recolher, fecha qualquer edição aberta pra não deixar estado solto.
        setEditingPresetId(null)
        setPresetDraft(null)
      }
      return next
    })
  }
  /**
   * Rascunho temporário dos campos do atalho em edição. Separar do estado
   * persistido no DB permite editar sem escrever a cada tecla; só bate no DB
   * quando clica "Salvar".
   */
  const [presetDraft, setPresetDraft] = useState<{
    title: string
    amount: string
    kind: PresetKind
    accountId: string
    categoryId: string
  } | null>(null)

  const presets = useMemo<QuickPreset[]>(() => {
    const db = getDb()
    const rows = queryAll(
      db,
      `SELECT id, title, amount_cents, kind, category_id, account_id
       FROM quick_presets
       ORDER BY created_at ASC, title ASC`,
    )
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title ?? ''),
      amountCents: Number(r.amount_cents ?? 0),
      kind: String(r.kind ?? 'boleto') as PresetKind,
      accountId: r.account_id ? String(r.account_id) : '',
      categoryId: r.category_id ? String(r.category_id) : '',
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida após mutações
  }, [getDb, version])

  /** Chave de dedupe pra achar um preset equivalente a um agendado qualquer. */
  const presetKey = (p: {
    title: string
    amountCents: number
    kind: string
    accountId: string | null
    categoryId: string | null
  }): string =>
    [
      p.title.trim().toLowerCase(),
      p.amountCents,
      p.kind,
      p.accountId ?? '',
      p.categoryId ?? '',
    ].join('|')

  const presetKeySet = useMemo(
    () => new Set(presets.map((p) => presetKey(p))),
    [presets],
  )

  const runPreset = (p: QuickPreset) => {
    if (!p.title.trim() || p.amountCents <= 0) return
    insertScheduled({
      title: p.title,
      amountCents: p.amountCents,
      due: endOfCurrentMonthIso(),
      kind: p.kind,
      accountId: p.accountId || null,
      categoryId: p.categoryId || null,
    })
  }

  const addPreset = () => {
    const id = newId()
    const db = getDb()
    run(
      db,
      `INSERT INTO quick_presets (id, title, amount_cents, kind, category_id, account_id, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [id, 'Novo atalho', 0, 'boleto', null, null, new Date().toISOString()],
    )
    touch()
    persistSoon()
    setEditingPresetId(id)
    setPresetDraft({
      title: 'Novo atalho',
      amount: '0,00',
      kind: 'boleto',
      accountId: '',
      categoryId: '',
    })
  }

  const addPresetFromScheduled = (s: Record<string, unknown>) => {
    const id = newId()
    const db = getDb()
    run(
      db,
      `INSERT INTO quick_presets (id, title, amount_cents, kind, category_id, account_id, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [
        id,
        String(s.title ?? '').trim() || 'Atalho',
        Math.abs(Number(s.amount_cents ?? 0)),
        String(s.kind ?? 'boleto'),
        s.category_id ? String(s.category_id) : null,
        s.account_id ? String(s.account_id) : null,
        new Date().toISOString(),
      ],
    )
    touch()
    persistSoon()
  }

  const removePreset = (id: string) => {
    const db = getDb()
    run(db, 'DELETE FROM quick_presets WHERE id = ?', [id])
    touch()
    persistSoon()
    if (editingPresetId === id) {
      setEditingPresetId(null)
      setPresetDraft(null)
    }
  }

  const startEditPreset = (p: QuickPreset) => {
    setEditingPresetId(p.id)
    setPresetDraft({
      title: p.title,
      amount: centsToBRLInput(p.amountCents),
      kind: p.kind,
      accountId: p.accountId,
      categoryId: p.categoryId,
    })
  }

  const cancelEditPreset = () => {
    setEditingPresetId(null)
    setPresetDraft(null)
  }

  const saveEditPreset = (id: string) => {
    if (!presetDraft) return
    const cents = parseBRLToCents(presetDraft.amount)
    if (!presetDraft.title.trim() || cents === null || cents < 0) return
    const db = getDb()
    run(
      db,
      `UPDATE quick_presets
       SET title = ?, amount_cents = ?, kind = ?, category_id = ?, account_id = ?
       WHERE id = ?`,
      [
        presetDraft.title.trim(),
        cents,
        presetDraft.kind,
        presetDraft.categoryId || null,
        presetDraft.accountId || null,
        id,
      ],
    )
    touch()
    persistSoon()
    cancelEditPreset()
  }

  const upcoming = useMemo(() => {
    const db = getDb()
    return queryAll(
      db,
      `SELECT s.id, s.title, s.amount_cents, s.due_date, s.kind, s.paid_at,
              s.account_id, s.category_id,
              c.name AS cat_name, c.kind AS cat_kind, a.name AS acc_name
       FROM scheduled_payments s
       LEFT JOIN categories c ON c.id = s.category_id
       LEFT JOIN accounts a ON a.id = s.account_id
       ORDER BY s.due_date ASC`,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDb, version])

  const insertScheduled = (p: {
    title: string
    amountCents: number
    due: string
    kind: PresetKind
    accountId: string | null
    categoryId: string | null
  }) => {
    const db = getDb()
    run(
      db,
      `INSERT INTO scheduled_payments (id, title, amount_cents, due_date, category_id, account_id, kind, notes, paid_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        newId(),
        p.title.trim(),
        p.amountCents,
        p.due,
        p.categoryId,
        p.accountId,
        p.kind,
        null,
        null,
        new Date().toISOString(),
      ],
    )
    touch()
    persistSoon()
  }

  const onAdd = (e: FormEvent) => {
    e.preventDefault()
    const cents = parseBRLToCents(amount)
    if (!title.trim() || cents === null || !due) return
    insertScheduled({
      title,
      amountCents: cents,
      due,
      kind,
      accountId: accountId || null,
      categoryId: categoryId || null,
    })
    setTitle('')
    setAmount('')
    setDue('')
  }

  const markPaid = (id: string) => {
    const db = getDb()
    run(db, 'UPDATE scheduled_payments SET paid_at = ? WHERE id = ?', [new Date().toISOString(), id])
    touch()
    persistSoon()
  }

  const remove = (id: string) => {
    const db = getDb()
    run(db, 'DELETE FROM scheduled_payments WHERE id = ?', [id])
    touch()
    persistSoon()
  }

  const removeAll = () => {
    const total = upcoming.length
    if (total === 0) return
    const ok = window.confirm(
      `Apagar TODOS os ${total} lançamento${total === 1 ? '' : 's'} futuro${
        total === 1 ? '' : 's'
      }?\n\nIsso não pode ser desfeito. Os atalhos rápidos continuam salvos.`,
    )
    if (!ok) return
    const db = getDb()
    run(db, 'DELETE FROM scheduled_payments')
    touch()
    persistSoon()
    cancelEditScheduled()
  }

  type ScheduledEditDraft = {
    title: string
    amount: string
    due: string
    kind: PresetKind
    accountId: string
    categoryId: string
  }
  const [editingScheduledId, setEditingScheduledId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<ScheduledEditDraft | null>(null)

  const startEditScheduled = (s: Record<string, unknown>) => {
    const raw = Number(s.amount_cents ?? 0)
    const abs = Math.abs(raw)
    const amountBRL = (abs / 100).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    setEditingScheduledId(String(s.id))
    setEditDraft({
      title: String(s.title ?? ''),
      amount: amountBRL,
      due: String(s.due_date ?? ''),
      kind: String(s.kind ?? 'boleto') as PresetKind,
      accountId: s.account_id ? String(s.account_id) : '',
      categoryId: s.category_id ? String(s.category_id) : '',
    })
  }

  const cancelEditScheduled = () => {
    setEditingScheduledId(null)
    setEditDraft(null)
  }

  const saveScheduled = (id: string) => {
    if (!editDraft) return
    const cents = parseBRLToCents(editDraft.amount)
    if (!editDraft.title.trim() || cents === null || !editDraft.due) return
    const db = getDb()
    run(
      db,
      `UPDATE scheduled_payments
       SET title = ?, amount_cents = ?, due_date = ?, kind = ?, account_id = ?, category_id = ?
       WHERE id = ?`,
      [
        editDraft.title.trim(),
        cents,
        editDraft.due,
        editDraft.kind,
        editDraft.accountId || null,
        editDraft.categoryId || null,
        id,
      ],
    )
    touch()
    persistSoon()
    cancelEditScheduled()
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Boletos e futuros</h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-400">
          Centralize compromissos futuros (despesas ou receitas). Informe valor positivo — a
          direção vem da categoria: <strong>income</strong> é receita, o resto é despesa.
          Escolhendo uma conta, o futuro já aparece em Visão geral, Análise e Por categoria
          como se estivesse pago. Apague daqui quando o lançamento real entrar pelo extrato.
        </p>
      </header>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={togglePresetsCollapsed}
            aria-expanded={!presetsCollapsed}
            className="flex min-w-0 items-center gap-2 text-left transition hover:opacity-80"
          >
            <span
              aria-hidden="true"
              className={[
                'inline-block text-xs text-zinc-500 transition-transform',
                presetsCollapsed ? '-rotate-90' : '',
              ].join(' ')}
            >
              ▾
            </span>
            <span>
              <span className="block text-sm font-medium text-zinc-300">
                Atalhos rápidos
                <span className="ml-2 text-[11px] font-normal text-zinc-500">
                  ({presets.length})
                </span>
              </span>
              <span className="mt-0.5 block text-[11px] text-zinc-500">
                {presetsCollapsed
                  ? 'Recolhido — clique pra expandir.'
                  : (
                    <>
                      Clique no atalho pra cadastrar com vencimento no fim do mês atual
                      <span className="mx-1">·</span>
                      <strong className="text-zinc-300">{endOfCurrentMonthIso()}</strong>
                    </>
                  )}
              </span>
            </span>
          </button>
          {!presetsCollapsed ? (
            <button
              type="button"
              onClick={addPreset}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/5"
            >
              + novo atalho
            </button>
          ) : null}
        </div>
        <AnimatePresence initial={false}>
          {presetsCollapsed ? null : (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              {presets.length === 0 ? (
                <p className="text-xs text-zinc-500">Sem atalhos ainda.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {presets.map((p) => {
              const cat = categories.find((c) => String(c.id) === p.categoryId)
              const acc = accounts.find((a) => String(a.id) === p.accountId)
              const editing = editingPresetId === p.id
              const canRun = p.title.trim().length > 0 && p.amountCents > 0
              return (
                <li
                  key={p.id}
                  className="glass overflow-hidden rounded-xl border border-white/5"
                >
                  <div className="flex items-stretch">
                    <button
                      type="button"
                      onClick={() => runPreset(p)}
                      disabled={!canRun}
                      title={canRun ? 'Criar agora com vencimento no fim do mês' : 'Preencha título e valor antes'}
                      className="group flex min-w-0 flex-1 flex-col justify-between px-3 py-2.5 text-left transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-medium text-white">
                          {p.title || 'Sem título'}
                        </p>
                        <p className="shrink-0 text-sm font-semibold tabular-nums text-zinc-100">
                          {brl(p.amountCents)}
                        </p>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                        {p.kind}
                        {acc ? ` · ${String(acc.name)}` : ''}
                        {cat ? ` · ${String(cat.name)}` : ' · sem categoria'}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => (editing ? cancelEditPreset() : startEditPreset(p))}
                      aria-expanded={editing}
                      className={[
                        'shrink-0 border-l border-white/5 px-3 text-[11px] transition',
                        editing
                          ? 'bg-white/10 text-white'
                          : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100',
                      ].join(' ')}
                    >
                      {editing ? 'fechar' : 'editar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Excluir o atalho "${p.title || 'sem título'}"?`)) {
                          removePreset(p.id)
                        }
                      }}
                      title="Excluir este atalho"
                      aria-label={`Excluir atalho ${p.title || 'sem título'}`}
                      className="shrink-0 border-l border-white/5 px-3 text-[13px] text-zinc-500 transition hover:bg-danger/10 hover:text-danger"
                    >
                      ×
                    </button>
                  </div>
                  <AnimatePresence initial={false}>
                    {editing && presetDraft ? (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden border-t border-white/5 bg-white/[0.02]"
                      >
                        <div className="grid gap-2 p-3 sm:grid-cols-2">
                          <div className="sm:col-span-2">
                            <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                              Título
                            </label>
                            <input
                              value={presetDraft.title}
                              onChange={(e) =>
                                setPresetDraft({ ...presetDraft, title: e.target.value })
                              }
                              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-1 px-3 py-1.5 text-xs text-white outline-none ring-accent/30 focus:ring-2"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                              Valor (R$)
                            </label>
                            <input
                              value={presetDraft.amount}
                              onChange={(e) =>
                                setPresetDraft({ ...presetDraft, amount: e.target.value })
                              }
                              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-1 px-3 py-1.5 text-xs text-white outline-none ring-accent/30 focus:ring-2"
                              placeholder="249,90"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                              Tipo
                            </label>
                            <select
                              value={presetDraft.kind}
                              onChange={(e) =>
                                setPresetDraft({
                                  ...presetDraft,
                                  kind: e.target.value as PresetKind,
                                })
                              }
                              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-1 px-3 py-1.5 text-xs text-white outline-none ring-accent/30 focus:ring-2"
                            >
                              {KINDS.map((k) => (
                                <option key={k.value} value={k.value}>
                                  {k.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                              Conta
                            </label>
                            <select
                              value={presetDraft.accountId}
                              onChange={(e) =>
                                setPresetDraft({ ...presetDraft, accountId: e.target.value })
                              }
                              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-1 px-3 py-1.5 text-xs text-white outline-none ring-accent/30 focus:ring-2"
                            >
                              <option value="">—</option>
                              {accounts.map((a) => (
                                <option key={String(a.id)} value={String(a.id)}>
                                  {String(a.name)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                              Categoria
                            </label>
                            <select
                              value={presetDraft.categoryId}
                              onChange={(e) =>
                                setPresetDraft({ ...presetDraft, categoryId: e.target.value })
                              }
                              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-1 px-3 py-1.5 text-xs text-white outline-none ring-accent/30 focus:ring-2"
                            >
                              <option value="">—</option>
                              {categories.map((c) => (
                                <option key={String(c.id)} value={String(c.id)}>
                                  {String(c.name)} ({String(c.kind)})
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-center justify-between gap-2 sm:col-span-2">
                            <button
                              type="button"
                              onClick={() => removePreset(p.id)}
                              className="text-[11px] text-zinc-500 hover:text-danger"
                            >
                              remover atalho
                            </button>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={cancelEditPreset}
                                className="rounded-lg border border-white/10 px-3 py-1 text-[11px] text-zinc-200 hover:bg-white/5"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => saveEditPreset(p.id)}
                                className="rounded-lg bg-accent px-3 py-1 text-[11px] font-semibold text-white shadow-lg shadow-accent/20 hover:brightness-110"
                              >
                                Salvar
                              </button>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </li>
              )
            })}
                </ul>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <motion.form
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={onAdd}
        className="glass grid gap-4 rounded-2xl p-6 md:grid-cols-2"
      >
        <div className="md:col-span-2">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Título</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
            placeholder="Conta de luz"
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Valor (R$)</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
            placeholder="249,90"
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Vencimento</label>
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Tipo</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as (typeof KINDS)[number]['value'])}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Conta (opcional)</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
          >
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={String(a.id)} value={String(a.id)}>
                {String(a.name)}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[10px] text-zinc-500">
            Escolha uma conta pra o futuro já contar na Visão geral/Análise.
          </p>
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Categoria (opcional)</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
          >
            <option value="">—</option>
            {categories.map((c) => (
              <option key={String(c.id)} value={String(c.id)}>
                {String(c.name)} ({String(c.kind)})
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[10px] text-zinc-500">
            Categorias <strong>income</strong> contam como entrada; o resto conta como despesa.
          </p>
        </div>
        <div className="md:col-span-2">
          <button
            type="submit"
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/20 hover:brightness-110"
          >
            Registrar
          </button>
        </div>
      </motion.form>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-zinc-300">
            Linha do tempo
            {upcoming.length > 0 ? (
              <span className="ml-2 text-[11px] font-normal text-zinc-500">
                ({upcoming.length} {upcoming.length === 1 ? 'item' : 'itens'})
              </span>
            ) : null}
          </h2>
          {upcoming.length > 0 ? (
            <button
              type="button"
              onClick={removeAll}
              title="Apaga todos os lançamentos futuros. Os atalhos rápidos ficam."
              className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs text-rose-200 transition hover:bg-danger/20"
            >
              Apagar todos
            </button>
          ) : null}
        </div>
        <div className="space-y-2">
          {upcoming.length === 0 ? (
            <p className="text-sm text-zinc-500">Nada cadastrado.</p>
          ) : (
            upcoming.map((s, i) => {
              const id = String(s.id)
              const editing = editingScheduledId === id
              const sAmount = Math.abs(Number(s.amount_cents ?? 0))
              const key = presetKey({
                title: String(s.title ?? ''),
                amountCents: sAmount,
                kind: String(s.kind ?? 'boleto'),
                accountId: s.account_id ? String(s.account_id) : '',
                categoryId: s.category_id ? String(s.category_id) : '',
              })
              const hasPreset = presetKeySet.has(key)
              return (
                <motion.div
                  key={id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="glass overflow-hidden rounded-xl"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-white">{String(s.title)}</p>
                        {s.account_id ? (
                          <span
                            className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-200"
                            title="Este futuro já aparece em Visão geral, Análise e Por categoria."
                          >
                            contando em análise
                          </span>
                        ) : (
                          <span
                            className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-200"
                            title="Sem conta vinculada, só aparece aqui na tela de Futuros."
                          >
                            não entra em análise
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {String(s.due_date)} · {String(s.kind)}
                        {s.acc_name ? ` · ${String(s.acc_name)}` : ''}
                        {s.cat_name ? ` · ${String(s.cat_name)}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {s.cat_kind === 'income' ? (
                        <span
                          className="text-sm font-semibold text-emerald-200"
                          title="Categoria income — conta como entrada na Visão geral."
                        >
                          + {brl(Number(s.amount_cents))}
                        </span>
                      ) : (
                        <span
                          className="text-sm font-semibold text-white"
                          title="Conta como despesa na Visão geral."
                        >
                          {brl(Number(s.amount_cents))}
                        </span>
                      )}
                      {s.paid_at ? (
                        <span className="text-xs text-success">Pago</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => markPaid(id)}
                          className="rounded-lg border border-white/10 px-3 py-1 text-xs text-zinc-200 hover:bg-white/5"
                        >
                          Marcar pago
                        </button>
                      )}
                      {hasPreset ? null : (
                        <button
                          type="button"
                          onClick={() => addPresetFromScheduled(s)}
                          title="Criar um atalho rápido idêntico a este futuro."
                          className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-1 text-xs text-accent hover:bg-accent/20"
                        >
                          + atalho rápido
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          editing ? cancelEditScheduled() : startEditScheduled(s)
                        }
                        aria-expanded={editing}
                        className={[
                          'rounded-lg border px-3 py-1 text-xs transition',
                          editing
                            ? 'border-white/20 bg-white/10 text-white'
                            : 'border-white/10 text-zinc-200 hover:bg-white/5',
                        ].join(' ')}
                      >
                        {editing ? 'Fechar' : 'Editar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(id)}
                        className="rounded-lg px-2 text-xs text-zinc-500 hover:text-danger"
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                  <AnimatePresence initial={false}>
                    {editing && editDraft ? (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden border-t border-white/5 bg-white/[0.02]"
                      >
                        <div className="grid gap-3 p-4 sm:grid-cols-2">
                          <div className="sm:col-span-2">
                            <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                              Título
                            </label>
                            <input
                              value={editDraft.title}
                              onChange={(e) =>
                                setEditDraft({ ...editDraft, title: e.target.value })
                              }
                              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-1 px-3 py-1.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                              Valor (R$)
                            </label>
                            <input
                              value={editDraft.amount}
                              onChange={(e) =>
                                setEditDraft({ ...editDraft, amount: e.target.value })
                              }
                              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-1 px-3 py-1.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
                              placeholder="249,90"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                              Vencimento
                            </label>
                            <input
                              type="date"
                              value={editDraft.due}
                              onChange={(e) =>
                                setEditDraft({ ...editDraft, due: e.target.value })
                              }
                              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-1 px-3 py-1.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                              Tipo
                            </label>
                            <select
                              value={editDraft.kind}
                              onChange={(e) =>
                                setEditDraft({
                                  ...editDraft,
                                  kind: e.target.value as PresetKind,
                                })
                              }
                              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-1 px-3 py-1.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
                            >
                              {KINDS.map((k) => (
                                <option key={k.value} value={k.value}>
                                  {k.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                              Conta
                            </label>
                            <select
                              value={editDraft.accountId}
                              onChange={(e) =>
                                setEditDraft({ ...editDraft, accountId: e.target.value })
                              }
                              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-1 px-3 py-1.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
                            >
                              <option value="">—</option>
                              {accounts.map((a) => (
                                <option key={String(a.id)} value={String(a.id)}>
                                  {String(a.name)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="sm:col-span-2">
                            <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                              Categoria
                            </label>
                            <select
                              value={editDraft.categoryId}
                              onChange={(e) =>
                                setEditDraft({ ...editDraft, categoryId: e.target.value })
                              }
                              className="mt-1 w-full rounded-lg border border-white/10 bg-surface-1 px-3 py-1.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
                            >
                              <option value="">—</option>
                              {categories.map((c) => (
                                <option key={String(c.id)} value={String(c.id)}>
                                  {String(c.name)} ({String(c.kind)})
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-center justify-end gap-2 sm:col-span-2">
                            <button
                              type="button"
                              onClick={cancelEditScheduled}
                              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/5"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={() => saveScheduled(id)}
                              className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-accent/20 hover:brightness-110"
                            >
                              Salvar
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </motion.div>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}
