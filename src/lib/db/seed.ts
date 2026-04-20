import type { Database } from 'sql.js'

type SeedKind = 'expense' | 'income' | 'transfer' | 'investment_in' | 'investment_out'

const SEED_CATEGORIES: { id: string; name: string; kind: SeedKind }[] = [
  { id: 'c1111111-1111-4111-8111-111111111101', name: 'Alimentação', kind: 'expense' },
  { id: 'c1111111-1111-4111-8111-111111111102', name: 'Transporte', kind: 'expense' },
  { id: 'c1111111-1111-4111-8111-111111111103', name: 'Moradia', kind: 'expense' },
  { id: 'c1111111-1111-4111-8111-111111111104', name: 'Saúde', kind: 'expense' },
  { id: 'c1111111-1111-4111-8111-111111111105', name: 'Assinaturas', kind: 'expense' },
  { id: 'c1111111-1111-4111-8111-111111111106', name: 'Compras', kind: 'expense' },
  { id: 'c1111111-1111-4111-8111-111111111107', name: 'Serviços', kind: 'expense' },
  { id: 'c1111111-1111-4111-8111-111111111108', name: 'Educação', kind: 'expense' },
  { id: 'c1111111-1111-4111-8111-111111111109', name: 'Lazer', kind: 'expense' },
  { id: 'c1111111-1111-4111-8111-111111111110', name: 'Transferências', kind: 'transfer' },
  { id: 'c1111111-1111-4111-8111-111111111111', name: 'Salário', kind: 'income' },
  { id: 'c1111111-1111-4111-8111-111111111112', name: 'Outros rendimentos', kind: 'income' },
  { id: 'c1111111-1111-4111-8111-111111111113', name: 'Aporte (investimento)', kind: 'investment_in' },
  { id: 'c1111111-1111-4111-8111-111111111114', name: 'Retirada de investimento', kind: 'investment_out' },
]

export function seedIfEmpty(db: Database): void {
  const now = new Date().toISOString()
  ensureInvestmentCategories(db, now)
  const res = db.exec('SELECT COUNT(*) FROM categories')
  const count = Number(res[0]?.values[0]?.[0] ?? 0)
  if (count > 0) return
  for (const c of SEED_CATEGORIES) {
    db.run(
      'INSERT OR IGNORE INTO categories (id, name, kind, created_at) VALUES (?, ?, ?, ?)',
      [c.id, c.name, c.kind, now],
    )
  }
}

/**
 * Garante que bancos já povoados (antes da feature de investimentos) tenham
 * as duas categorias de investimento registradas. Sem isto, o usuário não
 * teria o que selecionar pra marcar aportes/retiradas.
 */
function ensureInvestmentCategories(db: Database, now: string): void {
  for (const c of SEED_CATEGORIES.filter(
    (x) => x.kind === 'investment_in' || x.kind === 'investment_out',
  )) {
    db.run(
      'INSERT OR IGNORE INTO categories (id, name, kind, created_at) VALUES (?, ?, ?, ?)',
      [c.id, c.name, c.kind, now],
    )
  }
}
