export const MIGRATION_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  institution_key TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('checking','credit','wallet','other')),
  color TEXT,
  invoice_close_day INTEGER,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('expense','income','transfer')),
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

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  category_id TEXT REFERENCES categories(id),
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

-- Visão unificada: transações reais + futuros agendados (despesa OU receita),
-- pra aparecerem na Visão geral, Análise e Por categoria. Apagar um futuro em
-- "Futuros" faz a linha sumir naturalmente aqui. Futuros sem conta vinculada
-- são ignorados (não sabemos se contam como cartão ou corrente).
--
-- A direção é decidida pelo kind da categoria do futuro:
--   - income   -> positivo (entra como receita)
--   - demais   -> negativo (entra como despesa)
-- Se não tem categoria, assume despesa (comportamento padrão do formulário).
DROP VIEW IF EXISTS v_tx_plus_future;
CREATE VIEW v_tx_plus_future AS
SELECT
  id, account_id, category_id, amount_cents, occurred_at, billing_ref_ym,
  description, source, fingerprint, import_batch_id, created_at
FROM transactions
UNION ALL
SELECT
  ('sch_' || s.id) AS id,
  s.account_id,
  s.category_id,
  CASE
    WHEN c.kind = 'income' THEN ABS(s.amount_cents)
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
`
