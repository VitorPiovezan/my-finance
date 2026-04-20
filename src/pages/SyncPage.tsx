import { motion } from 'framer-motion'
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFinanceDb } from '../context/useFinanceDb'
import { queryAll, run } from '../lib/db/query'
import { requestDriveAccessToken } from '../lib/drive/googleAuth'
import { applyCsvImport } from '../lib/import/applyCsv'
import { parseBankCsv } from '../lib/import/csv'
import {
  extractDriveFolderId,
  getDriveOauthClientId,
  getDriveRootFolderId,
  isLikelyDriveFolderId,
  isLikelyGoogleOauthClientId,
  setDriveOauthClientId,
  setDriveRootFolderId,
} from '../lib/settings/driveFolder'
import { parseBillingRefYm } from '../lib/import/billingMonth'
import { ymNow } from '../lib/queries/spendSummary'
import { syncDriveToDatabase } from '../lib/sync/driveSync'
import type { Row } from '../lib/db/query'
import { newId } from '../lib/id'

export function SyncPage() {
  const {
    getDb,
    touch,
    persistSoon,
    version,
    exportDatabaseFile,
    persistNow,
    replaceDatabaseFromFile,
  } = useFinanceDb()
  const [clientId, setClientId] = useState<string>(() => getDriveOauthClientId(getDb()))
  const [rootId, setRootId] = useState<string>(() => getDriveRootFolderId(getDb()))
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [assignStatementMonth, setAssignStatementMonth] = useState(true)
  const [refMonthCartao, setRefMonthCartao] = useState(() => ymNow())
  const [refMonthConta, setRefMonthConta] = useState(() => ymNow())
  const [localStatementMonth, setLocalStatementMonth] = useState(() => ymNow())

  const accounts = useMemo(() => {
    const db = getDb()
    return queryAll(db, `SELECT id, name, kind, institution_key FROM accounts WHERE deleted_at IS NULL ORDER BY name`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDb, version])

  const appendLog = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-200), `[${new Date().toLocaleTimeString('pt-BR')}] ${line}`])
  }, [])

  const connectGoogle = async () => {
    const trimmed = clientId.trim()
    if (!trimmed) {
      appendLog('Cadastre o OAuth Client ID do Google no campo acima antes de conectar.')
      return
    }
    if (!isLikelyGoogleOauthClientId(trimmed)) {
      appendLog('O Client ID deve terminar em ".apps.googleusercontent.com". Confira o valor colado.')
      return
    }
    try {
      const t = await requestDriveAccessToken(trimmed, true)
      setToken(t)
      appendLog('Google conectado (token válido por algumas horas; reconecte se der 401).')
    } catch (e) {
      appendLog(e instanceof Error ? e.message : 'Falha ao conectar Google')
    }
  }

  const persistClientId = () => {
    const trimmed = clientId.trim()
    if (!trimmed) {
      setDriveOauthClientId(getDb(), '')
      touch()
      persistSoon()
      appendLog('OAuth Client ID removido.')
      return
    }
    if (!isLikelyGoogleOauthClientId(trimmed)) {
      appendLog('O Client ID deve terminar em ".apps.googleusercontent.com".')
      return
    }
    setDriveOauthClientId(getDb(), trimmed)
    touch()
    persistSoon()
    appendLog('OAuth Client ID salvo no banco local.')
  }

  const persistRoot = () => {
    const id = extractDriveFolderId(rootId)
    if (!isLikelyDriveFolderId(id)) {
      appendLog('Não parece um ID de pasta. Cole o link do Drive (…/folders/…) ou só o ID após /folders/.')
      return
    }
    setDriveRootFolderId(getDb(), id)
    setRootId(id)
    touch()
    persistSoon()
    appendLog('ID da pasta raiz salvo no banco local.')
  }

  const runSync = async () => {
    if (!token) {
      appendLog('Conecte o Google antes.')
      return
    }
    const id = extractDriveFolderId(rootId)
    if (!isLikelyDriveFolderId(id)) {
      appendLog('ID da pasta inválido. Salve de novo com o link …/folders/… ou só o ID.')
      return
    }
    setBusy(true)
    try {
      await syncDriveToDatabase({
        db: getDb(),
        token,
        rootFolderId: id,
        onLog: appendLog,
        assignBillingMonths: assignStatementMonth,
        billingRefYmCredit: parseBillingRefYm(refMonthCartao),
        billingRefYmChecking: parseBillingRefYm(refMonthConta),
      })
      touch()
      persistSoon()
      appendLog('Sincronização concluída.')
    } catch (e) {
      appendLog(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onLocalCsv = async (file: File | null, accountId: string) => {
    if (!file || !accountId) return
    setBusy(true)
    try {
      const text = await file.text()
      const acc = accounts.find((a) => String(a.id) === accountId)
      const treatPositiveAsExpense = acc && String(acc.kind) === 'credit'
      const rows = parseBankCsv(text, { treatPositiveAsExpense })
      if (rows.length === 0) {
        appendLog(`Arquivo local "${file.name}": nenhuma linha reconhecida.`)
        return
      }
      const externalRef = `local:${file.name}:${file.size}:${file.lastModified}`
      const billingRefYm = assignStatementMonth ? parseBillingRefYm(localStatementMonth) : null
      const res = await applyCsvImport({
        db: getDb(),
        accountId,
        institutionKey: 'local',
        externalRef,
        fileName: file.name,
        rows,
        billingRefYm,
      })
      if (res.skippedFile) {
        appendLog(`"${file.name}": já importado (mesmo nome/tamanho/data).`)
      } else if (res.skipped > 0) {
        appendLog(
          `"${file.name}": ${res.inserted} lançamentos inseridos · ${res.skipped} já existiam (duplicatas descartadas).`,
        )
      } else {
        appendLog(`"${file.name}": ${res.inserted} lançamentos inseridos.`)
      }
      touch()
      persistSoon()
    } catch (e) {
      appendLog(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onRestoreSqlite = async (file: File | null) => {
    if (!file) return
    const name = file.name.toLowerCase()
    if (!name.endsWith('.sqlite') && !name.endsWith('.db')) {
      appendLog(`"${file.name}": extensão não reconhecida. Esperado .sqlite ou .db.`)
      return
    }
    const ok = window.confirm(
      `Restaurar banco a partir de "${file.name}"?\n\nIsso SUBSTITUI completamente os dados atuais deste navegador. ` +
        `Não dá pra desfazer. Dica: exporte antes uma cópia do estado atual.`,
    )
    if (!ok) return
    setBusy(true)
    try {
      await replaceDatabaseFromFile(file)
      appendLog(`Banco restaurado a partir de "${file.name}". Recarregando…`)
      setTimeout(() => window.location.reload(), 400)
    } catch (e) {
      appendLog(`Falha ao restaurar "${file.name}": ${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
    }
  }

  const seedManualTx = (accountId: string) => {
    if (!accountId) return
    const db = getDb()
    const today = new Date().toISOString().slice(0, 10)
    const tid = newId()
    const fp = `manual-seed:${tid}`
    run(
      db,
      `INSERT INTO transactions (id, account_id, category_id, amount_cents, occurred_at, billing_ref_ym, description, source, fingerprint, import_batch_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [tid, accountId, null, -100, today, null, 'Exemplo: ajuste ou apague', 'manual', fp, null, new Date().toISOString()],
    )
    touch()
    persistSoon()
    appendLog('Lançamento manual de exemplo criado (R$ 1,00 de saída).')
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Sincronizar extratos</h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-400">
          Na raiz (ex.: Financeiro) crie uma pasta por banco com o mesmo nome da chave da instituição (ex.:{' '}
          <span className="font-mono text-zinc-300">nubank</span>). Dentro dela use as subpastas{' '}
          <span className="font-mono text-zinc-300">cartao</span> e <span className="font-mono text-zinc-300">conta</span>:
          CSV de fatura vai em <span className="font-mono">cartao</span>; extrato de conta em <span className="font-mono">conta</span>.
          Precisa existir uma conta no app com a mesma chave e tipo compatível (crédito vs corrente). Importações repetidas
          são ignoradas pelo ID do arquivo no Drive. Abaixo, informe de <strong className="text-zinc-300">qual mês</strong> é
          cada extrato ao importar — assim o painel e os filtros batem com a fatura real.{' '}
          <Link to="/importacoes" className="text-accent-2 underline decoration-white/20 hover:decoration-accent-2">
            Ver histórico e apagar um extrato só
          </Link>
          .
        </p>
      </header>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass space-y-4 rounded-2xl p-6"
      >
        <h2 className="text-sm font-semibold text-white">Google Drive</h2>
        <div className="space-y-3 rounded-xl border border-white/10 bg-surface-1/50 p-4">
          <label className="flex cursor-pointer items-start gap-3 text-sm text-zinc-300">
            <input
              type="checkbox"
              className="mt-1 rounded border-white/20"
              checked={assignStatementMonth}
              onChange={(e) => setAssignStatementMonth(e.target.checked)}
            />
            <span>
              Gravar <strong className="text-white">mês de referência</strong> em todo lançamento novo desta importação
              (recomendado). Desmarque para usar só a data de cada linha do CSV.
            </span>
          </label>
          {assignStatementMonth ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Extratos em cartao/</label>
                <input
                  type="month"
                  value={refMonthCartao}
                  onChange={(e) => setRefMonthCartao(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2 font-mono text-sm text-white outline-none ring-accent/30 focus:ring-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Extratos em conta/</label>
                <input
                  type="month"
                  value={refMonthConta}
                  onChange={(e) => setRefMonthConta(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-3 py-2 font-mono text-sm text-white outline-none ring-accent/30 focus:ring-2"
                />
              </div>
            </div>
          ) : null}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">OAuth Client ID (Google)</label>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-2.5 font-mono text-sm text-white outline-none ring-accent/30 focus:ring-2"
              placeholder="0000…apps.googleusercontent.com"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-2 text-xs text-zinc-500">
              Crie um projeto no Google Cloud, ative a API do Drive e um OAuth 2.0 Client ID (aplicação Web).
              Nas <em>Authorized JavaScript origins</em> adicione o domínio onde o app roda (ex.:{' '}
              <code className="rounded bg-surface-2 px-1 py-0.5">https://vitorpiovezan.github.io</code>).
              O valor fica salvo no banco local (SQLite) deste navegador — nunca entra no bundle público.
            </p>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Pasta raiz no Drive</label>
            <input
              value={rootId}
              onChange={(e) => setRootId(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-surface-1 px-4 py-2.5 font-mono text-sm text-white outline-none ring-accent/30 focus:ring-2"
              placeholder="Cole o link da pasta ou só o ID (…/folders/ESTE_TRECHO)"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-2 text-xs text-zinc-500">
              Pode colar a URL inteira — a gente extrai o ID automaticamente.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => persistClientId()}
            className="rounded-xl border border-white/10 bg-surface-2 px-4 py-2 text-sm text-zinc-100 hover:bg-surface-3"
          >
            Salvar Client ID
          </button>
          <button
            type="button"
            onClick={() => persistRoot()}
            className="rounded-xl border border-white/10 bg-surface-2 px-4 py-2 text-sm text-zinc-100 hover:bg-surface-3"
          >
            Salvar pasta raiz
          </button>
          <button
            type="button"
            onClick={() => void connectGoogle()}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/15"
          >
            Conectar Google
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runSync()}
            className="rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-accent/20 disabled:opacity-50"
          >
            {busy ? 'Sincronizando…' : 'Sincronizar agora'}
          </button>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="glass space-y-4 rounded-2xl p-6"
      >
        <h2 className="text-sm font-semibold text-white">Arquivo CSV local</h2>
        <p className="text-sm text-zinc-400">
          Escolha o <strong className="text-zinc-300">mês deste arquivo</strong>, a conta e o CSV. O interruptor &quot;Gravar
          mês de referência&quot; na seção do Drive também vale aqui.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Mês deste CSV</label>
            <input
              type="month"
              value={localStatementMonth}
              onChange={(e) => setLocalStatementMonth(e.target.value)}
              disabled={busy}
              className="mt-2 block rounded-xl border border-white/10 bg-surface-1 px-3 py-2 font-mono text-sm text-white outline-none ring-accent/30 focus:ring-2 disabled:opacity-50"
            />
          </div>
          <LocalCsvRow accounts={accounts} disabled={busy} onImport={onLocalCsv} />
        </div>
        <button
          type="button"
          disabled={!accounts[0]}
          onClick={() => accounts[0] && seedManualTx(String(accounts[0].id))}
          className="text-xs text-zinc-500 underline decoration-white/20 hover:text-zinc-300"
        >
          Criar lançamento manual de teste na primeira conta
        </button>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass space-y-4 rounded-2xl p-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">Backup do banco</h2>
          <span className="text-[11px] text-zinc-500">Arquivo .sqlite com tudo</span>
        </div>
        <p className="text-sm text-zinc-400">
          <strong className="text-zinc-300">Exportar</strong> salva um arquivo{' '}
          <span className="font-mono text-zinc-300">.sqlite</span> contendo{' '}
          <strong className="text-zinc-300">todos</strong> os dados deste navegador: contas, lançamentos,
          categorias, importações, agenda, atalhos rápidos e regras de IA.{' '}
          <strong className="text-zinc-300">Restaurar</strong> carrega um desses arquivos e{' '}
          <strong className="text-rose-200">substitui completamente</strong> o estado atual.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void persistNow().then(() => exportDatabaseFile())}
            className="rounded-xl border border-white/10 bg-surface-2 px-4 py-2 text-sm text-zinc-100 hover:bg-surface-3 disabled:opacity-50"
          >
            Exportar cópia .sqlite
          </button>
          <label
            className={`cursor-pointer rounded-xl border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-amber-200 transition hover:bg-warning/20 ${
              busy ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            Restaurar de arquivo .sqlite
            <input
              type="file"
              accept=".sqlite,.db,application/x-sqlite3,application/vnd.sqlite3"
              disabled={busy}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null
                e.target.value = ''
                void onRestoreSqlite(file)
              }}
            />
          </label>
        </div>
      </motion.section>

      <section className="glass rounded-2xl p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Log</h2>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-400">
          {log.length === 0 ? 'Nenhuma mensagem ainda.' : log.join('\n')}
        </pre>
      </section>
    </div>
  )
}

function LocalCsvRow({
  accounts,
  disabled,
  onImport,
}: {
  accounts: Row[]
  disabled: boolean
  onImport: (file: File | null, accountId: string) => void | Promise<void>
}) {
  const [acc, setAcc] = useState('')
  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={acc}
        onChange={(e) => setAcc(e.target.value)}
        className="rounded-xl border border-white/10 bg-surface-1 px-3 py-2 text-sm text-white outline-none"
      >
        <option value="">Conta…</option>
        {accounts.map((a) => (
          <option key={String(a.id)} value={String(a.id)}>
            {String(a.name)}
          </option>
        ))}
      </select>
      <label className="cursor-pointer rounded-xl border border-white/10 bg-surface-2 px-4 py-2 text-sm hover:bg-surface-3">
        Escolher CSV
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={disabled || !acc}
          className="hidden"
          onChange={(e) => void onImport(e.target.files?.[0] ?? null, acc)}
        />
      </label>
    </div>
  )
}
