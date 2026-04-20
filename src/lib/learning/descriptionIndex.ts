import type { Database } from 'sql.js'
import { queryAll } from '../db/query'

/**
 * Aprende com as categorizações que o usuário já fez: agrupa transações por descrição
 * normalizada e, para cada descrição, identifica a categoria dominante. Serve tanto para
 * sugerir categorias na tabela de lançamentos quanto para alimentar "few-shot examples"
 * no prompt da IA.
 *
 * Os lookups são puros (sem IA, sem rede).
 */

export type CategorySuggestion = {
  categoryId: string
  categoryName: string
  categoryKind: 'expense' | 'income' | 'transfer' | string
  /** `0..1` — frequência da categoria dominante entre todas as categorizações dessa norm. */
  confidence: number
  /** Quantas vezes essa descrição normalizada apareceu com ALGUMA categoria. */
  supportCount: number
  /** Quantas vezes apareceu com a categoria dominante. */
  supportDominantCount: number
  /** Descrição original representativa (a primeira encontrada), só para debug/exemplos. */
  sampleDescription: string
}

export type DescriptionIndex = Map<string, CategorySuggestion>

/** Prefixos comuns que atrapalham o matching (Nubank e similares). */
const PREFIXES_TO_STRIP = [
  'compra no debito',
  'compra no credito',
  'pagamento de boleto efetuado',
  'transferencia enviada pelo pix',
  'transferencia recebida pelo pix',
  'transferencia enviada',
  'transferencia recebida',
  'pagamento recebido',
  'pagamento da fatura',
  'pix enviado',
  'pix recebido',
  'compra parcelada',
  'estabelecimento',
  'nk',
]

/**
 * Normaliza uma descrição de transação: minúsculas, sem acentos, sem prefixos comuns,
 * sem números longos (que costumam ser datas, ids, CNPJs parciais). Serve como chave
 * de agrupamento.
 */
export function normalizeDescription(raw: string): string {
  if (!raw) return ''
  let s = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    // separadores comuns
    .replace(/[\-–—_/\\|()\[\]{}·•*"']+/g, ' ')
    // remove números longos (ids, cnpjs, datas) mas mantém números curtos (ex.: "loja 23")
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  for (const prefix of PREFIXES_TO_STRIP) {
    if (s.startsWith(`${prefix} `)) {
      s = s.slice(prefix.length + 1)
    } else if (s === prefix) {
      s = ''
    }
  }

  // segunda passada de normalização (caso o strip tenha deixado lixo)
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

/**
 * Constrói o índice a partir de TODAS as transações já categorizadas no banco
 * (incluindo `kind='transfer'`, para que pagamento de fatura etc. também seja sugerido).
 */
export function buildDescriptionIndex(db: Database): DescriptionIndex {
  const rows = queryAll(
    db,
    `
    SELECT t.description AS description, c.id AS category_id, c.name AS category_name, c.kind AS category_kind
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.category_id IS NOT NULL
    `,
  )

  // norm -> categoryId -> { count, name, kind, sample }
  const perNorm = new Map<
    string,
    {
      total: number
      sample: string
      byCat: Map<string, { count: number; name: string; kind: string }>
    }
  >()

  for (const r of rows) {
    const desc = String(r.description ?? '')
    const norm = normalizeDescription(desc)
    if (!norm) continue
    const catId = String(r.category_id)
    const catName = String(r.category_name)
    const catKind = String(r.category_kind)

    let bucket = perNorm.get(norm)
    if (!bucket) {
      bucket = { total: 0, sample: desc, byCat: new Map() }
      perNorm.set(norm, bucket)
    }
    bucket.total += 1
    const cat = bucket.byCat.get(catId)
    if (cat) {
      cat.count += 1
    } else {
      bucket.byCat.set(catId, { count: 1, name: catName, kind: catKind })
    }
  }

  const index: DescriptionIndex = new Map()
  for (const [norm, bucket] of perNorm) {
    let bestId = ''
    let bestCount = 0
    let bestName = ''
    let bestKind = ''
    for (const [id, info] of bucket.byCat) {
      if (info.count > bestCount) {
        bestCount = info.count
        bestId = id
        bestName = info.name
        bestKind = info.kind
      }
    }
    if (!bestId) continue
    index.set(norm, {
      categoryId: bestId,
      categoryName: bestName,
      categoryKind: bestKind,
      supportCount: bucket.total,
      supportDominantCount: bestCount,
      confidence: bucket.total > 0 ? bestCount / bucket.total : 0,
      sampleDescription: bucket.sample,
    })
  }
  return index
}

export type SuggestionStrength = 'strong' | 'moderate' | null

/**
 * Retorna a sugestão para uma descrição, junto com a "força".
 *   - `strong`:    support >= 3 e confidence >= 0.7 — seguro aplicar automaticamente.
 *   - `moderate`:  support >= 1 e confidence >= 0.9 — apenas sugerir na UI, pedir confirmação.
 *   - `null`:      nada confiável.
 */
export function suggestCategory(
  index: DescriptionIndex,
  description: string,
): { suggestion: CategorySuggestion; strength: Exclude<SuggestionStrength, null> } | null {
  const norm = normalizeDescription(description)
  if (!norm) return null
  const found = index.get(norm)
  if (!found) return null
  if (found.supportCount >= 3 && found.confidence >= 0.7) {
    return { suggestion: found, strength: 'strong' }
  }
  if (found.supportCount >= 1 && found.confidence >= 0.9) {
    return { suggestion: found, strength: 'moderate' }
  }
  return null
}

export type LearningExample = {
  description: string
  normalized: string
  categoryName: string
  categoryKind: string
  supportCount: number
}

/**
 * Pega os top-N exemplos "canônicos" do histórico para injetar no prompt da IA
 * como few-shot. Ordena por suporte desc, com confidence alta (>= 0.8) para evitar
 * mandar ruído. Dedup por (normalized, categoryName).
 */
export function getLearningExamples(
  index: DescriptionIndex,
  limit = 30,
): LearningExample[] {
  const all: LearningExample[] = []
  for (const [norm, s] of index) {
    if (s.confidence < 0.8) continue
    all.push({
      description: s.sampleDescription,
      normalized: norm,
      categoryName: s.categoryName,
      categoryKind: s.categoryKind,
      supportCount: s.supportCount,
    })
  }
  all.sort((a, b) => b.supportCount - a.supportCount)
  return all.slice(0, limit)
}
