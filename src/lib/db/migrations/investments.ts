import type { Database } from 'sql.js'

/**
 * Atualiza bancos antigos (pré-investimentos) pra nova estrutura. Tudo
 * idempotente e defensivo: pode rodar em toda abertura, inclusive quando o
 * banco ficou com lixo de uma tentativa anterior que morreu no meio.
 *
 * Ordem importa:
 *   1. Dropa a view `v_tx_plus_future` — ela depende de `categories` e
 *      `transactions`. Se ficar referenciando tabelas antigas durante o
 *      rename abaixo, consultas dela explodem. Recriamos só no fim.
 *   2. Limpa lixo de migrações anteriores (`categories_new` órfã).
 *   3. Garante que `categories` existe com o CHECK ampliado.
 *   4. Adiciona `investment_id` em `transactions` e `scheduled_payments`.
 *   5. Cria índices e reconstrói a view.
 */
export function migrateInvestments(db: Database): void {
  db.exec('DROP VIEW IF EXISTS v_tx_plus_future;')
  dropOrphanCategoriesNew(db)
  relaxCategoriesKindCheck(db)
  ensureCategoriesExists(db)

  try {
    db.run('ALTER TABLE transactions ADD COLUMN investment_id TEXT REFERENCES investments(id)')
  } catch {
    /* coluna já existe */
  }
  try {
    db.run('ALTER TABLE scheduled_payments ADD COLUMN investment_id TEXT REFERENCES investments(id)')
  } catch {
    /* coluna já existe */
  }

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_transactions_investment ON transactions(investment_id);
     CREATE INDEX IF NOT EXISTS idx_scheduled_investment ON scheduled_payments(investment_id);`,
  )
  rebuildTxPlusFutureView(db)
}

/**
 * Remove `categories_new` se tiver sobrado de uma tentativa abortada. Se
 * `categories` não existe mas `categories_new` sim, promovemos a órfã.
 */
function dropOrphanCategoriesNew(db: Database): void {
  const hasNew = tableExists(db, 'categories_new')
  if (!hasNew) return
  const hasCategories = tableExists(db, 'categories')
  if (!hasCategories) {
    db.exec('ALTER TABLE categories_new RENAME TO categories;')
    return
  }
  // `categories` existe e `categories_new` também → `categories_new` é lixo.
  db.exec('DROP TABLE categories_new;')
}

function relaxCategoriesKindCheck(db: Database): void {
  if (!tableExists(db, 'categories')) return
  const row = db.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='categories'`)
  const sql = row[0]?.values?.[0]?.[0]
  if (typeof sql !== 'string') return
  if (sql.includes('investment_in')) return

  db.exec('PRAGMA foreign_keys = OFF;')
  try {
    db.exec(`
      CREATE TABLE categories_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('expense','income','transfer','investment_in','investment_out')),
        created_at TEXT NOT NULL
      );
      INSERT INTO categories_new (id, name, kind, created_at)
        SELECT id, name, kind, created_at FROM categories;
      DROP TABLE categories;
      ALTER TABLE categories_new RENAME TO categories;
    `)
  } finally {
    db.exec('PRAGMA foreign_keys = ON;')
  }
}

/**
 * Última rede de segurança: se depois de tudo `categories` ainda não existir
 * (aconteceu antes de a gente blindar), recria vazia com o schema novo. O
 * seed depois popula as categorias padrão; as categorias que o usuário tinha
 * criado de fato se perderam nessa situação, mas é melhor que a app travada.
 */
function ensureCategoriesExists(db: Database): void {
  if (tableExists(db, 'categories')) return
  db.exec(`
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('expense','income','transfer','investment_in','investment_out')),
      created_at TEXT NOT NULL
    );
  `)
}

function tableExists(db: Database, name: string): boolean {
  const stmt = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`)
  stmt.bind([name])
  const exists = stmt.step()
  stmt.free()
  return exists
}

function rebuildTxPlusFutureView(db: Database): void {
  db.exec(`
    DROP VIEW IF EXISTS v_tx_plus_future;
    CREATE VIEW v_tx_plus_future AS
    SELECT
      id, account_id, category_id, investment_id, amount_cents, occurred_at, billing_ref_ym,
      description, source, fingerprint, import_batch_id, created_at
    FROM transactions
    UNION ALL
    SELECT
      ('sch_' || s.id) AS id,
      s.account_id,
      s.category_id,
      s.investment_id,
      CASE
        WHEN c.kind IN ('income', 'investment_out') THEN ABS(s.amount_cents)
        ELSE -ABS(s.amount_cents)
      END AS amount_cents,
      s.due_date AS occurred_at,
      NULL AS billing_ref_ym,
      ('Futuro: ' || s.title) AS description,
      'scheduled' AS source,
      ('sch_' || s.id) AS fingerprint,
      NULL AS import_batch_id,
      s.created_at
    FROM scheduled_payments s
    LEFT JOIN categories c ON c.id = s.category_id
    WHERE s.account_id IS NOT NULL;
  `)
}
