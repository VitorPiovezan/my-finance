import { motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useFinanceDb } from '../context/useFinanceDb'
import { queryAll, run } from '../lib/db/query'
import {
  clearDriveSessionToken,
  loadDriveSessionToken,
  saveDriveSessionToken,
} from '../lib/drive/driveTokenSession'
import {
  DRIVE_OAUTH_FLASH_ERROR_KEY,
  requestDriveAccessToken,
} from '../lib/drive/googleAuth'
import { applyCsvImport } from '../lib/import/applyCsv'
import { parseBankCsv } from '../lib/import/csv'
import {
  extractDriveFolderId,
  getDriveOauthClientId,
  getDriveRootFolderId,
  getEffectiveDriveOauthClientIdPreferSession,
  getEffectiveDriveRootFolderId,
  isLikelyDriveFolderId,
  isLikelyGoogleOauthClientId,
  setDriveOauthClientId,
  setDriveRootFolderId,
} from '../lib/settings/driveFolder'
import { parseBillingRefYm } from '../lib/import/billingMonth'
import { ensureFolderPath, uploadNewCsvFileToFolder } from '../lib/drive/driveApi'
import { pushLocalSqliteBackupToDrive } from '../lib/drive/pushLocalSqliteBackup'
import { SQLITE_DRIVE_BACKUP_NAME, downloadSqliteBackupBytes } from '../lib/drive/sqliteDriveBackup'
import { extractPdfText } from '../lib/import/pdfText'
import { pdfTextToNubankCsv, type PdfBankKey } from '../lib/import/pdfToCsv'
import { ymNow } from '../lib/queries/spendSummary'
import { syncDriveToDatabase } from '../lib/sync/driveSync'
import type { Row } from '../lib/db/query'
import { newId } from '../lib/id'
import { clearDriveSessionAndAllLocalData } from '../lib/session/logoutDriveAndLocal'

