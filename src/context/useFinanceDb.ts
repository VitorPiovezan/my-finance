import { useContext } from 'react'
import { FinanceDbContext, type FinanceDbContextValue } from './financeDbContext'

export function useFinanceDb(): FinanceDbContextValue {
  const ctx = useContext(FinanceDbContext)
  if (!ctx) throw new Error('useFinanceDb deve ficar dentro de FinanceDbProvider')
  return ctx
}
