import initSqlJs, { type Database } from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
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
  return db
}
