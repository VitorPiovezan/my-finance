import { motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFinanceDb } from '../context/useFinanceDb'
import { formatBRL, formatMoneyInputFromCents, parseBRLToCents } from '../lib/money'
import {
  getPjSimContaCents,
  getPjSimFaturamentoCents,
  getPjSimImpostoPct,
  getPjSimProlaboreCents,
  getPjSimValorMantidoContaCents,
  setPjSimContaCents,
  setPjSimFaturamentoCents,
  setPjSimImpostoPct,
  setPjSimProlaboreCents,
  setPjSimValorMantidoContaCents,
} from '../lib/pjSimulator/settings'

export function SimuladorPjPage() {
  const { getDb, touch, persistSoon, version, dbEpoch } = useFinanceDb()
  void version

  const loadFromDb = useCallback(() => {
    const db = getDb()
    const fc = getPjSimFaturamentoCents(db)
    const cc = getPjSimContaCents(db)
    const pc = getPjSimImpostoPct(db)
    const pr = getPjSimProlaboreCents(db)
    const mc = getPjSimValorMantidoContaCents(db)
    return {
      fatDraft: formatMoneyInputFromCents(fc),
      contaDraft: formatMoneyInputFromCents(cc),
      mantidoDraft: formatMoneyInputFromCents(mc),
      impostoPctStr: pc > 0 ? String(pc).replace('.', ',') : '',
      proDraft: formatMoneyInputFromCents(pr),
      fatCents: fc,
      contaCents: cc,
      mantidoCents: mc,
      pct: pc,
      proCents: pr,
    }
  }, [getDb])

  const [fatDraft, setFatDraft] = useState(() =>
    formatMoneyInputFromCents(getPjSimFaturamentoCents(getDb())),
  )
  const [contaDraft, setContaDraft] = useState(() =>
    formatMoneyInputFromCents(getPjSimContaCents(getDb())),
  )
  const [mantidoDraft, setMantidoDraft] = useState(() =>
    formatMoneyInputFromCents(getPjSimValorMantidoContaCents(getDb())),
  )
  const [impostoPctStr, setImpostoPctStr] = useState(() => {
    const p = getPjSimImpostoPct(getDb())
    return p > 0 ? String(p).replace('.', ',') : ''
  })
  const [proDraft, setProDraft] = useState(() =>
    formatMoneyInputFromCents(getPjSimProlaboreCents(getDb())),
  )

  const [fatCents, setFatCents] = useState(() => getPjSimFaturamentoCents(getDb()))
  const [contaCents, setContaCents] = useState(() => getPjSimContaCents(getDb()))
  const [mantidoCents, setMantidoCents] = useState(() => getPjSimValorMantidoContaCents(getDb()))
  const [pctCommitted, setPctCommitted] = useState(() => getPjSimImpostoPct(getDb()))
  const [proCents, setProCents] = useState(() => getPjSimProlaboreCents(getDb()))

  useEffect(() => {
    const s = loadFromDb()
    setFatDraft(s.fatDraft)
    setContaDraft(s.contaDraft)
    setMantidoDraft(s.mantidoDraft)
    setImpostoPctStr(s.impostoPctStr)
    setProDraft(s.proDraft)
    setFatCents(s.fatCents)
    setContaCents(s.contaCents)
    setMantidoCents(s.mantidoCents)
    setPctCommitted(s.pct)
    setProCents(s.proCents)
  }, [dbEpoch, loadFromDb])

  const fatLive = parseBRLToCents(fatDraft.trim())
  const contaLive = parseBRLToCents(contaDraft.trim())
  const mantidoLive = parseBRLToCents(mantidoDraft.trim())
  const proLive = parseBRLToCents(proDraft.trim())

  const faturamentoCents = fatLive !== null ? fatLive : fatCents
  const contaEffCents = contaLive !== null ? contaLive : contaCents
  const mantidoEffCents = mantidoLive !== null ? mantidoLive : mantidoCents
  const prolaboreCents = proLive !== null ? proLive : proCents

  const recebidoContaPfCents = contaEffCents - mantidoEffCents

  const pctLive = useMemo(() => {
    const t = impostoPctStr.trim().replace(',', '.')
    if (!t) return null
    const n = Number.parseFloat(t)
    return Number.isFinite(n) && n >= 0 ? n : null
  }, [impostoPctStr])

  const pctEff = pctLive !== null ? pctLive : pctCommitted

  const inssCents = Math.round((prolaboreCents * 11) / 100)
  /** pct sobre valor em reais: (centavos/100)×(pct/100)×100 = centavos×pct/100 */
  const impostoFaturamentoCents = Math.round((faturamentoCents * pctEff) / 100)
  const lucroSimplesCents = contaEffCents - prolaboreCents - impostoFaturamentoCents
  const lucroAposInssCents = lucroSimplesCents - inssCents

  const prolaboreLiquidoCents = prolaboreCents - inssCents

  const persistFat = () => {
    const db = getDb()
    const p = parseBRLToCents(fatDraft.trim())
    const c = p ?? 0
    setFatCents(c)
    setPjSimFaturamentoCents(db, c)
    touch()
    persistSoon()
  }

  const persistConta = () => {
    const db = getDb()
    const p = parseBRLToCents(contaDraft.trim())
    const c = p ?? 0
    setContaCents(c)
    setPjSimContaCents(db, c)
    touch()
    persistSoon()
  }

  const persistMantido = () => {
    const db = getDb()
    const p = parseBRLToCents(mantidoDraft.trim())
    const c = p ?? 0
    setMantidoCents(c)
    setPjSimValorMantidoContaCents(db, c)
    touch()
    persistSoon()
  }

  const persistPct = () => {
    const db = getDb()
    const t = impostoPctStr.trim().replace(',', '.')
    const n = Number.parseFloat(t)
    const v = Number.isFinite(n) && n >= 0 ? n : 0
    setPctCommitted(v)
    setPjSimImpostoPct(db, v)
    touch()
    persistSoon()
  }

  const persistPro = () => {
    const db = getDb()
    const p = parseBRLToCents(proDraft.trim())
    const c = p ?? 0
    setProCents(c)
    setPjSimProlaboreCents(db, c)
    touch()
    persistSoon()
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2">
        <Link to="/" className="inline-flex w-fit items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <span aria-hidden="true">←</span> Voltar
        </Link>
        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-semibold tracking-tight text-white"
        >
          Simulador PJ
        </motion.h1>
        <p className="max-w-2xl text-sm text-zinc-400">
          Projeção rápida de imposto sobre faturamento, INSS de 11% sobre pró-labore e sobra de caixa.           Faturamento, conta atual, valor mantido na conta, pró-labore e alíquota ficam salvos no seu{' '}
          <strong className="text-zinc-300">SQLite local</strong> (backup .sqlite).
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass space-y-4 rounded-2xl p-5"
        >
          <h2 className="text-sm font-semibold text-zinc-200">Entradas</h2>

          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="pj-fat">
              Faturamento
            </label>
            <input
              id="pj-fat"
              inputMode="decimal"
              value={fatDraft}
              onChange={(e) => setFatDraft(e.target.value)}
              onBlur={() => persistFat()}
              placeholder="0,00"
              className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
            />
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="pj-conta">
              Valor em conta (atual)
            </label>
            <input
              id="pj-conta"
              inputMode="decimal"
              value={contaDraft}
              onChange={(e) => setContaDraft(e.target.value)}
              onBlur={() => persistConta()}
              placeholder="0,00"
              className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
            />
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="pj-mantido">
              Valor mantido na conta
            </label>
            <input
              id="pj-mantido"
              inputMode="decimal"
              value={mantidoDraft}
              onChange={(e) => setMantidoDraft(e.target.value)}
              onBlur={() => persistMantido()}
              placeholder="0,00"
              className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
            />
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="pj-pro">
              Pró-labore
            </label>
            <input
              id="pj-pro"
              inputMode="decimal"
              value={proDraft}
              onChange={(e) => setProDraft(e.target.value)}
              onBlur={() => persistPro()}
              placeholder="0,00"
              className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
            />
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="pj-pct">
              Imposto sobre faturamento (%)
            </label>
            <input
              id="pj-pct"
              inputMode="decimal"
              value={impostoPctStr}
              onChange={(e) => setImpostoPctStr(e.target.value)}
              onBlur={() => persistPct()}
              placeholder="ex.: 6"
              className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none ring-accent/30 focus:ring-2"
            />
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass space-y-4 rounded-2xl p-5"
        >
          <h2 className="text-sm font-semibold text-zinc-200">Resultados</h2>

          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4 border-b border-white/5 pb-3">
              <dt className="text-zinc-400">INSS (11% sobre pró-labore)</dt>
              <dd className="font-mono text-zinc-100">{formatBRL(inssCents)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/5 pb-3">
              <dt className="text-zinc-400">Imposto sobre faturamento</dt>
              <dd className="font-mono text-zinc-100">{formatBRL(impostoFaturamentoCents)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/5 pb-3">
              <dt className="text-zinc-400">Pró-labore líquido (após INSS)</dt>
              <dd className="font-mono text-zinc-100">{formatBRL(prolaboreLiquidoCents)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/5 pb-3">
              <dt className="text-zinc-300 font-medium">Lucro (conta − pró-labore − imposto)</dt>
              <dd className={`font-mono font-semibold ${lucroSimplesCents >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {formatBRL(lucroSimplesCents)}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/5 pb-3">
              <dt className="text-zinc-400">Caixa após INSS (acima − INSS)</dt>
              <dd className={`font-mono ${lucroAposInssCents >= 0 ? 'text-zinc-100' : 'text-rose-400'}`}>
                {formatBRL(lucroAposInssCents)}
              </dd>
            </div>
            <div className="flex justify-between gap-4 pt-1">
              <dt className="font-semibold text-zinc-200" title="Valor em conta (atual) − valor mantido na conta">
                Recebido em conta PF
              </dt>
              <dd
                className={`font-mono font-semibold ${recebidoContaPfCents >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
              >
                {formatBRL(recebidoContaPfCents)}
              </dd>
            </div>
          </dl>

          <p className="text-[11px] leading-relaxed text-zinc-500">
            Os percentuais reais de Simples Nacional / Lucro Presumido variam por faixa e atividade — use este painel como
            orientação. O INSS de PJ sobre pró-labore segue regras da Receita; 11% aqui é apenas uma referência rápida.
          </p>
        </motion.section>
      </div>
    </div>
  )
}
