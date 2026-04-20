import { createContext } from 'react'
import type { Database } from 'sql.js'

export type FinanceDbContextValue = {
  ready: boolean
  error: string | null
  version: number
  /** Só muda quando o arquivo SQLite inteiro é substituído (restaurar backup ou apagar tudo). Para remontar telas. */
  dbEpoch: number
  getDb: () => Database
  touch: () => void
  persistSoon: () => void
  persistNow: () => Promise<void>
  replaceDatabaseFromFile: (file: File) => Promise<void>
  exportDatabaseFile: () => void
  /** Apaga todos os dados locais e recria um banco vazio (categorias padrão de novo). */
  clearAllLocalData: () => Promise<void>
}

export const FinanceDbContext = createContext<FinanceDbContextValue | null>(null)
