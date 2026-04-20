import { buildNubankLikeCsv } from './pdfParsers/common'
import { parseMercadoPagoCardPdfText } from './pdfParsers/mercadoPagoCard'
import { parseSantanderCardPdfText } from './pdfParsers/santanderCard'

export type PdfBankKey = 'mercado-pago' | 'santander'
export type PdfBucketKey = 'cartao' | 'conta'

export function pdfTextToNubankCsv(bank: PdfBankKey, bucket: PdfBucketKey, text: string): string {
  if (bucket === 'conta') {
    throw new Error(
      'Conversão automática de PDF de conta ainda não está disponível. Exporte CSV pelo app do banco ou use fatura de cartão.',
    )
  }
  if (bank === 'mercado-pago') {
    return buildNubankLikeCsv(parseMercadoPagoCardPdfText(text))
  }
  return buildNubankLikeCsv(parseSantanderCardPdfText(text))
}
