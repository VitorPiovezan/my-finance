import {
  inferYearFromVencimento,
  parseBrazilianNumber,
  type PdfStatementRow,
} from './common'

/**
 * Santander costuma colar colunas no texto: "CONTA VIVO60,00", "CRUNCH14,99",
 * e "60,00VALOR TOTAL154,790,00". Separa VALOR TOTAL e insere espaço antes do valor em R$.
 */
function normalizeSantanderColumnGlues(text: string): string {
  /** 60,00VALOR TOTAL, 60,00VALORTOTAL — \s* cobre colado sem espaço */
  const withTotalBreaks = text.replace(/(?=VALOR\s*TOTAL)/gi, '\n')
  return withTotalBreaks
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim()
      if (!t) return ''
      if (/^VALOR\s*TOTAL/i.test(t)) return t
      let s = t
      let prev = ''
      while (s !== prev) {
        prev = s
        s = s.replace(/([A-Za-z*])(\d{1,3}(?:\.\d{3})*,\d{2})/g, '$1 $2')
      }
      return s
    })
    .filter(Boolean)
    .join('\n')
}

/** Remove R$, US$, "2", cabeçalhos etc. antes do primeiro DD/MM da linha. */
function stripLeadingJunkBeforeFirstDate(line: string): string {
  const t = line.trim()
  const m = t.match(/\d{2}\/\d{2}(?:\/\d{4})?/)
  if (!m || m.index === undefined || m.index === 0) return t
  return t.slice(m.index).trim()
}

function parseVencimento(text: string): { y: number; m: number; d: number } | null {
  const patterns = [
    /Vencimento[^\d]{0,48}(\d{2})\/(\d{2})\/(\d{4})/i,
    /vencimento[^\d]{0,48}(\d{2})\/(\d{2})\/(\d{4})/i,
    /data\s+de\s+vencimento[^\d]{0,48}(\d{2})\/(\d{2})\/(\d{4})/i,
    /venc\.?\s*[:\s]+(\d{2})\/(\d{2})\/(\d{4})/i,
    /melhor\s+data[^\d]{0,24}(\d{2})\/(\d{2})\/(\d{4})/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) return { d: Number(m[1]), m: Number(m[2]), y: Number(m[3]) }
  }
  return null
}

/**
 * Início de lançamento: DD/MM/AAAA ou DD/MM seguido de espaço, letra (@, *) ou fim.
 * Evita cortar dentro de 04/01/2026 e cobre 21/12CONTA (sem espaço).
 */
const TRANSACTION_DATE_START = /(?:\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{2})(?=\s|[A-Za-z*@]|$)/g

function splitLineAtEachTransactionStart(line: string): string[] {
  const t = line.trim()
  if (!t) return []
  const matches = [...t.matchAll(TRANSACTION_DATE_START)]
  if (matches.length <= 1) return [t]
  return matches.map((m, i) => {
    const start = m.index ?? 0
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? t.length) : t.length
    return t.slice(start, end).trim()
  })
}

/** Várias transações na mesma linha (PDF sem quebras). Aceita DD/MM ou DD/MM/AAAA. */
function expandLinesWithDates(text: string): string[] {
  const raw = text.split(/\r?\n/)
  const out: string[] = []
  for (const line of raw) {
    const t = stripLeadingJunkBeforeFirstDate(line)
    if (!t) continue
    out.push(...splitLineAtEachTransactionStart(t))
  }
  return out
}

type ParsedLine = { desc: string; valRaw: string; day: number; month: number; year?: number }

function isValidCalendarDayMonth(day: number, month: number): boolean {
  if (!Number.isFinite(day) || !Number.isFinite(month)) return false
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  if ([4, 6, 9, 11].includes(month) && day > 30) return false
  if (month === 2 && day > 29) return false
  return true
}

/** Rodapé / instruções de pagamento que o PDF mistura com a tabela de despesas. */
function shouldSkipSantanderNoise(desc: string, valRaw: string): boolean {
  const d = desc.trim().toLowerCase()
  if (!d) return true
  if (/pagar\s+somente|somente\s+com\s+esta\s+fatura|pagar\s+com\s+esta\s+fatura|pagar\s+este\s+boleto/i.test(d)) return true
  if (/^,\s*pagar|^,\s*$/i.test(d)) return true
  /** Uma só cifra — lixo de coluna (ex.: "1") */
  if (/^\d$/.test(d)) return true
  const n = Math.abs(parseBrazilianNumber(valRaw))
  if (n < 1e-9 && /pagar|somente|boleto|fatura/i.test(d)) return true
  return false
}

/**
 * PDFs costumam colar "Despesas Compra Data Descrição…" na mesma linha do 1º lançamento.
 * Pega a partir do primeiro DD/MM que parece início de linha de transação.
 */
