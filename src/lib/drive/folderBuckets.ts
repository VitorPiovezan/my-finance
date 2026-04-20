import { normalizeInstitutionKey } from './driveApi'

/** Pastas reconhecidas dentro de cada banco (ex.: Financeiro/nubank/cartao). */
export type AccountBucket = 'credit' | 'checking'

/**
 * Interpreta o nome da subpasta (cartão/conta etc.) após normalizar.
 * Retorna null se não for um dos buckets esperados.
 */
export function parseBucketFolderName(folderName: string): AccountBucket | null {
  const n = normalizeInstitutionKey(folderName)
  const creditKeys = new Set(['cartao', 'cartao-de-credito', 'credito', 'card', 'credit', 'fatura'])
  const checkingKeys = new Set([
    'conta',
    'conta-corrente',
    'corrente',
    'debito',
    'checking',
    'conta-pj',
    'pj',
  ])
  if (creditKeys.has(n)) return 'credit'
  if (checkingKeys.has(n)) return 'checking'
  return null
}

export function accountMatchesBucket(
  institutionKeyFromFolder: string,
  accountInstitutionKey: string | null | undefined,
  accountKind: string,
  bucket: AccountBucket,
): boolean {
  if (!accountInstitutionKey) return false
  if (normalizeInstitutionKey(accountInstitutionKey) !== institutionKeyFromFolder) return false
  if (bucket === 'credit') return accountKind === 'credit'
  return accountKind !== 'credit'
}
