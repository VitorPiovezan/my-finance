import { motion } from 'framer-motion';
import { useMemo } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { isPinConfigured, lockSession } from '../lib/sessionPin';
import { useFinanceDb } from '../context/useFinanceDb';
import { queryOne } from '../lib/db/query';
import { ymNow } from '../lib/queries/spendSummary';

type NavItem = {
  to: string;
  label: string;
  /** Quando presente, exibe uma bolinha vermelha com o número. Ocultado se for 0. */
  badge?: number;
};

export function AppShell() {
  const { exportDatabaseFile, persistNow, clearAllLocalData, getDb, version } =
    useFinanceDb();

  /**
   * Quantos `scheduled_payments` ainda não pagos têm vencimento em um mês
   * ANTERIOR ao atual — ou seja, lançamentos futuros que ficaram pra trás.
   * Sinaliza na nav que algo precisa ser revisado (marcar pago/apagar/editar).
   */
  const overdueScheduledCount = useMemo(() => {
    try {
      const db = getDb();
      const row = queryOne(
        db,
        `SELECT COUNT(*) AS n
         FROM scheduled_payments
         WHERE paid_at IS NULL
           AND substr(due_date, 1, 7) < ?`,
        [ymNow()],
      );
      return Number(row?.n ?? 0);
    } catch {
      return 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalida após mutações no SQLite
  }, [getDb, version]);

  const nav: NavItem[] = [
    { to: '/', label: 'Visão geral' },
    { to: '/por-categoria', label: 'Por categoria' },
    { to: '/lancamentos', label: 'Lançamentos' },
    { to: '/categorizar', label: 'Categorizar' },
    { to: '/agenda', label: 'Previsões', badge: overdueScheduledCount },
    { to: '/categorias', label: 'Categorias' },
    { to: '/contas', label: 'Contas' },
    { to: '/sincronizar', label: 'Sincronizar' },
    { to: '/importacoes', label: 'Extratos' },
    { to: '/config-ia', label: 'Configurar IA' },
  ];

  return (
    <div className="mx-auto flex min-h-svh max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row md:px-6">
      <motion.aside
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        className="glass flex shrink-0 flex-col gap-4 rounded-2xl p-4 md:w-56"
      >
        <div className="px-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-2">
            Local
          </p>
          <p className="mt-1 text-lg font-semibold text-white">My Finance</p>
        </div>
        <nav className="flex flex-col gap-1">
          {nav.map(item => {
            const showBadge = typeof item.badge === 'number' && item.badge > 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  [
                    'flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm font-medium transition',
                    isActive
                      ? 'bg-white/10 text-white shadow-inner'
                      : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100',
                  ].join(' ')
                }
                title={
                  showBadge
                    ? `${item.badge} futuro${item.badge === 1 ? '' : 's'} em mês anterior — revisar`
                    : undefined
                }
              >
                <span className="min-w-0 truncate">{item.label}</span>
                {showBadge ? (
                  <span
                    aria-label={`${item.badge} pendentes`}
                    className="inline-flex min-w-[18px] shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold leading-[18px] text-white shadow-[0_0_0_2px_rgba(244,63,94,0.25)]"
                  >
                    {item.badge && item.badge > 99 ? '99+' : item.badge}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-2 border-t border-white/10 pt-4">
          <button
            type="button"
            onClick={() => void persistNow().then(() => exportDatabaseFile())}
            className="rounded-xl border border-white/10 bg-surface-2 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-surface-3"
          >
            Exportar cópia .sqlite
          </button>
          <button
            type="button"
            onClick={() => {
              const ok = window.confirm(
                'Apagar TODOS os dados deste app neste navegador?\n\nContas, lançamentos, importações, agenda e categorias extras somem. As categorias padrão voltam. Não dá para desfazer.',
              );
              if (!ok) return;
              void clearAllLocalData().catch(e =>
                window.alert(e instanceof Error ? e.message : String(e)),
              );
            }}
            className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-left text-xs text-rose-200 hover:bg-danger/20"
          >
            Apagar dados locais e recomeçar
          </button>
          {isPinConfigured() ? (
            <button
              type="button"
              onClick={() => {
                lockSession();
                window.location.reload();
              }}
              className="rounded-xl px-3 py-2 text-left text-xs text-zinc-500 hover:text-zinc-300"
            >
              Encerrar sessão (PIN)
            </button>
          ) : null}
        </div>
      </motion.aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
