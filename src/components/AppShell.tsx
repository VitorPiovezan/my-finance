import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { isPinConfigured, lockSession } from '../lib/sessionPin';
import { useFinanceDb } from '../context/useFinanceDb';
import { queryOne } from '../lib/db/query';
import { ymNow } from '../lib/queries/spendSummary';

const SIDEBAR_STORAGE_KEY = 'mf-sidebar-collapsed';

type NavItem = {
  to: string;
  label: string;
  /** Duas letras no menu recolhido (desktop). */
  abbr: string;
  /** Quando presente, exibe uma bolinha vermelha com o número. Ocultado se for 0. */
  badge?: number;
};

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppShell() {
  const { exportDatabaseFile, persistNow, clearAllLocalData, getDb, version, dbEpoch } =
    useFinanceDb();

  const [sidebarCollapsed, setSidebarCollapsed] =
    useState(readSidebarCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

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
    { to: '/', label: 'Visão geral', abbr: 'VG' },
    { to: '/por-categoria', label: 'Por categoria', abbr: 'PC' },
    { to: '/lancamentos', label: 'Lançamentos', abbr: 'LC' },
    { to: '/categorizar', label: 'Categorizar', abbr: 'Ct' },
    {
      to: '/agenda',
      label: 'Previsões',
      abbr: 'Pr',
      badge: overdueScheduledCount,
    },
    { to: '/investimentos', label: 'Investimentos', abbr: 'Iv' },
    { to: '/categorias', label: 'Categorias', abbr: 'Ca' },
    { to: '/contas', label: 'Contas', abbr: 'Co' },
    { to: '/sincronizar', label: 'Sincronizar', abbr: 'Si' },
    { to: '/importacoes', label: 'Extratos', abbr: 'Ex' },
    { to: '/config-ia', label: 'Configurar IA', abbr: 'IA' },
  ];

  return (
    <div className="mx-auto flex min-h-svh flex-col gap-6 px-4 py-6 md:flex-row md:px-6">
      <motion.aside
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        className={[
          'glass flex shrink-0 flex-col gap-4 rounded-2xl p-4 transition-[width,padding] duration-200 ease-out',
          'w-full',
          sidebarCollapsed
            ? 'md:w-[4.25rem] md:overflow-hidden md:p-2'
            : 'md:w-56',
        ].join(' ')}
      >
        <div
          className={[
            'flex items-start justify-between gap-2 px-2',
            sidebarCollapsed ? 'md:justify-center' : '',
          ].join(' ')}
        >
          <div
            className={sidebarCollapsed ? 'max-md:block md:hidden' : 'block'}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-2">
              Local
            </p>
            <p className="mt-1 text-lg font-semibold text-white">My Finance</p>
          </div>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(c => !c)}
            className="hidden shrink-0 rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-300 transition hover:bg-white/10 hover:text-white md:inline-flex"
            title={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
            aria-expanded={!sidebarCollapsed}
            aria-label={
              sidebarCollapsed
                ? 'Expandir menu lateral'
                : 'Recolher menu lateral'
            }
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className={sidebarCollapsed ? 'rotate-180' : ''}
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
        </div>
        <nav className="flex flex-col gap-1">
          {nav.map(item => {
            const showBadge = typeof item.badge === 'number' && item.badge > 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                title={item.label}
                className={({ isActive }) =>
                  [
                    'relative flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm font-medium transition',
                    isActive
                      ? 'bg-white/10 text-white shadow-inner'
                      : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100',
                    sidebarCollapsed ? 'md:justify-center md:px-2' : '',
                  ].join(' ')
                }
              >
                <span
                  className={
                    sidebarCollapsed
                      ? 'max-md:inline md:sr-only'
                      : 'min-w-0 truncate'
                  }
                >
                  {item.label}
                </span>
                <span
                  className={
                    sidebarCollapsed
                      ? 'hidden h-9 w-9 items-center justify-center rounded-lg text-xs font-semibold tracking-tight md:flex'
                      : 'hidden'
                  }
                  aria-hidden="true"
                >
                  {item.abbr}
                </span>
                {showBadge ? (
                  <span
                    aria-label={`${item.badge} pendentes`}
                    className={[
                      'inline-flex min-w-[18px] shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold leading-[18px] text-white shadow-[0_0_0_2px_rgba(244,63,94,0.25)]',
                      sidebarCollapsed
                        ? 'md:absolute md:right-1 md:top-0.5 md:min-w-[14px] md:px-0.5 md:text-[8px]'
                        : '',
                    ].join(' ')}
                  >
                    {item.badge && item.badge > 99 ? '99+' : item.badge}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>
        <div
          className={[
            'mt-auto flex flex-col gap-2 border-t border-white/10 pt-4',
            sidebarCollapsed ? 'md:items-stretch' : '',
          ].join(' ')}
        >
          <button
            type="button"
            onClick={() => void persistNow().then(() => exportDatabaseFile())}
            title="Exportar cópia .sqlite"
            className={[
              'rounded-xl border border-white/10 bg-surface-2 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-surface-3',
              sidebarCollapsed
                ? 'md:flex md:items-center md:justify-center md:px-2'
                : '',
            ].join(' ')}
          >
            {sidebarCollapsed ? (
              <span className="hidden md:inline-flex" aria-hidden="true">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" x2="12" y1="15" y2="3" />
                </svg>
              </span>
            ) : null}
            <span className={sidebarCollapsed ? 'md:sr-only' : ''}>
              Exportar cópia .sqlite
            </span>
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
            title="Apagar dados locais"
            className={[
              'rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-left text-xs text-rose-200 hover:bg-danger/20',
              sidebarCollapsed
                ? 'md:flex md:items-center md:justify-center md:px-2'
                : '',
            ].join(' ')}
          >
            {sidebarCollapsed ? (
              <span className="hidden md:inline-flex" aria-hidden="true">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </span>
            ) : null}
            <span className={sidebarCollapsed ? 'md:sr-only' : ''}>
              Apagar dados locais e recomeçar
            </span>
          </button>
          {isPinConfigured() ? (
            <button
              type="button"
              onClick={() => {
                lockSession();
                window.location.reload();
              }}
              title="Encerrar sessão (PIN)"
              className={[
                'rounded-xl px-3 py-2 text-left text-xs text-zinc-500 hover:text-zinc-300',
                sidebarCollapsed
                  ? 'md:flex md:items-center md:justify-center'
                  : '',
              ].join(' ')}
            >
              {sidebarCollapsed ? (
                <span className="hidden md:inline-flex" aria-hidden="true">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" x2="9" y1="12" y2="12" />
                  </svg>
                </span>
              ) : null}
              <span className={sidebarCollapsed ? 'md:sr-only' : ''}>
                Encerrar sessão (PIN)
              </span>
            </button>
          ) : null}
        </div>
      </motion.aside>
      <main className="min-w-0 flex-1">
        {/* dbEpoch só muda ao trocar o .sqlite inteiro — remonta a rota sem resetar a cada edição */}
        <Outlet key={dbEpoch} />
      </main>
    </div>
  );
}
