import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { formatBRL, formatBRLCompact } from '../lib/money'

const STORAGE_KEY = 'mf-amounts-visible'

/** Texto mascarado quando os valores estão ocultos (estado inicial). */
export const MONEY_MASK = 'R$ ••••••'

function readStoredVisible(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

type AmountVisibilityContextValue = {
  /** `true` = valores reais; `false` = mascarados (padrão ao abrir o site). */
  amountsVisible: boolean
  setAmountsVisible: (visible: boolean) => void
  toggleAmounts: () => void
}

const AmountVisibilityContext = createContext<AmountVisibilityContextValue | null>(null)

export function AmountVisibilityProvider({ children }: { children: ReactNode }) {
  const [amountsVisible, setAmountsVisibleState] = useState(() => readStoredVisible())

  const setAmountsVisible = useCallback((visible: boolean) => {
    setAmountsVisibleState(visible)
    try {
      localStorage.setItem(STORAGE_KEY, visible ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  const toggleAmounts = useCallback(() => {
    setAmountsVisibleState((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ amountsVisible, setAmountsVisible, toggleAmounts }),
    [amountsVisible, setAmountsVisible, toggleAmounts],
  )

  return (
    <AmountVisibilityContext.Provider value={value}>{children}</AmountVisibilityContext.Provider>
  )
}

export function useAmountVisibility(): AmountVisibilityContextValue {
  const ctx = useContext(AmountVisibilityContext)
  if (!ctx) {
    throw new Error('useAmountVisibility must be used within AmountVisibilityProvider')
  }
  return ctx
}

/**
 * Formatação de moeda que respeita o modo privado (valores ocultos por defeito).
 */
export function useMaskedMoney() {
  const { amountsVisible } = useAmountVisibility()

  const brl = useCallback(
    (cents: number) => (amountsVisible ? formatBRL(cents) : MONEY_MASK),
    [amountsVisible],
  )

  const brlSigned = useCallback(
    (cents: number) => {
      if (!amountsVisible) {
        if (cents === 0) return MONEY_MASK
        return cents > 0 ? `+${MONEY_MASK}` : `-${MONEY_MASK}`
      }
      if (cents > 0) return `+${formatBRL(cents)}`
      if (cents < 0) return `-${formatBRL(Math.abs(cents))}`
      return formatBRL(0)
    },
    [amountsVisible],
  )

  const brlCompact = useCallback(
    (cents: number) => (amountsVisible ? formatBRLCompact(cents) : MONEY_MASK),
    [amountsVisible],
  )

  /** Mesmo que `brl`, sem o prefixo "R$" — para células estreitas. */
  const brlNoSymbol = useCallback(
    (cents: number) =>
      amountsVisible ? formatBRL(cents).replace('R$', '').trim() : '••••',
    [amountsVisible],
  )

  return {
    amountsVisible,
    brl,
    brlSigned,
    brlCompact,
    brlNoSymbol,
    mask: MONEY_MASK,
  }
}
