import {
  inferYearFromVencimento,
  parseBrazilianNumber,
  type PdfStatementRow,
} from './common'

function parseVencimento(text: string): { y: number; m: number; d: number } | null {
  const m =
    text.match(/Vencimento:\s*(\d{2})\/(\d{2})\/(\d{4})/i) ??
    text.match(/vence\s+em\s*(\d{2})\/(\d{2})\/(\d{4})/i)
  if (!m) return null
  return { d: Number(m[1]), m: Number(m[2]), y: Number(m[3]) }
}

/** Sem "total" aqui — senão corta estabelecimentos tipo "Total Express"; total vai em isMercadoPagoSummaryRow */
const SKIP = /^(data|movimenta|cartão|visa|detalhes|informações)/i

/** Linha de total/subtotal da tabela (não é compra). Evita bater em "Total Express" etc. */
function isMercadoPagoSummaryRow(desc: string): boolean {
  const d = desc.replace(/\s+/g, ' ').trim()
  if (!d) return true
  const t = d.toLowerCase()
  if (t === 'total' || t === 'subtotal') return true
  if (/^total\s*[-:]\s*$/i.test(d)) return true
  if (/^total\s+da\s+fatura/i.test(d)) return true
  if (/^total\s+de\s+compras/i.test(d)) return true
  if (/^total\s+geral$/i.test(d)) return true
  return false
}

/**
 * Só a lista de compras do cartão (Visa etc.). Ignora "Movimentações na fatura"
 * (pagamento da fatura, crédito concedido, etc.), que é outra tabela no PDF.
 */
function sliceMercadoPagoCardPurchaseSection(fullText: string): string {
  const markers = [
    /Cartão\s+Visa/i,
    /Cart[aã]o\s+Visa/i,
    /Cartão\s+Mastercard/i,
    /Cart[aã]o\s+Mastercard/i,
    /Movimenta(ç|c)(õ|o)es\s+no\s+cart[aã]o/i,
  ]
  for (const re of markers) {
    const idx = fullText.search(re)
    if (idx >= 0) return fullText.slice(idx)
  }
  const masked = fullText.search(/\bVisa\s*\*+\d{4}\b/i)
  if (masked >= 0) return fullText.slice(masked)
  return fullText
}

/**
 * Fatura de cartão Mercado Pago (texto do PDF).
 */
export function parseMercadoPagoCardPdfText(text: string): PdfStatementRow[] {
  const v = parseVencimento(text)
  if (!v) {
    throw new Error('Não achei data de vencimento no PDF (esperado "Vencimento: DD/MM/AAAA").')
  }

  const section = sliceMercadoPagoCardPurchaseSection(text)

  const rows: PdfStatementRow[] = []
  const re = /(\d{2}\/\d{2})\s+(.+?)\s+R\$\s*([\d.,]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(section)) !== null) {
    const [, dm, descRaw, valRaw] = m
    const desc = descRaw.replace(/\s+/g, ' ').trim()
    if (!desc || SKIP.test(desc)) continue
    if (isMercadoPagoSummaryRow(desc)) continue
    if (/^valor\s+em\s+r\$/i.test(desc)) continue
    // Pagamentos/créditos na fatura (tabela separada); não são compras no cartão
    if (/pagamento\s+da\s+fatura|cr[eé]dito\s+concedido/i.test(desc)) continue

    const parts = dm.split('/')
    const day = Number(parts[0])
    const month = Number(parts[1])
    const year = inferYearFromVencimento(day, month, v)
    const dateDisplay = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`

    const brl = parseBrazilianNumber(valRaw)
    const isCredit =
      /pagamento\s+da\s+fatura|cr[eé]dito\s+concedido|estorno|recebido|pagamento\s+recebido/i.test(desc)
    const amount = isCredit ? Math.abs(brl) : -Math.abs(brl)

    rows.push({ dateDisplay, amount, description: desc })
  }

  if (rows.length === 0) {
    throw new Error(
      'Nenhuma linha no formato "DD/MM … R$ X,XX" encontrada. Confira se o PDF tem texto selecionável.',
    )
  }
  return rows
}
