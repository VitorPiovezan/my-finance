import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFinanceDb } from '../context/useFinanceDb'
import { categorizeWithAi, countUncategorized, type CategorizeResult } from '../lib/ai/categorizer'
import { isAiConfigured } from '../lib/ai/settings'
import type { AnalysisFilter } from '../lib/queries/analysis'

type Props = {
  ym: string
  filter: AnalysisFilter
}

type Status =
  | { phase: 'idle' }
  | { phase: 'running'; processed: number; total: number; batch: number; totalBatches: number }
  | { phase: 'done'; result: CategorizeResult }
  | { phase: 'error'; message: string }

export function AiCategorizeButton({ ym, filter }: Props) {
  const { getDb, touch, persistSoon, version } = useFinanceDb()
  const [status, setStatus] = useState<Status>({ phase: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  const filterKey = `${filter.scope ?? ''}|${filter.accountId ?? ''}`
  const pending = useMemo(
    () => countUncategorized(getDb(), ym, filter),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida leituras após mutações no SQLite
    [getDb, ym, filterKey, version, status],
  )

  const configured = isAiConfigured(getDb())
  const running = status.phase === 'running'

  const onRun = async () => {
    if (!configured) return
    if (pending === 0) {
      setStatus({
        phase: 'done',
        result: {
          processed: 0,
          updated: 0,
          skipped: 0,
          learnedApplied: 0,
          aiProcessed: 0,
          assignments: [],
        },
      })
      return
    }
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStatus({ phase: 'running', processed: 0, total: pending, batch: 0, totalBatches: 1 })
    try {
      const db = getDb()
      const result = await categorizeWithAi(db, {
        ym,
        filter,
        batchSize: 30,
        signal: ctrl.signal,
        onProgress: (p) => setStatus({ phase: 'running', ...p }),
      })
      touch()
      persistSoon()
      setStatus({ phase: 'done', result })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus({ phase: 'error', message })
    } finally {
      abortRef.current = null
    }
  }

  const onCancel = () => {
    abortRef.current?.abort()
  }

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-accent/15 text-xs font-bold text-accent-2"
            >
              IA
            </span>
            <h3 className="text-sm font-semibold text-zinc-100">Categorizar com IA</h3>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Primeiro aplica o que já aprendeu do seu histórico, depois manda o resto para o Gemini e aplica a melhor opção entre as suas categorias.
            {pending > 0 ? (
              <>
                {' '}
                <strong className="text-zinc-200">
                  {pending} lançamento{pending === 1 ? '' : 's'}
                </strong>{' '}
                pendente{pending === 1 ? '' : 's'} neste mês.
              </>
            ) : (
              <> Nenhum lançamento pendente neste mês.</>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {configured ? (
            <button
              type="button"
              onClick={onRun}
              disabled={running || pending === 0}
              className="rounded-xl bg-accent/20 px-4 py-2 text-sm font-medium text-accent-2 ring-1 ring-accent/30 transition hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? 'Processando…' : pending === 0 ? 'Sem pendentes' : 'Categorizar agora'}
            </button>
          ) : (
            <Link
              to="/config-ia"
              className="rounded-xl border border-white/10 bg-surface-2 px-4 py-2 text-sm text-zinc-200 hover:bg-surface-3"
            >
              Configurar IA
            </Link>
          )}
          {running ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl border border-white/10 bg-surface-2 px-3 py-2 text-xs text-zinc-300 hover:bg-surface-3"
            >
              Cancelar
            </button>
          ) : null}
        </div>
      </div>

      {status.phase === 'running' ? (
        <div className="mt-4">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{
                width: `${status.total > 0 ? Math.min(100, (status.processed / status.total) * 100) : 0}%`,
              }}
            />
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            Lote {status.batch}/{status.totalBatches} · {status.processed}/{status.total}
          </p>
        </div>
      ) : null}

      {status.phase === 'done' ? (
        <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-100">
          <p>
            <strong>{status.result.updated}</strong> categorizado{status.result.updated === 1 ? '' : 's'} ·{' '}
            <strong>{status.result.skipped}</strong> sem decisão · {status.result.processed} analisado{status.result.processed === 1 ? '' : 's'}.
          </p>
          {status.result.learnedApplied > 0 ? (
            <p className="mt-1 text-emerald-100/70">
              <strong>{status.result.learnedApplied}</strong> resolvido
              {status.result.learnedApplied === 1 ? '' : 's'} só com o aprendizado local ·{' '}
              <strong>{status.result.aiProcessed}</strong> mandado
              {status.result.aiProcessed === 1 ? '' : 's'} para o Gemini.
            </p>
          ) : null}
          {status.result.skipped > 0 ? (
            <p className="mt-1 text-emerald-100/70">
              Os itens sem decisão continuam sem categoria — ajuste manualmente em{' '}
              <Link to="/lancamentos" className="underline">Lançamentos</Link>.
            </p>
          ) : null}
        </div>
      ) : null}

      {status.phase === 'error' ? (
        <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
          Falhou: {status.message}
        </div>
      ) : null}
    </div>
  )
}
