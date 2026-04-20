import type { Database } from 'sql.js'
import { queryAll, run } from '../db/query'
import {
  buildDescriptionIndex,
  getLearningExamples,
  suggestCategory,
  type LearningExample,
} from '../learning/descriptionIndex'
import { SQL_EFFECTIVE_SPEND_MONTH } from '../queries/effectiveSpendMonth'
import { analysisFilterWhere, type AnalysisFilter } from '../queries/analysis'
import { getGeminiApiKey, getGeminiModel } from './settings'

export type AiAssignment = {
  id: string
  description: string
  amountCents: number
  accountName: string
  categoryId: string | null
  categoryName: string | null
}

export type CategorizeOptions = {
  ym: string
  filter: AnalysisFilter
  /** Tamanho do lote mandado por requisição (limita tokens e permite progresso). */
  batchSize?: number
  signal?: AbortSignal
  onProgress?: (update: { processed: number; total: number; batch: number; totalBatches: number }) => void
}

export type CategorizeResult = {
  processed: number
  updated: number
  skipped: number
  /** Quantos foram resolvidos apenas pelo aprendizado local (sem chamar a IA). */
  learnedApplied: number
  /** Quantos foram mandados para a IA (processed - learnedApplied). */
  aiProcessed: number
  assignments: AiAssignment[]
}

type Category = {
  id: string
  name: string
  kind: 'expense' | 'income' | 'transfer'
}

type UncategorizedTx = {
  id: string
  occurred_at: string
  description: string
  amount_cents: number
  account_name: string
  account_kind: string
}

function loadCategories(db: Database): Category[] {
  const rows = queryAll(db, 'SELECT id, name, kind FROM categories ORDER BY kind, name')
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    kind: String(r.kind) as Category['kind'],
  }))
}

function loadUncategorized(
  db: Database,
  ym: string,
  filter: AnalysisFilter,
): UncategorizedTx[] {
  const w = analysisFilterWhere(filter)
  const rows = queryAll(
    db,
    `
    SELECT t.id, t.occurred_at, t.description, t.amount_cents,
           a.name AS account_name, a.kind AS account_kind
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
    WHERE ${w.sql}
      AND (${SQL_EFFECTIVE_SPEND_MONTH}) = ?
      AND t.category_id IS NULL
    ORDER BY t.occurred_at DESC, t.id DESC
    `,
    [...w.params, ym],
  )
  return rows.map((r) => ({
    id: String(r.id),
    occurred_at: String(r.occurred_at),
    description: String(r.description),
    amount_cents: Number(r.amount_cents ?? 0),
    account_name: String(r.account_name),
    account_kind: String(r.account_kind),
  }))
}

