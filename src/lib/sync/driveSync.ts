import type { Database } from 'sql.js'
import type { Row } from '../db/query'
import { accountMatchesBucket, parseBucketFolderName, type AccountBucket } from '../drive/folderBuckets'
import { downloadFileText, listFolderChildren, normalizeInstitutionKey } from '../drive/driveApi'
import { applyCsvImport } from '../import/applyCsv'
import { isProbablyCsv, parseBankCsv } from '../import/csv'
import { queryAll } from '../db/query'

function institutionMatch(accountKey: string | null | undefined, folderName: string): boolean {
  if (!accountKey) return false
  return normalizeInstitutionKey(accountKey) === normalizeInstitutionKey(folderName)
}

async function importCsvList(params: {
  db: Database
  token: string
  csvFiles: { id: string; name: string; mimeType: string }[]
  accountId: string
  institutionKey: string
  treatPositiveAsExpense: boolean
  billingRefYm: string | null
  onLog: (line: string) => void
  pathLabel: string
}): Promise<void> {
  const { db, token, csvFiles, accountId, institutionKey, treatPositiveAsExpense, billingRefYm, onLog, pathLabel } = params

  for (const file of csvFiles) {
    try {
      const text = await downloadFileText(token, file.id)
      const rows = parseBankCsv(text, { treatPositiveAsExpense })
      if (rows.length === 0) {
        onLog(`${pathLabel} "${file.name}": CSV sem linhas reconhecidas (cabeçalhos data/valor).`)
        continue
      }
      const res = await applyCsvImport({
        db,
        accountId,
        institutionKey,
        externalRef: file.id,
        fileName: file.name,
        rows,
        billingRefYm,
      })
      if (res.skippedFile) {
        onLog(`${pathLabel} "${file.name}": já importado antes (ignorado).`)
      } else {
        onLog(`${pathLabel} "${file.name}": ${res.inserted} lançamentos novos (${rows.length} linhas lidas).`)
      }
    } catch (e) {
      onLog(`${pathLabel} "${file.name}": erro — ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

function findAccountForBucket(
  accounts: Row[],
  institutionKey: string,
  bucket: AccountBucket,
): Row | undefined {
  const matches = accounts.filter((a) =>
    accountMatchesBucket(institutionKey, String(a.institution_key ?? ''), String(a.kind), bucket),
  )
  if (matches.length === 0) return undefined
  if (bucket === 'checking') {
    const checking = matches.find((a) => String(a.kind) === 'checking')
    if (checking) return checking
  }
  return matches[0]
}

export async function syncDriveToDatabase(params: {
  db: Database
  token: string
  rootFolderId: string
  onLog: (line: string) => void
  /** Se false, não grava mês de referência (usa só a data de cada linha). */
  assignBillingMonths: boolean
  billingRefYmCredit: string | null
  billingRefYmChecking: string | null
}): Promise<void> {
  const { db, token, rootFolderId, onLog, assignBillingMonths, billingRefYmCredit, billingRefYmChecking } = params

  const accounts = queryAll(
    db,
    `SELECT id, name, institution_key, kind FROM accounts WHERE deleted_at IS NULL`,
  )

  const folders = await listFolderChildren(token, rootFolderId, {
    mimeType: 'application/vnd.google-apps.folder',
  })

  if (folders.length === 0) {
    onLog('Nenhuma subpasta na raiz. Crie pastas por banco (ex.: nubank) dentro da pasta Financeiro.')
    return
  }

  for (const folder of folders) {
    const institutionKey = normalizeInstitutionKey(folder.name)
    const matchingByInst = accounts.filter((a) => institutionMatch(String(a.institution_key ?? ''), folder.name))
    if (matchingByInst.length === 0) {
      onLog(`Pasta "${folder.name}" ignorada: nenhuma conta com chave "${institutionKey}".`)
      continue
    }

    const children = await listFolderChildren(token, folder.id)
    const childFolders = children.filter((f) => f.mimeType === 'application/vnd.google-apps.folder')
    const rootCsvFiles = children.filter(
      (f) => f.mimeType !== 'application/vnd.google-apps.folder' && isProbablyCsv(f.name, f.mimeType),
    )

    let usedBucketLayout = false

    for (const sub of childFolders) {
      const bucket = parseBucketFolderName(sub.name)
      if (!bucket) {
        onLog(`"${folder.name}/${sub.name}": subpasta ignorada (use "cartao" ou "conta").`)
        continue
      }

      const account = findAccountForBucket(accounts, institutionKey, bucket)
      if (!account) {
        const need =
          bucket === 'credit'
            ? `uma conta tipo "Cartão de crédito" com chave "${institutionKey}"`
            : `uma conta tipo corrente/carteira (não crédito) com chave "${institutionKey}"`
        onLog(`"${folder.name}/${sub.name}": falta ${need}.`)
        continue
      }

      const subFiles = await listFolderChildren(token, sub.id)
      const csvFiles = subFiles.filter(
        (f) => f.mimeType !== 'application/vnd.google-apps.folder' && isProbablyCsv(f.name, f.mimeType),
      )

      if (csvFiles.length === 0) {
        onLog(`"${folder.name}/${sub.name}": sem CSV (coloque os extratos aqui).`)
        continue
      }

      usedBucketLayout = true
      const treatPositiveAsExpense = String(account.kind) === 'credit'
      const billingRefYm =
        assignBillingMonths && bucket === 'credit' ? billingRefYmCredit : assignBillingMonths ? billingRefYmChecking : null
      await importCsvList({
        db,
        token,
        csvFiles,
        accountId: String(account.id),
        institutionKey,
        treatPositiveAsExpense,
        billingRefYm,
        onLog,
        pathLabel: `"${folder.name}/${sub.name}"`,
      })
    }

    if (rootCsvFiles.length > 0) {
      if (usedBucketLayout) {
        onLog(
          `"${folder.name}": há CSV na raiz da pasta do banco — ignorados enquanto existir layout cartao/conta (mova para a subpasta certa).`,
        )
      } else {
        const creditAcc = findAccountForBucket(accounts, institutionKey, 'credit')
        const checkAcc = findAccountForBucket(accounts, institutionKey, 'checking')
        const ambiguous = creditAcc && checkAcc
        if (ambiguous) {
          onLog(
            `"${folder.name}": CSV na raiz, mas há conta cartão e conta corrente com a mesma chave — crie pastas "cartao" e "conta" e mova os arquivos.`,
          )
          continue
        }
        const only = creditAcc ?? checkAcc
        if (!only) continue
        const treatPositiveAsExpense = String(only.kind) === 'credit'
        const billingRefYmFlat =
          assignBillingMonths && treatPositiveAsExpense ? billingRefYmCredit : assignBillingMonths ? billingRefYmChecking : null
        await importCsvList({
          db,
          token,
          csvFiles: rootCsvFiles,
          accountId: String(only.id),
          institutionKey,
          treatPositiveAsExpense,
          billingRefYm: billingRefYmFlat,
          onLog,
          pathLabel: `"${folder.name}"`,
        })
      }
    } else if (!usedBucketLayout && childFolders.length > 0) {
      onLog(
        `"${folder.name}": nenhum CSV em subpastas reconhecidas (cartao/conta). Renomeie ou crie essas duas pastas.`,
      )
    } else if (!usedBucketLayout && childFolders.length === 0) {
      onLog(`"${folder.name}": pasta vazia ou sem subpastas cartao/conta e sem CSV na raiz.`)
    }
  }
}
