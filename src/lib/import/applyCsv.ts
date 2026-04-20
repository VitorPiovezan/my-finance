import type { Database } from 'sql.js'
import { queryAll, queryOne, run } from '../db/query'
import { newId } from '../id'
import { sha256Hex } from '../hash'
import type { CsvImportRow } from './csv'
import { parseBillingRefYm } from './billingMonth'

/**
 * Normaliza a descrição para cálculo determinístico de duplicatas. Tira acentos,
 * padroniza caixa, colapsa espaços — nada de remover prefixos porque isso poderia
 * fundir transações diferentes em um mesmo "fingerprint".
 */
function normalizeForFingerprint(s: string): string {
  if (!s) return ''
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

async function computeFingerprint(
  accountId: string,
  occurredOn: string,
  amountCents: number,
  description: string,
): Promise<string> {
  const key = `${accountId}|${occurredOn}|${amountCents}|${normalizeForFingerprint(description)}`
  return sha256Hex(key)
}

/**
 * Decide se uma linha recém-lida já existe no banco olhando por CONTEÚDO (conta + data
 * + valor + descrição normalizada), e não pelo fingerprint armazenado. Esse approach
 * tem duas vantagens importantes:
 *
 * 1. Funciona retroativamente — mesmo para transações gravadas antes dessa mudança,
 *    que tinham fingerprint baseado no nome do arquivo.
 * 2. Se o banco atualizar o extrato no fim do mês (mesmo mês, mas agora com mais
 *    linhas), as linhas antigas são reconhecidas e só as novas entram.
 *
 * Caveat conhecido: duas transações idênticas no mesmo dia (ex.: dois cafés de R$ 10
 * no mesmo lugar) acabariam reconhecidas como uma só. Opção (a) do fix. Caso apareça,
 * a segunda pode ser adicionada manualmente em Lançamentos.
 */
function existsByContent(
  db: Database,
  accountId: string,
  occurredOn: string,
  amountCents: number,
  normalizedDescription: string,
): boolean {
  const rows = queryAll(
    db,
    `SELECT description FROM transactions
     WHERE account_id = ? AND occurred_at = ? AND amount_cents = ?`,
    [accountId, occurredOn, amountCents],
  )
  for (const r of rows) {
    if (normalizeForFingerprint(String(r.description ?? '')) === normalizedDescription) {
      return true
    }
  }
  return false
}

export async function applyCsvImport(params: {
  db: Database
  accountId: string
  institutionKey: string
  externalRef: string
  fileName: string
  rows: CsvImportRow[]
  /** Mês `YYYY-MM` deste extrato (totais e filtros); null = usar só a data de cada linha. */
  billingRefYm?: string | null
}): Promise<{ inserted: number; skipped: number; skippedFile: boolean }> {
  const { db, accountId, institutionKey, externalRef, fileName, rows } = params
  const billingRefYm = parseBillingRefYm(params.billingRefYm ?? null)

  // Reupload do MESMO arquivo (nome + tamanho + lastModified): descarta tudo.
  const dupBatch = queryOne(db, 'SELECT id FROM import_batches WHERE external_ref = ?', [externalRef])
  if (dupBatch) {
    return { inserted: 0, skipped: 0, skippedFile: true }
  }

  const batchId = newId()
  const now = new Date().toISOString()
  run(db, 'INSERT INTO import_batches (id, external_ref, file_name, institution_key, row_count, billing_month, imported_at) VALUES (?,?,?,?,?,?,?)', [
    batchId,
    externalRef,
    fileName,
    institutionKey,
    rows.length,
    billingRefYm,
    now,
  ])

  let inserted = 0
  let skipped = 0
  for (const row of rows) {
    const normDesc = normalizeForFingerprint(row.description)

    // Dedupe pelo conteúdo — funciona entre arquivos diferentes que descrevem a mesma
    // transação (ex.: extrato parcial no meio do mês vs extrato completo no fim).
    if (existsByContent(db, accountId, row.occurredOn, row.amountCents, normDesc)) {
      skipped += 1
      continue
    }

    const fingerprint = await computeFingerprint(accountId, row.occurredOn, row.amountCents, row.description)
    const tid = newId()
    run(
      db,
      'INSERT INTO transactions (id, account_id, category_id, amount_cents, occurred_at, billing_ref_ym, description, source, fingerprint, import_batch_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [tid, accountId, null, row.amountCents, row.occurredOn, billingRefYm, row.description, 'import', fingerprint, batchId, now],
    )
    inserted++
  }

  return { inserted, skipped, skippedFile: false }
}