export function countUncategorized(
  db: Database,
  ym: string,
  filter: AnalysisFilter,
): number {
  return loadUncategorized(db, ym, filter).length
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

function buildPrompt(
  categories: Category[],
  batch: UncategorizedTx[],
  examples: LearningExample[],
) {
  const catLines = categories
    .map((c) => `- id=${c.id} | kind=${c.kind} | name="${c.name}"`)
    .join('\n')
  const txLines = batch
    .map(
      (t) =>
        `- id=${t.id} | date=${t.occurred_at.slice(0, 10)} | amount=${formatCents(t.amount_cents)} BRL | account="${t.account_name}" (${t.account_kind}) | desc="${t.description.replace(/"/g, "'")}"`,
    )
    .join('\n')

  const system = [
    'Você é um classificador de transações financeiras pessoais em português brasileiro.',
    'Escolha a categoria mais adequada para cada transação, SOMENTE entre as opções fornecidas (use o id exato listado).',
    'Regras de prioridade:',
    '1) TRANSFERÊNCIA entre contas próprias do usuário tem prioridade absoluta. Use uma categoria kind=transfer quando existir. Sinais típicos:',
    '   - Pagamento de fatura do cartão (ex.: "Pagamento de fatura", "Pagamento recebido" na conta do cartão, "Pagto fatura NU").',
    '   - Transferência/PIX/TED para a própria pessoa ou entre suas contas (ex.: "Transferência enviada para <mesmo nome>", "Pix para carteira", "Aplicação/resgate em conta investimento").',
    '   - Resgate/aplicação em poupança ou reserva.',
    '   Transferências entre contas próprias NÃO são despesa nem receita — são dinheiro mudando de lugar.',
    '2) Se a transação for claramente uma RECEITA (salário, rendimento, pix recebido de terceiros), use uma categoria kind=income.',
    '3) Caso contrário, use uma categoria kind=expense coerente com a descrição.',
    '4) PREFERÊNCIA PESSOAL: quando você receber exemplos do histórico do próprio usuário (seção "Exemplos do histórico"), prefira seguir o padrão dele para descrições parecidas, mesmo que existam outras categorias tematicamente possíveis.',
    '5) Se NÃO for possível decidir com segurança, retorne category_id=null (sem inventar).',
    'Responda APENAS com JSON válido no formato:',
    '{"assignments": [{"id": "<tx_id>", "category_id": "<category_id_or_null>", "reason": "breve justificativa"}]}',
    'Não adicione comentários, markdown ou texto fora do JSON.',
  ].join('\n')

  const exampleBlock =
    examples.length > 0
      ? [
          '',
          'Exemplos do histórico do usuário (descrição normalizada -> categoria já usada por ele antes):',
          ...examples.map(
            (e) =>
              `- "${e.normalized}" (ex.: "${e.description.replace(/"/g, "'").slice(0, 80)}") -> ${e.categoryName} [kind=${e.categoryKind}] (usada ${e.supportCount}x)`,
          ),
        ].join('\n')
      : ''

  const user = [
    'Categorias disponíveis:',
    catLines,
    exampleBlock,
    '',
    'Transações a classificar:',
    txLines,
  ]
    .filter((line) => line !== '')
    .join('\n')

  return { system, user }
}

async function callGemini(params: {
  apiKey: string
  model: string
  system: string
  user: string
  signal?: AbortSignal
}): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': params.apiKey,
    },
    signal: params.signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: params.system }] },
      contents: [{ role: 'user', parts: [{ text: params.user }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
    }),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error?.message ? `: ${j.error.message}` : ''
    } catch {
      try {
        detail = `: ${await res.text()}`
      } catch {
        /* ignore */
      }
    }
    throw new Error(`Gemini ${res.status}${detail}`)
  }
  const data = await res.json()
  const parts: { text?: string }[] | undefined = data?.candidates?.[0]?.content?.parts
  const content = Array.isArray(parts)
    ? parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('').trim()
    : ''
  if (!content) {
    const reason: string | undefined = data?.candidates?.[0]?.finishReason
    throw new Error(`Resposta do Gemini sem conteúdo${reason ? ` (finishReason=${reason})` : ''}.`)
  }
  return content
}

type LlmAssignment = { id: string; category_id: string | null; reason?: string }

function parseAssignments(raw: string): LlmAssignment[] {
  let text = raw.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  }
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object') throw new Error('Resposta da IA não é JSON.')
  const arr = (parsed as { assignments?: unknown }).assignments
  if (!Array.isArray(arr)) throw new Error('Campo "assignments" ausente.')
  const out: LlmAssignment[] = []
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue
    const obj = it as { id?: unknown; category_id?: unknown; reason?: unknown }
    if (typeof obj.id !== 'string') continue
    const cat = obj.category_id
    const catOk = cat === null || typeof cat === 'string'
    if (!catOk) continue
    out.push({
      id: obj.id,
      category_id: cat === '' ? null : (cat as string | null),
      reason: typeof obj.reason === 'string' ? obj.reason : undefined,
    })
  }
  return out
}