function sliceFromFirstTransactionDate(line: string): string | null {
  const trimmed = line.trim()
  if (/^@\s*\d{2}\/\d{2}/.test(trimmed) || /^\d{2}\/\d{2}/.test(trimmed)) return trimmed

  const re = /\d{2}\/\d{2}(?:\/\d{4})?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(trimmed)) !== null) {
    const start = m.index
    const before = trimmed.slice(Math.max(0, start - 16), start).toLowerCase()
    if (/vencimento/.test(before)) continue
    const after = trimmed.slice(start + m[0].length)
    /** Descrição pode colar na data sem espaço (ex.: 21/12CONTA VIVO). */
    const looksLikeRow =
      /^\s+[A-Za-z*@0-9]/.test(after) ||
      /^[A-Za-z*@]/.test(after) ||
      /^\s+\d/.test(after)
    if (looksLikeRow) {
      return trimmed.slice(start).trim()
    }
  }
  return null
}

/**
 * Valor(es) no fim da linha (R$ e opcional US$); o restante é data + descrição.
 * Evita falha do .+? no meio quando o PDF cola cabeçalho antes da data.
 */
function tryParseSantanderLineCore(t: string): ParsedLine | null {
  if (t.length < 8) return null
  if (/^valor\s+total\b|^despesas\s*$/i.test(t)) return null
  if (/^VALOR\s*TOTAL/i.test(t)) return null
  if (/^compra\s+data\s+descri/i.test(t) || /^data\s+descri/i.test(t)) return null

  const line = t.replace(/^@\s*/, '').trim()
  const tailRe = /(?:R\$\s*)?(-?[\d.,]+)(?:\s+(?:R\$\s*)?(-?[\d.,]+))?\s*$/i
  const tm = line.match(tailRe)
  if (!tm || tm.index === undefined) return null
  const valRaw = tm[1]
  const before = line.slice(0, tm.index).trim()
  if (!before) return null

  const dmRe = /^(\d{2}\/\d{2}(?:\/\d{4})?)\s*(.+)$/
  const hm = before.match(dmRe)
  if (!hm) return null

  const dm = hm[1]
  const desc = hm[2].replace(/\s+/g, ' ').trim()
  if (desc.length < 2) return null
  if (/^total\b|^subtotal\b|^data\s*$/i.test(desc)) return null
  if (/^valor\s+total$/i.test(desc)) return null

  const parts = dm.split('/')
  const day = Number(parts[0])
  const month = Number(parts[1])
  const yearFromLine = parts.length >= 3 && /^\d{4}$/.test(parts[2]) ? Number(parts[2]) : undefined
  if (!Number.isFinite(day) || !Number.isFinite(month)) return null

  return { desc, valRaw, day, month, year: yearFromLine }
}

/**
 * Layout típico da tabela "Despesas": [Compra @?] Data | Descrição | Parcela? | R$ | US$?
 * O @ na coluna Compra é marca de lançamento — não deve descartar a linha.
 */
function tryParseSantanderLine(t: string): ParsedLine | null {
  if (t.length < 8) return null
  if (/^compra\s+data|^pagamento e demais$/i.test(t)) return null

  const trimmed = stripLeadingJunkBeforeFirstDate(t.trim())
  let parsed = tryParseSantanderLineCore(trimmed)
  if (!parsed) {
    const sliced = sliceFromFirstTransactionDate(trimmed)
    if (sliced) parsed = tryParseSantanderLineCore(sliced)
  }
  return parsed
}

/**
 * Fatura cartão Santander — linhas com DD/MM + descrição + valor (BR), com ou sem R$.
 */
export function parseSantanderCardPdfText(text: string): PdfStatementRow[] {
  const normalized = normalizeSantanderColumnGlues(text)
  const v = parseVencimento(normalized)
  if (!v) {
    throw new Error(
      'Não achei vencimento (DD/MM/AAAA) no PDF Santander. Procurei "Vencimento", "data de vencimento" etc.',
    )
  }

  const rows: PdfStatementRow[] = []
  const lines = expandLinesWithDates(normalized)

  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    if (/^(R\$|US\$|R\$\s*|US\$\s*|parcela|compra\s+data\s+descri)$/i.test(t)) continue
    if (/^(2|22)$/i.test(t)) continue

    const parsed = tryParseSantanderLine(t)
    if (!parsed) continue

    const { desc, valRaw, day, month, year: yLine } = parsed
    if (!isValidCalendarDayMonth(day, month)) continue
    if (shouldSkipSantanderNoise(desc, valRaw)) continue

    const year = yLine ?? inferYearFromVencimento(day, month, v)
    const dateDisplay = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`

    const raw = parseBrazilianNumber(valRaw)
    /** Negativo no PDF = pagamento/crédito; positivo = compra/despesa. */
    const amount = raw < 0 ? Math.abs(raw) : -Math.abs(raw)

    rows.push({ dateDisplay, amount, description: desc })
  }

  if (rows.length === 0) {
    throw new Error(
      'Nenhuma linha reconhecida no PDF Santander. Confira se o PDF tem texto selecionável (não é só imagem). ' +
        'Se for fatura digital e ainda falhar, avise o layout (print da primeira página).',
    )
  }
  return rows
}
