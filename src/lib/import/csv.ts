import { parseBRLToCents } from '../money'

export type CsvImportRow = {
  occurredOn: string
  amountCents: number
  description: string
  raw: string
}

function splitDelimited(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && c === delim) {
      out.push(cur.trim().replace(/^"|"$/g, ''))
      cur = ''
      continue
    }
    cur += c
  }
  out.push(cur.trim().replace(/^"|"$/g, ''))
  return out
}

function detectDelim(headerLine: string): string {
  const tabs = (headerLine.match(/\t/g) ?? []).length
  if (tabs >= 3) return '\t'
  const commas = (headerLine.match(/,/g) ?? []).length
  const semis = (headerLine.match(/;/g) ?? []).length
  return semis > commas ? ';' : ','
}

function headerScore(h: string, hints: string[]): number {
  const x = h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  let s = 0
  for (const hint of hints) {
    const hn = hint.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    if (hn.length > 0 && x.includes(hn)) s += 2
  }
  return s
}

function pickColumn(headers: string[], hints: string[]): number {
  let best = -1
  let bestIdx = 0
  headers.forEach((h, i) => {
    const sc = headerScore(h, hints)
    if (sc > best) {
      best = sc
      bestIdx = i
    }
  })
  return best > 0 ? bestIdx : -1
}

function parseDateToIso(cell: string): string | null {
  const s = cell.trim()
  if (!s) return null
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(s)
  if (iso) return iso[0]
  const br = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/.exec(s)
  if (br) {
    const d = Number(br[1])
    const m = Number(br[2])
    let y = Number(br[3])
    if (y < 100) y += 2000
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const mm = String(m).padStart(2, '0')
      const dd = String(d).padStart(2, '0')
      return `${y}-${mm}-${dd}`
    }
  }
  return null
}

function parseAmountCell(cell: string): number | null {
  const cents = parseBRLToCents(cell.replace(/[^\d,.+-]/g, ''))
  return cents
}

/** Linhas de pagamento da fatura / crédito no extrato de cartão (ex.: Nubank em inglês: title + amount negativo). */
function isCreditStatementPaymentLine(description: string): boolean {
  const n = description
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  const hints = [
    'pagamento recebido',
    'pagamento de fatura',
    'pagamento da fatura',
    'pagamento em fatura',
    'pagamento fatura',
    'payment received',
    'payment toward',
    'credit voucher',
  ]
  return hints.some((h) => n.includes(h))
}

const H_DATE = [
  'data',
  'date',
  'dia',
  'lancamento',
  'lançamento',
  'posting',
  'transaction',
  'data da compra',
  'data da transacao',
  'data da transação',
  'data pagamento',
  'data de inclusao',
  'data de inclusão',
  'data movimentacao',
  'data movimentação',
  'data utc',
]
const H_AMOUNT = [
  'valor',
  'amount',
  'total',
  'price',
  'r$',
  'us$',
  'valor us',
  'valor (r$)',
  'valor (us$)',
  'valor em real',
  'valor em reais',
]
const H_DESC = [
  'titulo',
  'title',
  'descricao',
  'descrição',
  'estabelecimento',
  'memo',
  'details',
  'detail',
  'identificador',
  'descricao transacao',
  'descrição da transação',
  'categoria',
  'nome',
]

export function parseBankCsv(text: string, opts?: { treatPositiveAsExpense?: boolean }): CsvImportRow[] {
  const raw = text.replace(/^\uFEFF/, '').replace(/^\uFFFE/, '')
  const lines = raw.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []
  const delim = detectDelim(lines[0])
  const headers = splitDelimited(lines[0], delim).map((h) => h.trim())
  const iDate = pickColumn(headers, H_DATE)
  const iAmt = pickColumn(headers, H_AMOUNT)
  const iDesc = pickColumn(headers, H_DESC)
  if (iDate < 0 || iAmt < 0) return []

  const rows: CsvImportRow[] = []
  for (let li = 1; li < lines.length; li++) {
    const raw = lines[li]
    const cells = splitDelimited(raw, delim)
    const dateCell = cells[iDate] ?? ''
    const occurredOn = parseDateToIso(dateCell)
    if (!occurredOn) continue
    const amountCell = cells[iAmt] ?? ''
    let amountCents = parseAmountCell(amountCell)
    if (amountCents === null) continue
    const description = (iDesc >= 0 ? cells[iDesc] : cells.filter((_, i) => i !== iDate && i !== iAmt).join(' ')) ?? ''
    const descTrim = description.trim() || '(sem descrição)'

    if (opts?.treatPositiveAsExpense) {
      if (isCreditStatementPaymentLine(descTrim) && amountCents < 0) {
        // Ex.: Nubank export "Pagamento recebido,-2357.25" — negativo no CSV é quitação, não compra.
        amountCents = -amountCents
      } else if (amountCents > 0) {
        amountCents = -amountCents
      }
    }

    rows.push({
      occurredOn,
      amountCents,
      description: descTrim,
      raw: raw,
    })
  }
  return rows
}

export function isProbablyCsv(name: string, mime: string): boolean {
  const n = name.toLowerCase()
  if (n.endsWith('.csv')) return true
  if (mime.includes('csv')) return true
  return false
}