export async function categorizeWithAi(
  db: Database,
  opts: CategorizeOptions,
): Promise<CategorizeResult> {
  const { key } = getGeminiApiKey()
  if (!key) {
    throw new Error('Configure sua chave do Gemini em "Configurar IA" (ou na .env VITE_GEMINI_API_KEY).')
  }
  const model = getGeminiModel()

  const categories = loadCategories(db)
  const categoryIds = new Set(categories.map((c) => c.id))
  const all = loadUncategorized(db, opts.ym, opts.filter)
  const total = all.length
  if (total === 0) {
    return {
      processed: 0,
      updated: 0,
      skipped: 0,
      learnedApplied: 0,
      aiProcessed: 0,
      assignments: [],
    }
  }

  // FASE 1 — aprendizado local: resolve o que já temos histórico forte pra categorizar,
  // sem gastar tokens da IA.
  const index = buildDescriptionIndex(db)
  const examples = getLearningExamples(index, 30)
  const assignments: AiAssignment[] = []
  const remaining: UncategorizedTx[] = []
  let learnedApplied = 0

  for (const tx of all) {
    const hit = suggestCategory(index, tx.description)
    if (hit && hit.strength === 'strong' && categoryIds.has(hit.suggestion.categoryId)) {
      run(db, 'UPDATE transactions SET category_id = ? WHERE id = ? AND category_id IS NULL', [
        hit.suggestion.categoryId,
        tx.id,
      ])
      learnedApplied += 1
      assignments.push({
        id: tx.id,
        description: tx.description,
        amountCents: tx.amount_cents,
        accountName: tx.account_name,
        categoryId: hit.suggestion.categoryId,
        categoryName: hit.suggestion.categoryName,
      })
    } else {
      remaining.push(tx)
    }
  }

  opts.onProgress?.({
    processed: learnedApplied,
    total,
    batch: 0,
    totalBatches: 0,
  })

  // FASE 2 — o que sobrou vai pra IA, com os exemplos fortes injetados como few-shot.
  const batchSize = Math.max(5, Math.min(opts.batchSize ?? 40, 80))
  const totalBatches = remaining.length > 0 ? Math.ceil(remaining.length / batchSize) : 0
  let processed = learnedApplied
  let updated = learnedApplied
  let skipped = 0

  for (let b = 0; b < totalBatches; b++) {
    if (opts.signal?.aborted) throw new Error('Cancelado pelo usuário.')
    const batch = remaining.slice(b * batchSize, b * batchSize + batchSize)
    const { system, user } = buildPrompt(categories, batch, examples)
    const raw = await callGemini({ apiKey: key, model, system, user, signal: opts.signal })
    let parsed: LlmAssignment[] = []
    try {
      parsed = parseAssignments(raw)
    } catch (err) {
      throw new Error(`Falha ao interpretar resposta da IA: ${err instanceof Error ? err.message : String(err)}`)
    }

    const byId = new Map(parsed.map((p) => [p.id, p]))
    for (const tx of batch) {
      const a = byId.get(tx.id)
      const categoryId = a?.category_id && categoryIds.has(a.category_id) ? a.category_id : null
      if (categoryId) {
        run(db, 'UPDATE transactions SET category_id = ? WHERE id = ? AND category_id IS NULL', [
          categoryId,
          tx.id,
        ])
        updated += 1
      } else {
        skipped += 1
      }
      assignments.push({
        id: tx.id,
        description: tx.description,
        amountCents: tx.amount_cents,
        accountName: tx.account_name,
        categoryId,
        categoryName: categoryId
          ? (categories.find((c) => c.id === categoryId)?.name ?? null)
          : null,
      })
    }

    processed += batch.length
    opts.onProgress?.({ processed, total, batch: b + 1, totalBatches })
  }

  return {
    processed,
    updated,
    skipped,
    learnedApplied,
    aiProcessed: remaining.length,
    assignments,
  }
}
