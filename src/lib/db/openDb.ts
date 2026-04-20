import initSqlJs, { type Database } from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { normalizeInstitutionKey } from '../drive/driveApi'
import { MIGRATION_SQL } from './schema'
import { seedIfEmpty } from './seed'
import { migrateInvestments } from './migrations/investments'
import { migrateLegacySettings } from '../settings/appSettings'

function migrateAccountsInvoiceCloseDay(db: Database): void {
  try {
    db.run('ALTER TABLE accounts ADD COLUMN invoice_close_day INTEGER')
  } catch {
    /* coluna já existe */
  }
}

function migrateBillingRefColumns(db: Database): void {
  try {
    db.run('ALTER TABLE transactions ADD COLUMN billing_ref_ym TEXT')
  } catch {
    /* já existe */
  }
  try {
    db.run('ALTER TABLE import_batches ADD COLUMN billing_month TEXT')
  } catch {
    /* já existe */
  }
}

/** Alinha chaves ao mesmo normalizador do Drive (espaços, maiúsculas, acentos). */
function migrateNormalizeAccountInstitutionKeys(db: Database): void {
  const stmt = db.prepare(
    `SELECT id, institution_key FROM accounts WHERE institution_key IS NOT NULL AND TRIM(institution_key) != ''`,
  )
  const rows: { id: string; institution_key: string }[] = []
  while (stmt.step()) {
    const o = stmt.getAsObject() as Record<string, string | number | null | undefined>
    rows.push({ id: String(o.id ?? ''), institution_key: String(o.institution_key ?? '') })
  }
  stmt.free()
  for (const r of rows) {
    const nk = normalizeInstitutionKey(r.institution_key)
    if (nk && nk !== r.institution_key) {
      db.run('UPDATE accounts SET institution_key = ? WHERE id = ?', [nk, r.id])
    }
  }
}

/**
 * Typo comum: "marcado-pago" em vez de "mercado-pago" (Drive e sync usam o segundo).
 * Corrige contas e lotes de import após normalização.
 */
function migrateTypoMarcadoToMercadoPago(db: Database): void {
  const fixed = 'mercado-pago'
  const typoNorm = 'marcado-pago'

  const patchTable = (table: 'accounts' | 'import_batches') => {
    const stmt = db.prepare(
      `SELECT id, institution_key FROM ${table} WHERE institution_key IS NOT NULL AND TRIM(institution_key) != ''`,
    )
    const ids: string[] = []
    while (stmt.step()) {
      const o = stmt.getAsObject() as Record<string, string | number | null | undefined>
      const id = String(o.id ?? '')
      const key = String(o.institution_key ?? '')
      if (normalizeInstitutionKey(key) === typoNorm) ids.push(id)
    }
    stmt.free()
    for (const id of ids) {
      db.run(`UPDATE ${table} SET institution_key = ? WHERE id = ?`, [fixed, id])
    }
  }

  patchTable('accounts')
  patchTable('import_batches')
}

export async function createFinanceDatabase(buffer?: ArrayBuffer): Promise<Database> {
  const SQL = await initSqlJs({
    locateFile: (file: string) => (file.endsWith('.wasm') ? sqlWasmUrl : file),
  })
  const db = buffer ? new SQL.Database(new Uint8Array(buffer)) : new SQL.Database()
  db.exec(MIGRATION_SQL)
  migrateAccountsInvoiceCloseDay(db)
  migrateBillingRefColumns(db)
  migrateInvestments(db)
  seedIfEmpty(db)
  migrateLegacySettings(db)
  migrateNormalizeAccountInstitutionKeys(db)
  migrateTypoMarcadoToMercadoPago(db)
  return db
}
