/** Converte "1.234,56" ou "1234,56" ou "-97,94" para número JS. */
export function parseBrazilianNumber(raw: string): number {
  const s = raw.trim().replace(/\s/g, '')
  const neg = s.startsWith('-')
  const t = neg ? s.slice(1) : s
  const n = Number(t.replace(/\./g, '').replace(',', '.'))
  return neg ? -n : n
}

export function formatCsvAmountFixed2(n: number): string {
  return n.toFixed(2)
}

export type PdfStatementRow = {
  /** DD/MM/AAAA */
  dateDisplay: string
  /** Negativo = saída / compra no cartão */
  amount: number
  description: string
}

export function inferYearFromVencimento(
  _day: number,
  month: number,
  v: { y: number; m: number; d: number },
): number {
  if (month > v.m) return v.y - 1
  if (month < v.m) return v.y
  return v.y
}

export function escapeCsvField(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function buildNubankLikeCsv(rows: PdfStatementRow[]): string {
  const header = 'Data,Valor,Identificador,Descrição'
  const lines = rows.map((r) => {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `pdf-${Date.now()}-${Math.random()}`
    return `${r.dateDisplay},${formatCsvAmountFixed2(r.amount)},${id},${escapeCsvField(r.description)}`
  })
  return [header, ...lines].join('\n') + '\n'
}
