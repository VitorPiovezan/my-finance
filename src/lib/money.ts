export function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
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