/** Após o fluxo OAuth (popup), um tick extra evita corrida com o fechamento da janela e com a sessão. */
const AFTER_OAUTH_DELAY_MS = 350

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function SyncPage() {
  const {
    getDb,
    touch,
    persistSoon,
    version,
    exportDatabaseFile,
    persistNow,
    replaceDatabaseFromFile,
    clearAllLocalData,
  } = useFinanceDb()
  const navigate = useNavigate()
  /** Efetivo (meta + env) para o campo não ficar vazio quando só existe VITE_* ou após restore. */
  const [clientId, setClientId] = useState<string>(() => getEffectiveDriveOauthClientIdPreferSession(getDb()))
  const [rootId, setRootId] = useState<string>(() => getEffectiveDriveRootFolderId(getDb()))
  const [token, setToken] = useState<string | null>(() =>
    loadDriveSessionToken(getEffectiveDriveOauthClientIdPreferSession(getDb())),
  )
  const [busy, setBusy] = useState(false)
  const logTapCountRef = useRef(0)
  const logTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [assignStatementMonth, setAssignStatementMonth] = useState(true)
  const [refMonthCartao, setRefMonthCartao] = useState(() => ymNow())
  const [refMonthConta, setRefMonthConta] = useState(() => ymNow())
  const [localStatementMonth, setLocalStatementMonth] = useState(() => ymNow())
  const [pdfBank, setPdfBank] = useState<PdfBankKey>('mercado-pago')
  const [pdfBucket, setPdfBucket] = useState<'cartao' | 'conta'>('cartao')
  const [pdfFile, setPdfFile] = useState<File | null>(null)

  const accounts = useMemo(() => {
    const db = getDb()
    return queryAll(db, `SELECT id, name, kind, institution_key FROM accounts WHERE deleted_at IS NULL ORDER BY name`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDb, version])

  /** Botão principal só quando Client ID e pasta raiz estão preenchidos e válidos no formulário. */
  const formConnectReady = useMemo(() => {
    const c = clientId.trim()
    const r = extractDriveFolderId(rootId)
    return !!(c && isLikelyGoogleOauthClientId(c) && isLikelyDriveFolderId(r))
  }, [clientId, rootId])

  const appendLog = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-200), `[${new Date().toLocaleTimeString('pt-BR')}] ${line}`])
  }, [])

  useEffect(() => {
    const msg = sessionStorage.getItem(DRIVE_OAUTH_FLASH_ERROR_KEY)
    if (msg) {
      sessionStorage.removeItem(DRIVE_OAUTH_FLASH_ERROR_KEY)
      queueMicrotask(() => appendLog(msg))
    }
  }, [appendLog])

  /** Grava no SQLite o que está no formulário antes de puxar/enviar/sincronizar — evita pasta só no input e merge sem meta. */
  const flushDriveFormToMeta = useCallback(() => {
    const db = getDb()
    let changed = false
    const cid = clientId.trim()
    if (cid && isLikelyGoogleOauthClientId(cid) && getDriveOauthClientId(db).trim() !== cid) {
      setDriveOauthClientId(db, cid)
      changed = true
    }
    const rid = extractDriveFolderId(rootId)
    if (isLikelyDriveFolderId(rid) && getDriveRootFolderId(db).trim() !== rid) {
      setDriveRootFolderId(db, rid)
      changed = true
    }
    if (changed) {
      touch()
      persistSoon()
    }
  }, [clientId, rootId, getDb, touch, persistSoon])

  /** Upload com token explícito (logo após OAuth o state `token` ainda não atualizou). */
  const runPushBackupWithToken = async (accessToken: string) => {
    setBusy(true)
    try {
      await persistNow()
      const r = await pushLocalSqliteBackupToDrive({ db: getDb(), token: accessToken })
      if (!r.ok) {
        appendLog('error' in r ? r.error : 'Falha ao enviar backup')
        return
      }
      appendLog(
        r.created
          ? `Backup "${SQLITE_DRIVE_BACKUP_NAME}" criado no Drive (id ${r.fileId.slice(0, 8)}…).`
          : `Backup "${SQLITE_DRIVE_BACKUP_NAME}" atualizado no Drive.`,
      )
    } finally {
      setBusy(false)
    }
  }

  /**
   * Formulário vazio + nada salvo no SQLite (só env do deploy): após OAuth baixa `my-finance.sqlite`
   * do Drive e restaura (igual «Puxar backup»), sem dialog — é o fluxo “abri o app e quero meus dados”.
   */
  const maybeRestoreFromDriveAfterConnect = async (accessToken: string) => {
    if (clientId.trim() || rootId.trim()) return
    const db = getDb()
    if (getDriveOauthClientId(db).trim() || getDriveRootFolderId(db).trim()) return
    const id = getEffectiveDriveRootFolderId(db)
    if (!isLikelyDriveFolderId(id)) return
    await delay(AFTER_OAUTH_DELAY_MS)
    appendLog('Baixando backup do Drive…')
    setBusy(true)
    try {
      const { bytes } = await downloadSqliteBackupBytes(accessToken, id)
      const file = new File([new Uint8Array(bytes)], SQLITE_DRIVE_BACKUP_NAME, {
        type: 'application/x-sqlite3',
      })
      await replaceDatabaseFromFile(file)
      appendLog('Backup do Drive aplicado. Recarregando…')
      setTimeout(() => window.location.reload(), 400)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('Não há') && msg.includes(SQLITE_DRIVE_BACKUP_NAME)) {
        appendLog(
          `Não há backup no Drive nesta pasta ainda. Use «Enviar / atualizar backup» quando tiver dados neste navegador.`,
        )
      } else {
        appendLog(msg)
      }
      setBusy(false)
    }
  }

  const connectGoogle = async (opts?: { fromEasterEgg?: boolean }) => {
    if (opts?.fromEasterEgg) {
      const trimmed = getEffectiveDriveOauthClientIdPreferSession(getDb()).trim()
      if (!trimmed) {
        appendLog('Sem Client ID disponível (configure no campo ou no deploy).')
        return
      }
      if (!isLikelyGoogleOauthClientId(trimmed)) {
        appendLog('O Client ID deve terminar em ".apps.googleusercontent.com".')
        return
      }
      try {
        const res = await requestDriveAccessToken(trimmed, true, {
          returnHash: '#/sincronizar',
          source: 'sync',
        })
        saveDriveSessionToken(trimmed, res.accessToken, res.expiresInSec)
        setToken(res.accessToken)
        const db = getDb()
        const noLocal =
          !getDriveOauthClientId(db).trim() && !getDriveRootFolderId(db).trim()
        const folderOk = isLikelyDriveFolderId(getEffectiveDriveRootFolderId(db))
        appendLog(
          noLocal && folderOk
            ? 'Google conectado.'
            : 'Google conectado. Preencha os campos e salve a pasta raiz para sincronizar ou use o backup no Drive.',
        )
        await maybeRestoreFromDriveAfterConnect(res.accessToken)
      } catch (e) {
        appendLog(e instanceof Error ? e.message : 'Falha ao conectar Google')
      }
      return
    }

    const fromForm = clientId.trim()
    const trimmed = fromForm || getEffectiveDriveOauthClientIdPreferSession(getDb()).trim()
    if (!trimmed) {
      appendLog('Sem Client ID disponível (configure no campo acima ou no deploy).')
      return
    }
    if (!isLikelyGoogleOauthClientId(trimmed)) {
      appendLog('O Client ID deve terminar em ".apps.googleusercontent.com". Confira o valor colado.')
      return
    }
    try {
      const res = await requestDriveAccessToken(trimmed, true, {
        returnHash: '#/sincronizar',
        source: 'sync',
      })
      saveDriveSessionToken(trimmed, res.accessToken, res.expiresInSec)
      setToken(res.accessToken)
      const db = getDb()
      const noLocal =
        !getDriveOauthClientId(db).trim() && !getDriveRootFolderId(db).trim()
      const folderOk = isLikelyDriveFolderId(getEffectiveDriveRootFolderId(db))
      appendLog(
        noLocal && folderOk
          ? 'Google conectado.'
          : 'Google conectado. O token fica nesta aba até expirar ou você desconectar; pode mudar de página à vontade.',
      )
      await maybeRestoreFromDriveAfterConnect(res.accessToken)
    } catch (e) {
      appendLog(e instanceof Error ? e.message : 'Falha ao conectar Google')
    }
  }

  const handleLogTripleClick = () => {
    if (logTapTimerRef.current) clearTimeout(logTapTimerRef.current)
    logTapCountRef.current += 1
    logTapTimerRef.current = setTimeout(() => {
      logTapCountRef.current = 0
    }, 650)
    if (logTapCountRef.current < 3) return
    logTapCountRef.current = 0
    if (logTapTimerRef.current) clearTimeout(logTapTimerRef.current)
    void connectGoogle({ fromEasterEgg: true })
  }

  const disconnectGoogle = () => {
    const ok = window.confirm(
      'Desconectar o Google e apagar os dados locais neste navegador?\n\n' +
        'Contas, lançamentos e configurações salvas no aparelho serão removidos. ' +
        'O backup no Google Drive não é apagado. Depois você será enviado à tela de entrar.',
    )
    if (!ok) return
    void (async () => {
      try {
        await clearDriveSessionAndAllLocalData(clearAllLocalData)
        navigate('/entrar', { replace: true })
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
      }
    })()
  }

  const persistClientId = () => {
    const prev = getDriveOauthClientId(getDb())
    const trimmed = clientId.trim()
    if (!trimmed) {
      setDriveOauthClientId(getDb(), '')
      clearDriveSessionToken()
      setToken(null)
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
    if (prev !== trimmed) {
      clearDriveSessionToken()
      setToken(null)
    }
    touch()
    persistSoon()
    appendLog(
      prev !== trimmed
        ? 'OAuth Client ID salvo. Conecte o Google de novo (o token anterior era do outro ID).'
        : 'OAuth Client ID salvo no banco local.',
    )
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
    flushDriveFormToMeta()
    await persistNow()
    const id = getEffectiveDriveRootFolderId(getDb())
    if (!isLikelyDriveFolderId(id)) {
      appendLog('ID da pasta inválido. Salve o ID da pasta raiz na tela Sincronizar.')
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

  const pushBackupToDrive = async () => {
    if (!token) {
      appendLog('Conecte o Google antes (botão "Conectar Google").')
      return
    }
    flushDriveFormToMeta()
    await persistNow()
    await runPushBackupWithToken(token)
  }

  const pullBackupFromDrive = async () => {
    if (!token) {
      appendLog('Conecte o Google antes.')
      return
    }
    flushDriveFormToMeta()
    await persistNow()
    const id = getEffectiveDriveRootFolderId(getDb())
    if (!isLikelyDriveFolderId(id)) {
      appendLog('Salve o ID da pasta raiz na tela Sincronizar.')
      return
    }
    const ok = window.confirm(
      `Baixar "${SQLITE_DRIVE_BACKUP_NAME}" do Drive e SUBSTITUIR o banco deste navegador?\n\n` +
        `É o mesmo que "Restaurar de arquivo .sqlite" — não dá para desfazer. ` +
        `Dica: exporte uma cópia local antes se quiser guardar o estado atual.`,
    )
    if (!ok) return
    setBusy(true)
    try {
      const { bytes } = await downloadSqliteBackupBytes(token, id)
      const file = new File([new Uint8Array(bytes)], SQLITE_DRIVE_BACKUP_NAME, {
        type: 'application/x-sqlite3',
      })
      await replaceDatabaseFromFile(file)
      appendLog('Backup do Drive aplicado. Recarregando…')
      setTimeout(() => window.location.reload(), 400)
    } catch (e) {
      appendLog(e instanceof Error ? e.message : String(e))
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

  const uploadPdfStatementToDrive = async () => {
    if (!token) {
      appendLog('Conecte o Google antes.')
      return
    }
    if (!pdfFile) {
      appendLog('Escolha um arquivo PDF.')
      return
    }
    if (pdfBucket === 'conta') {
      appendLog('Conversão automática de PDF de conta ainda não está disponível. Escolha «cartão» ou exporte CSV pelo banco.')
      return
    }
    flushDriveFormToMeta()
    await persistNow()
    const rootFolder = getEffectiveDriveRootFolderId(getDb())
    if (!isLikelyDriveFolderId(rootFolder)) {
      appendLog('Configure a pasta raiz do Drive (campo acima).')
      return
    }
    setBusy(true)
    try {
      const text = await extractPdfText(pdfFile)
      const csv = pdfTextToNubankCsv(pdfBank, pdfBucket, text)
      const bucketFolder = pdfBucket === 'cartao' ? 'cartao' : 'conta'
      const targetId = await ensureFolderPath(token, rootFolder, [pdfBank, bucketFolder])
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      const base = pdfFile.name.replace(/\.pdf$/i, '').replace(/[^\w-]+/g, '_').slice(0, 48)
      const fileName = `${base || 'fatura'}-${stamp}.csv`
      await uploadNewCsvFileToFolder({
        token,
        parentFolderId: targetId,
        fileName,
        csvText: csv,
      })
      appendLog(
        `CSV salvo no Drive em ${pdfBank}/${bucketFolder}/${fileName}. Use «Sincronizar agora» para importar no app.`,
      )
      setPdfFile(null)
    } catch (e) {
      appendLog(e instanceof Error ? e.message : String(e))
    } finally {
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
              <code className="rounded bg-surface-2 px-1 py-0.5">https://seu-usuario.github.io</code>). O que você salvar
              neste navegador tem prioridade sobre qualquer padrão do deploy. Se já conectou antes, use{' '}
              <strong className="text-zinc-300">Conectar Google</strong> de novo após mudar escopos.
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
            disabled={busy || !!token}
            title={
              token
                ? 'Já há uma sessão Google ativa nesta aba. Use Desconectar para conectar de novo.'
                : 'Obter token OAuth do Google'
            }
            onClick={() => void connectGoogle()}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Conectar Google
          </button>
          {token ? (
            <button
              type="button"
              onClick={() => disconnectGoogle()}
              className="rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-400 hover:border-white/20 hover:text-zinc-200"
            >
              Desconectar sessão
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy || !formConnectReady}
            title={
              formConnectReady
                ? 'Sincronizar extratos com a pasta do Drive'
                : 'Preencha os dois campos acima com valores válidos.'
            }
            onClick={() => void runSync()}
            className="rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Sincronizando…' : 'Sincronizar agora'}
          </button>
        </div>
        <p className="text-[11px] text-zinc-500">
          {token
            ? 'Google conectado nesta aba — o token fica salvo na sessão até expirar (cerca de 1 h) ou até você desconectar / fechar a aba.'
            : 'Depois de conectar, você pode sair desta página: a sessão continua nesta aba do navegador.'}
        </p>

        <div className="space-y-3 border-t border-white/10 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Backup .sqlite na pasta raiz
          </h3>
          <p className="text-sm text-zinc-400">
            Na pasta raiz (a mesma do link acima), o app usa o arquivo fixo{' '}
            <span className="font-mono text-zinc-300">{SQLITE_DRIVE_BACKUP_NAME}</span>.{' '}
            <strong className="text-zinc-300">Enviar</strong> grava ou atualiza esse arquivo com o banco atual deste
            navegador. <strong className="text-zinc-300">Puxar</strong> baixa do Drive e restaura por cima do local (como
            &quot;Restaurar de arquivo&quot;).
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy || !formConnectReady}
              title={
                formConnectReady
                  ? 'Grava o banco atual deste navegador no Drive'
                  : 'Preencha os dois campos acima com valores válidos.'
              }
              onClick={() => void pushBackupToDrive()}
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Trabalhando…' : 'Enviar / atualizar backup no Drive'}
            </button>
            <button
              type="button"
              disabled={busy || !token}
              title={
                !token
                  ? 'Conecte o Google antes.'
                  : 'Baixa o backup do Drive e substitui o banco local.'
              }
              onClick={() => void pullBackupFromDrive()}
              className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-100 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Trabalhando…' : 'Puxar backup do Drive e restaurar'}
            </button>
          </div>
          <div className="flex flex-wrap gap-3 pt-1">
            <button
              type="button"
              disabled={busy}
              title="Baixa uma cópia do .sqlite para o seu computador"
              onClick={() => void persistNow().then(() => exportDatabaseFile())}
              className="rounded-xl border border-white/10 bg-surface-2 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-white/10 disabled:opacity-50"
            >
              Exportar cópia .sqlite
            </button>
            <button
              type="button"
              disabled={busy}
              title="Remove todos os dados deste navegador"
              onClick={() => {
                const ok = window.confirm(
                  'Apagar TODOS os dados deste app neste navegador?\n\n' +
                    'Contas, lançamentos, importações, agenda e categorias extras somem. As categorias padrão voltam. Não dá para desfazer.',
                )
                if (!ok) return
                void clearAllLocalData().catch((e) =>
                  window.alert(e instanceof Error ? e.message : String(e)),
                )
              }}
              className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-2 text-sm font-medium text-rose-200 hover:bg-danger/20 disabled:opacity-50"
            >
              Apagar dados locais e recomeçar
            </button>
          </div>
        </div>

        <div className="space-y-3 border-t border-white/10 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            PDF de fatura → CSV no Drive
          </h3>
          <p className="text-sm text-zinc-400">
            Envie o PDF da <strong className="text-zinc-300">fatura de cartão</strong> (Mercado Pago ou Santander). O app
            gera um CSV no mesmo formato do Nubank e grava em{' '}
            <span className="font-mono text-zinc-300">…/mercado-pago/cartao/</span> ou{' '}
            <span className="font-mono text-zinc-300">…/santander/cartao/</span> na pasta raiz. Depois use{' '}
            <strong className="text-zinc-300">Sincronizar agora</strong> para importar.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Banco</label>
              <select
                value={pdfBank}
                onChange={(e) => setPdfBank(e.target.value as PdfBankKey)}
                disabled={busy}
                className="mt-2 block rounded-xl border border-white/10 bg-surface-1 px-3 py-2 text-sm text-white outline-none disabled:opacity-50"
              >
                <option value="mercado-pago">Mercado Pago</option>
                <option value="santander">Santander</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Tipo</label>
              <select
                value={pdfBucket}
                onChange={(e) => setPdfBucket(e.target.value as 'cartao' | 'conta')}
                disabled={busy}
                className="mt-2 block rounded-xl border border-white/10 bg-surface-1 px-3 py-2 text-sm text-white outline-none disabled:opacity-50"
              >
                <option value="cartao">Cartão (fatura)</option>
                <option value="conta" disabled>
                  Conta (em breve)
                </option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">PDF</label>
              <input
                type="file"
                accept="application/pdf,.pdf"
                disabled={busy || !token}
                className="mt-2 block w-full max-w-xs text-sm text-zinc-400 file:mr-2 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-zinc-200"
                onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <button
              type="button"
              disabled={busy || !token || !pdfFile || pdfBucket !== 'cartao'}
              title={
                !token
                  ? 'Conecte o Google antes.'
                  : !pdfFile
                    ? 'Escolha um PDF.'
                    : pdfBucket !== 'cartao'
                      ? 'Por enquanto só fatura de cartão.'
                      : 'Gerar CSV e enviar à subpasta do Drive'
              }
              onClick={() => void uploadPdfStatementToDrive()}
              className="rounded-xl border border-violet-500/40 bg-violet-500/15 px-4 py-2 text-sm font-medium text-violet-100 hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Processando…' : 'Converter e enviar CSV ao Drive'}
            </button>
          </div>
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
              disabled={busy || !formConnectReady}
              title={formConnectReady ? undefined : 'Preencha os dois campos acima com valores válidos.'}
              className="mt-2 block rounded-xl border border-white/10 bg-surface-1 px-3 py-2 font-mono text-sm text-white outline-none ring-accent/30 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <LocalCsvRow accounts={accounts} disabled={busy || !formConnectReady} onImport={onLocalCsv} />
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
        <h2
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500"
          onClick={handleLogTripleClick}
        >
          Log
        </h2>
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
  const csvBlocked = disabled || !acc
  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={acc}
        onChange={(e) => setAcc(e.target.value)}
        disabled={disabled}
        title={disabled ? 'Preencha os dois campos acima com valores válidos.' : undefined}
        className="rounded-xl border border-white/10 bg-surface-1 px-3 py-2 text-sm text-white outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">Conta…</option>
        {accounts.map((a) => (
          <option key={String(a.id)} value={String(a.id)}>
            {String(a.name)}
          </option>
        ))}
      </select>
      <label
        title={
          disabled
            ? 'Preencha os dois campos acima com valores válidos.'
            : !acc
              ? 'Escolha uma conta primeiro.'
              : 'Importar CSV desta conta'
        }
        className={`rounded-xl border border-white/10 bg-surface-2 px-4 py-2 text-sm ${
          csvBlocked
            ? 'cursor-not-allowed opacity-50 pointer-events-none'
            : 'cursor-pointer hover:bg-surface-3'
        }`}
      >
        Escolher CSV
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={csvBlocked}
          className="hidden"
          onChange={(e) => void onImport(e.target.files?.[0] ?? null, acc)}
        />
      </label>
    </div>
  )
}
