export function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

/** Formato curto para células densas (ex.: mapa de calor). */
export function formatBRLCompact(cents: number): string {
  const v = cents / 100
  const abs = Math.abs(v)
  if (abs >= 1000) {
    return `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`
  }
  return `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
}

export function parseBRLToCents(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const normalized = trimmed
    .replace(/\s/g, '')
    .replace('R$', '')
    .replace(/[^\d,.-]/g, '')
  const lastComma = normalized.lastIndexOf(',')
  const lastDot = normalized.lastIndexOf('.')
  let normalizedNum = normalized
  if (lastComma > lastDot) {
    normalizedNum = normalized.replace(/\./g, '').replace(',', '.')
  } else {
    normalizedNum = normalized.replace(/,/g, '')
  }
  const n = Number(normalizedNum)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}
