/**
 * Gate simples de sessão baseado em PIN.
 *
 * O hash SHA-256 do PIN é injetado em build via `VITE_APP_ACCESS_PIN_SHA256`.
 * Comparamos hash ↔ hash — evita ter o PIN em texto puro no bundle, mas
 * repare que *todo* `VITE_*` é público; é um obstáculo, não criptografia
 * forte. Use PIN com tamanho/charset razoável pra resistir a brute-force.
 *
 * A sessão vive em `sessionStorage`: desbloqueia 1 vez e dura enquanto a
 * aba/janela estiver aberta (fecha a aba → tem que digitar de novo).
 */

const STORAGE_KEY = 'my-finance-session'
const UNLOCKED_VALUE = '1'

function configuredHash(): string {
  return (import.meta.env.VITE_APP_ACCESS_PIN_SHA256 ?? '').trim().toLowerCase()
}

/** True quando o deploy exige PIN. Se estiver em branco, o app abre livre. */
export function isPinConfigured(): boolean {
  return configuredHash().length === 64
}

export function isSessionUnlocked(): boolean {
  if (!isPinConfigured()) return true
  try {
    return sessionStorage.getItem(STORAGE_KEY) === UNLOCKED_VALUE
  } catch {
    return false
  }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Compara timing-safe o hash do PIN digitado com o hash esperado.
 * Retorna true em caso de match e já marca a sessão como destravada.
 */
export async function tryUnlockWithPin(input: string): Promise<boolean> {
  if (!isPinConfigured()) return true
  const expected = configuredHash()
  const got = await sha256Hex(input)
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
