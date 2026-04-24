import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { loadDriveSessionToken } from '../lib/drive/driveTokenSession';
import { pushLocalSqliteBackupToDrive } from '../lib/drive/pushLocalSqliteBackup';
import { clearDriveSessionAndAllLocalData } from '../lib/session/logoutDriveAndLocal';
import { getEffectiveDriveOauthClientIdPreferSession } from '../lib/settings/driveFolder';
import { useAmountVisibility } from '../context/AmountVisibilityContext';
import { useFinanceDb } from '../context/useFinanceDb';
import { queryOne } from '../lib/db/query';
import { ymNow } from '../lib/queries/spendSummary';

const SIDEBAR_STORAGE_KEY = 'mf-sidebar-collapsed';

/** Micro-interação tipo React Bits / Framer Motion: leve, sem exagerar no movimento. */
const socialLinkTransition = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 30,
};

/** Ícone 20×20 para menu recolhido (stroke). */
function NavRouteIcon({ to }: { to: string }) {
  const cn = 'size-5 shrink-0 text-current opacity-90';
  switch (to) {
    case '/':
      return (
        <svg
          className={cn}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case '/por-categoria':
      return (
        <svg
          className={cn}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
          <path d="M22 12A10 10 0 0 0 12 2v10z" />
        </svg>
      );
    case '/lancamentos':
      return (
        <svg
          className={cn}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <line x1="8" x2="21" y1="6" y2="6" />
          <line x1="8" x2="21" y1="12" y2="12" />
          <line x1="8" x2="21" y1="18" y2="18" />
          <line x1="3" x2="3.01" y1="6" y2="6" />
          <line x1="3" x2="3.01" y1="12" y2="12" />
          <line x1="3" x2="3.01" y1="18" y2="18" />
        </svg>
      );
    case '/categorizar':
      return (
        <svg
          className={cn}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
          <path d="M7 7h.01" />
        </svg>
      );
    case '/agenda':
      return (
        <svg
          className={cn}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
          <line x1="16" x2="16" y1="2" y2="6" />
          <line x1="8" x2="8" y1="2" y2="6" />
          <line x1="3" x2="21" y1="10" y2="10" />
        </svg>
      );
    case '/investimentos':
      return (
        <svg
          className={cn}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </svg>
      );
    case '/categorias':
      return (
        <svg
          className={cn}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      );
    case '/contas':
      return (
        <svg
          className={cn}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect width="20" height="14" x="2" y="5" rx="2" />
          <line x1="2" x2="22" y1="10" y2="10" />
        </svg>
      );
    case '/sincronizar':
      return (
        <svg
          className={cn}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
          <path d="M12 12v9" />
          <path d="m16 16-4-4-4 4" />
        </svg>
      );
    case '/importacoes':
      return (
        <svg
          className={cn}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M12 18v-6" />
          <path d="m9 15 3 3 3-3" />
        </svg>
      );
    case '/config-ia':
      return (
        <svg
          className={cn}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
          <path d="M20 3v4" />
          <path d="M22 5h-4" />
          <path d="M4 17v2" />
          <path d="M5 18H3" />
        </svg>
      );
    default:
      return (
        <svg
          className={cn}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
  }
}

type NavItem = {
  to: string;
  label: string;
  /** Duas letras — fallback se ícone não existir. */
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
  const { persistNow, clearAllLocalData, getDb, version, dbEpoch } =
    useFinanceDb();
  const { amountsVisible, toggleAmounts } = useAmountVisibility();
  const navigate = useNavigate();
  const location = useLocation();

  const [sidebarCollapsed, setSidebarCollapsed] =
    useState(readSidebarCollapsed);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setMobileNavOpen(false));
  }, [location.pathname, location.search]);

  const onPushBackupToDrive = () => {
    void (async () => {
      await persistNow();
      const token = loadDriveSessionToken(
        getEffectiveDriveOauthClientIdPreferSession(getDb()),
      );
      if (!token) {
        window.alert(
          'Conecte o Google na página Sincronizar antes de enviar o backup (token OAuth).',
        );
        return;
      }
      setBackupBusy(true);
      try {
        const r = await pushLocalSqliteBackupToDrive({ db: getDb(), token });
        if (r.ok === false) {
          window.alert(r.error);
          return;
        }
        window.alert(
          r.created
            ? `Backup criado no Drive (id ${r.fileId.slice(0, 12)}…).`
            : 'Backup no Drive atualizado com sucesso.',
        );
      } finally {
        setBackupBusy(false);
      }
    })();
  };

  const onDisconnectDriveSession = () => {
    const ok = window.confirm(
      'Desconectar o Google e apagar os dados locais neste navegador?\n\n' +
        'Contas, lançamentos e configurações salvas no aparelho serão removidos. ' +
        'O backup no Google Drive não é apagado. Depois você será enviado à tela de entrar.',
    );
    if (!ok) return;
    void (async () => {
      try {
        await clearDriveSessionAndAllLocalData(clearAllLocalData);
        navigate('/entrar', { replace: true });
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      }
    })();
  };

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
    <div className="mx-auto flex min-h-svh flex-col gap-6 px-4 pb-6 md:py-6 md:flex-row md:px-6">
      <header className="sticky top-0 z-30 -mx-4 flex shrink-0 items-center gap-3 border-b border-white/10 bg-[rgb(9,9,11)]/50 px-4 py-3 backdrop-blur-xl backdrop-saturate-150 md:hidden">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-200 outline-none ring-accent/0 transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-accent/50"
          aria-expanded={mobileNavOpen}
          aria-controls="mf-app-sidebar"
          aria-label="Abrir menu"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="4" x2="20" y1="6" y2="6" />
            <line x1="4" x2="20" y1="12" y2="12" />
            <line x1="4" x2="20" y1="18" y2="18" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent-2">
            Project
          </p>
          <p className="truncate text-base font-semibold text-white">
            My Finance
          </p>
        </div>
        <button
          type="button"
          onClick={toggleAmounts}
          className="shrink-0 rounded-xl border border-white/10 bg-white/5 p-2 text-zinc-300 transition hover:bg-white/10 hover:text-white"
          title={
            amountsVisible
              ? 'Ocultar valores monetários'
              : 'Mostrar valores monetários'
          }
          aria-pressed={amountsVisible}
          aria-label={amountsVisible ? 'Ocultar valores' : 'Mostrar valores'}
        >
          {amountsVisible ? (
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
            >
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
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
            >
              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
              <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
              <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
              <line x1="2" x2="22" y1="2" y2="22" />
            </svg>
          )}
        </button>
      </header>

      {mobileNavOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] md:hidden"
          aria-label="Fechar menu"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <motion.aside
        id="mf-app-sidebar"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className={[
          'glass flex shrink-0 flex-col gap-4 rounded-2xl p-4 transition-[width,padding,transform] duration-200 ease-out',
          'w-full',
          'max-md:fixed max-md:top-0 max-md:z-50 max-md:h-svh max-md:max-h-[100dvh] max-md:w-[min(20rem,calc(100vw-1.5rem))] max-md:overflow-y-auto max-md:rounded-l-none max-md:rounded-r-2xl max-md:py-5 max-md:shadow-2xl',
          mobileNavOpen
            ? 'max-md:translate-x-0'
            : 'max-md:pointer-events-none max-md:-translate-x-[calc(100%+1rem)]',
          sidebarCollapsed
            ? 'md:w-[4.75rem] md:overflow-visible md:p-3 md:pt-3.5'
            : 'md:w-56 md:overflow-visible',
        ].join(' ')}
      >
        <div
          className={[
            'flex w-full min-w-0 shrink-0 items-center gap-2 px-0.5 sm:px-1',
            sidebarCollapsed ? 'md:justify-center' : 'justify-between',
          ].join(' ')}
        >
          <div
            className={
              sidebarCollapsed ? 'max-md:block min-w-0 md:hidden' : 'min-w-0'
            }
          >
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-2">
              Project
            </p>
            <p className="mt-1 text-lg font-semibold leading-tight text-white">
              My Finance
            </p>
          </div>
          <div
            className={[
              'flex shrink-0 items-center gap-1.5',
              sidebarCollapsed ? 'md:flex-col md:items-center md:gap-1.5' : '',
            ].join(' ')}
          >
            <button
              type="button"
              onClick={toggleAmounts}
              className="hidden shrink-0 rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-300 transition hover:bg-white/10 hover:text-white md:inline-flex"
              title={
                amountsVisible
                  ? 'Ocultar valores monetários'
                  : 'Mostrar valores monetários'
              }
              aria-pressed={amountsVisible}
              aria-label={
                amountsVisible ? 'Ocultar valores' : 'Mostrar valores'
              }
            >
              {amountsVisible ? (
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
                >
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
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
                >
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                  <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                  <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                  <line x1="2" x2="22" y1="2" y2="22" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="inline-flex shrink-0 rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-300 transition hover:bg-white/10 hover:text-white md:hidden"
              aria-label="Fechar menu"
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
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
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
                onClick={() => setMobileNavOpen(false)}
                className={({ isActive }) =>
                  [
                    'relative flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition',
                    sidebarCollapsed ? 'md:justify-center md:px-2' : '',
                    isActive
                      ? 'bg-white/10 text-white shadow-inner'
                      : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100',
                  ].join(' ')
                }
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-current"
                  aria-hidden="true"
                >
                  <NavRouteIcon to={item.to} />
                </span>
                <span
                  className={
                    sidebarCollapsed
                      ? 'max-md:inline min-w-0 md:sr-only'
                      : 'min-w-0 flex-1 truncate'
                  }
                >
                  {item.label}
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
            'mt-auto flex flex-col gap-3',
            sidebarCollapsed ? 'md:items-stretch' : '',
          ].join(' ')}
        >
          <div
            className={[
              'rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3',
              sidebarCollapsed ? 'md:px-2 md:py-2' : '',
            ].join(' ')}
          >
            <p
              className={
                sidebarCollapsed
                  ? 'text-center text-[10px] leading-tight text-zinc-500 md:sr-only'
                  : 'text-[11px] leading-snug text-zinc-400'
              }
            >
              <span className="font-medium text-zinc-200">My Finance</span>
              <span className="text-zinc-500"> — projeto open source · </span>
              Vitor Piovezan
            </p>
            <div
              className={[
                'mt-2 flex flex-wrap items-center gap-2',
                sidebarCollapsed ? 'md:justify-center' : '',
              ].join(' ')}
            >
              <motion.a
                href="https://www.linkedin.com/in/vitor-piovezan-6a65351aa/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="LinkedIn — Vitor Piovezan"
                title="LinkedIn — Vitor Piovezan"
                whileHover={{ scale: 1.06, y: -1 }}
                whileTap={{ scale: 0.94 }}
                transition={socialLinkTransition}
                className="inline-flex size-9 items-center justify-center rounded-xl border border-white/12 bg-white/[0.06] text-sky-300/95 shadow-sm shadow-black/10 outline-none ring-accent/0 transition-colors hover:border-sky-400/25 hover:bg-sky-500/10 hover:shadow-md hover:shadow-sky-950/20 focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </motion.a>
              <motion.a
                href="https://github.com/VitorPiovezan"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub — VitorPiovezan"
                title="GitHub — VitorPiovezan"
                whileHover={{ scale: 1.06, y: -1 }}
                whileTap={{ scale: 0.94 }}
                transition={socialLinkTransition}
                className="inline-flex size-9 items-center justify-center rounded-xl border border-white/12 bg-white/[0.06] text-zinc-200 shadow-sm shadow-black/10 outline-none ring-accent/0 transition-colors hover:border-white/25 hover:bg-white/10 hover:shadow-md hover:shadow-black/25 focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z"
                    clipRule="evenodd"
                  />
                </svg>
              </motion.a>
            </div>
          </div>
          <div
            className={[
              'flex flex-col gap-2 border-t border-white/10 pt-4',
              sidebarCollapsed ? 'md:items-stretch' : '',
            ].join(' ')}
          >
            <button
              type="button"
              disabled={backupBusy}
              onClick={onPushBackupToDrive}
              title="Grava ou atualiza my-finance.sqlite na pasta raiz do Drive (igual em Sincronizar)."
              className={[
                'rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-left text-xs font-medium text-emerald-100 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50',
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
                    <path d="M12 16V4" />
                    <path d="M8 8l4-4 4 4" />
                    <path d="M20 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2" />
                    <path d="M12 20h.01" />
                  </svg>
                </span>
              ) : null}
              <span className={sidebarCollapsed ? 'md:sr-only' : ''}>
                {backupBusy ? 'Enviando…' : 'Enviar backup ao Drive'}
              </span>
            </button>
            <button
              type="button"
              onClick={onDisconnectDriveSession}
              title="Desconectar Google e ir ao login"
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
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" x2="9" y1="12" y2="12" />
                  </svg>
                </span>
              ) : null}
              <span className={sidebarCollapsed ? 'md:sr-only' : ''}>
                Desconectar sessão Google
              </span>
            </button>
          </div>
        </div>
      </motion.aside>
      <main className="min-w-0 flex-1">
        {/* dbEpoch só muda ao trocar o .sqlite inteiro — remonta a rota sem resetar a cada edição */}
        <Outlet key={dbEpoch} />
      </main>
    </div>
  );
}
