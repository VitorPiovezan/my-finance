export const MIGRATION_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  institution_key TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('checking','credit','wallet','other')),
  color TEXT,
  invoice_close_day INTEGER,
  real_balance_offset_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('expense','income','transfer','investment_in','investment_out')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  external_ref TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  institution_key TEXT,
  row_count INTEGER NOT NULL,
  billing_month TEXT,
  imported_at TEXT NOT NULL
);

-- Investimentos (CDB, tesouro, ações, reserva) rastreados nominalmente.
-- initial_balance_cents é o saldo que já existia antes de o app começar a
-- acompanhar, lançado como "linha zero" na timeline do investimento.
CREATE TABLE IF NOT EXISTS investments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  institution TEXT,
  color TEXT,
  initial_balance_cents INTEGER NOT NULL DEFAULT 0,
  initial_date TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  category_id TEXT REFERENCES categories(id),
  investment_id TEXT REFERENCES investments(id),
  amount_cents INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  billing_ref_ym TEXT,
  description TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('manual','import')),
  fingerprint TEXT NOT NULL UNIQUE,
  import_batch_id TEXT REFERENCES import_batches(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_payments (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id),
  account_id TEXT REFERENCES accounts(id),
  investment_id TEXT REFERENCES investments(id),
  kind TEXT NOT NULL CHECK(kind IN ('boleto','pix','invoice','card','other')),
  notes TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Atalhos rápidos pra criação de scheduled_payments recorrentes (aluguel,
-- internet, etc). Ficam aqui pra não vazar nomes/valores via código-fonte.
CREATE TABLE IF NOT EXISTS quick_presets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('boleto','pix','invoice','card','other')),
  category_id TEXT REFERENCES categories(id),
  account_id TEXT REFERENCES accounts(id),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_occurred ON transactions(occurred_at);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_due ON scheduled_payments(due_date);

-- Índices que referenciam investment_id e a view v_tx_plus_future são criados
-- em runtime por src/lib/db/migrations/investments.ts, DEPOIS do ALTER TABLE
-- que adiciona investment_id. Isso evita um chicken-and-egg em bancos antigos:
-- criar índice/view referenciando uma coluna que ainda não foi adicionada
-- falha imediatamente e aborta toda a migração.
`
