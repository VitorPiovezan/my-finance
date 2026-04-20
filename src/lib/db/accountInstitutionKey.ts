import type { Row } from './query'
import { normalizeInstitutionKey } from '../drive/driveApi'

/** Lê institution_key mesmo se o driver expuser o nome da coluna em outro caso. */
export function getAccountInstitutionKey(row: Row): string {
  const v = row.institution_key
  if (v != null && String(v).trim() !== '') return String(v)
  const alt = (row as Record<string, unknown>).INSTITUTION_KEY
  if (alt != null && String(alt).trim() !== '') return String(alt)
  return ''
}

/** Lista única de chaves normalizadas (para dicas no log do sync). */
export function registeredNormalizedInstitutionKeys(accounts: Row[]): string[] {
  const uniq = new Set<string>()
  for (const a of accounts) {
    const k = normalizeInstitutionKey(getAccountInstitutionKey(a))
    if (k) uniq.add(k)
  }
  return [...uniq].sort()
}
