import type { Database } from 'sql.js'

const SEED_CATEGORIES: { id: string; name: string; kind: 'expense' | 'income' | 'transfer' }[] = [
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
]

export function seedIfEmpty(db: Database): void {
  const res = db.exec('SELECT COUNT(*) FROM categories')
  const count = Number(res[0]?.values[0]?.[0] ?? 0)
  if (count > 0) return
  const now = new Date().toISOString()
  for (const c of SEED_CATEGORIES) {
    db.run(
      'INSERT OR IGNORE INTO categories (id, name, kind, created_at) VALUES (?, ?, ?, ?)',
      [c.id, c.name, c.kind, now],
    )
  }
}
