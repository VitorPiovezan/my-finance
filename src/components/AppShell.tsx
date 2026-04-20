import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { loadDriveSessionToken } from '../lib/drive/driveTokenSession';
import { pushLocalSqliteBackupToDrive } from '../lib/drive/pushLocalSqliteBackup';
import { clearDriveSessionAndAllLocalData } from '../lib/session/logoutDriveAndLocal';
import { getEffectiveDriveOauthClientIdPreferSession } from '../lib/settings/driveFolder';
import { useFinanceDb } from '../context/useFinanceDb';
import { queryOne } from '../lib/db/query';
import { ymNow } from '../lib/queries/spendSummary';

const SIDEBAR_STORAGE_KEY = 'mf-sidebar-collapsed';

/** Micro-interação tipo React Bits / Framer Motion: leve, sem exagerar no movimento. */
const socialLinkTransition = { type: 'spring' as const, stiffness: 420, damping: 30 }

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
  const { persistNow, clearAllLocalData, getDb, version, dbEpoch } = useFinanceDb();
  const navigate = useNavigate();

  const [sidebarCollapsed, setSidebarCollapsed] =
    useState(readSidebarCollapsed);
  const [backupBusy, setBackupBusy] = useState(false);

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
