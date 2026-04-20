const YM = /^\d{4}-(0[1-9]|1[0-2])$/

/** Valida e normaliza `YYYY-MM` ou retorna null. */
export function parseBillingRefYm(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  return YM.test(s) ? s : null
}
