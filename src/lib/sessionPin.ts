/**
 * Gate simples de sessão baseado em PIN.
 *
 * O PIN é injetado em build via `VITE_APP_ACCESS_PIN` (texto puro).
 * Atenção: todo `VITE_*` vai pro bundle público, então o PIN pode ser lido
 * por qualquer visitante com DevTools. É um obstáculo, não criptografia —
 * serve só pra evitar que a URL indexe ou que alguém caia aqui sem querer.
 *
 * A sessão vive em `sessionStorage`: desbloqueia 1 vez e dura enquanto a
 * aba/janela estiver aberta (fecha a aba → tem que digitar de novo).
 */

const STORAGE_KEY = 'my-finance-session'
const UNLOCKED_VALUE = '1'

function configuredPin(): string {
  return (import.meta.env.VITE_APP_ACCESS_PIN ?? '').trim()
}

/** True quando o deploy exige PIN. Se estiver em branco, o app abre livre. */
export function isPinConfigured(): boolean {
  return configuredPin().length > 0
}

export function isSessionUnlocked(): boolean {
  if (!isPinConfigured()) return true
  try {
    return sessionStorage.getItem(STORAGE_KEY) === UNLOCKED_VALUE
  } catch {
    return false
  }
}

/**
 * Compara timing-safe o PIN digitado com o esperado.
 * Retorna true em caso de match e já marca a sessão como destravada.
 */
export function tryUnlockWithPin(input: string): boolean {
  if (!isPinConfigured()) return true
  const expected = configuredPin()
  const got = input.trim()
  if (got.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) {
    diff |= got.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  if (diff !== 0) return false
  try {
    sessionStorage.setItem(STORAGE_KEY, UNLOCKED_VALUE)
  } catch {
    /* storage indisponível — segue só em memória desta renderização */
  }
  return true
}

export function lockSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* noop */
  }
}
