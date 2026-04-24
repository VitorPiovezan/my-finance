import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { ymNow } from '../lib/queries/spendSummary'

const STORAGE_KEY = 'mf-categories-period-v1'

export type CategoriesViewMode = 'year' | 'month'

export type CategoriesPeriodState = {
  mode: CategoriesViewMode
  year: number
  monthYm: string
}

function defaultState(): CategoriesPeriodState {
  const d = new Date()
  return {
    mode: 'month',
    year: d.getFullYear(),
    monthYm: ymNow(),
  }
}

function parseStored(json: string): CategoriesPeriodState | null {
  try {
    const p = JSON.parse(json) as Partial<CategoriesPeriodState>
    if (p.mode !== 'year' && p.mode !== 'month') return null
    if (typeof p.year !== 'number' || !Number.isFinite(p.year)) return null
    if (typeof p.monthYm !== 'string' || !/^\d{4}-\d{2}$/.test(p.monthYm)) return null
    return { mode: p.mode, year: p.year, monthYm: p.monthYm }
  } catch {
    return null
  }
}

function readPersisted(): CategoriesPeriodState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    return parseStored(raw) ?? defaultState()
  } catch {
    return defaultState()
  }
}

function writePersisted(s: CategoriesPeriodState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

/** Prioridade: query `period` na URL, senão `localStorage`, senão mês atual. */
function initialFromUrlAndStorage(search: string): CategoriesPeriodState {
  const params = new URLSearchParams(search)
  const raw = params.get('period')
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    return {
      mode: 'month',
      monthYm: raw,
      year: Number(raw.slice(0, 4)),
    }
  }
  if (raw && /^\d{4}$/.test(raw)) {
    const p = readPersisted()
    return {
      mode: 'year',
      year: Number(raw),
      monthYm: p.monthYm,
    }
  }
  return readPersisted()
}

type CategoriesPeriodContextValue = {
  mode: CategoriesViewMode
  year: number
  monthYm: string
  setMode: (m: CategoriesViewMode) => void
  setYear: (y: number) => void
  setMonthYm: (ym: string) => void
  applyFromPeriodParam: (raw: string) => void
}

const CategoriesPeriodContext = createContext<CategoriesPeriodContextValue | null>(null)

/**
 * Escopo da rota "Por categoria": período mês/ano, persistido em `localStorage`.
 * A montagem lê `?period=YYYY` ou `?period=YYYY-MM` (tem prioridade sobre o armazenado).
 */
export function CategoriesPeriodProvider({ children }: { children: ReactNode }) {
  const { search } = useLocation()
  const [state, setState] = useState<CategoriesPeriodState>(() => initialFromUrlAndStorage(search))

  const setStateAndPersist = useCallback(
    (next: CategoriesPeriodState | ((prev: CategoriesPeriodState) => CategoriesPeriodState)) => {
      setState((prev) => {
        const n = typeof next === 'function' ? (next as (p: CategoriesPeriodState) => CategoriesPeriodState)(prev) : next
        writePersisted(n)
        return n
      })
    },
    [],
  )

  const setMode = useCallback(
    (m: CategoriesViewMode) => {
      setStateAndPersist((prev) => ({ ...prev, mode: m }))
    },
    [setStateAndPersist],
  )

  const setYear = useCallback(
    (y: number) => {
      setStateAndPersist((prev) => ({ ...prev, year: y }))
    },
    [setStateAndPersist],
  )

  const setMonthYm = useCallback(
    (ym: string) => {
      setStateAndPersist((prev) => ({
        ...prev,
        monthYm: ym,
        year: Number(ym.slice(0, 4)),
      }))
    },
    [setStateAndPersist],
  )

  const applyFromPeriodParam = useCallback(
    (raw: string) => {
      if (!raw) return
      if (/^\d{4}-\d{2}$/.test(raw)) {
        setStateAndPersist({
          mode: 'month',
          monthYm: raw,
          year: Number(raw.slice(0, 4)),
        })
        return
      }
      if (/^\d{4}$/.test(raw)) {
        setStateAndPersist((prev) => ({
          mode: 'year',
          year: Number(raw),
          monthYm: prev.monthYm,
        }))
      }
    },
    [setStateAndPersist],
  )

  const value = useMemo(
    () => ({
      mode: state.mode,
      year: state.year,
      monthYm: state.monthYm,
      setMode,
      setYear,
      setMonthYm,
      applyFromPeriodParam,
    }),
    [state, setMode, setYear, setMonthYm, applyFromPeriodParam],
  )

  return (
    <CategoriesPeriodContext.Provider value={value}>{children}</CategoriesPeriodContext.Provider>
  )
}

export function useCategoriesPeriod(): CategoriesPeriodContextValue {
  const c = useContext(CategoriesPeriodContext)
  if (!c) {
    throw new Error('useCategoriesPeriod must be used within CategoriesPeriodProvider')
  }
  return c
}
