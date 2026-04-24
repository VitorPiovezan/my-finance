import { normalizeGoogleAccountEmail } from '../firebase/driveUserConfig'

const STORAGE_KEY = 'mf_quick_unlock_v1'
const PBKDF2_ITERATIONS = 210_000

export type QuickUnlockPayload = {
  clientId: string
  accessToken: string
  expiresAtMs: number | null
  rootFolderId: string
}

const EXPIRY_SKEW_MS = 90_000

type EnvelopeV1 = {
  v: 1
  email: string
  saltB64: string
  ivB64: string
  ctB64: string
}

function toB64(u8: Uint8Array): string {
  let s = ''
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!)
  return btoa(s)
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

/** Domínios estritos do TS 5.7+ com `Uint8Array<ArrayBufferLike>`. */
function buf(u: Uint8Array): BufferSource {
  return u as BufferSource
}

export function hasQuickUnlockEnvelope(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const p = JSON.parse(raw) as EnvelopeV1
    return p?.v === 1 && typeof p.email === 'string' && p.email.includes('@')
  } catch {
    return false
  }
}

/** E-mail associado ao envelope (só leitura; não valida PIN). */
export function getQuickUnlockStoredEmail(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as EnvelopeV1
    if (p?.v !== 1 || typeof p.email !== 'string' || !p.email.includes('@')) return null
    return p.email
  } catch {
    return null
  }
}

export function clearQuickUnlockEnvelope(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

async function deriveAesKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', buf(utf8(pin)), 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: buf(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function saveQuickUnlockEnvelope(
  email: string,
  pin: string,
  payload: {
    clientId: string
    accessToken: string
    rootFolderId: string
    expiresInSec?: number
  },
): Promise<void> {
  const norm = normalizeGoogleAccountEmail(email)
  if (!norm.includes('@')) throw new Error('E-mail inválido')
  const pinTrim = pin.trim()
  if (pinTrim.length < 4) throw new Error('PIN deve ter pelo menos 4 caracteres')

  const expiresAtMs =
    payload.expiresInSec != null &&
    Number.isFinite(payload.expiresInSec) &&
    payload.expiresInSec > 0
      ? Date.now() + payload.expiresInSec * 1000 - EXPIRY_SKEW_MS
      : null

  const full: QuickUnlockPayload = {
    clientId: payload.clientId,
    accessToken: payload.accessToken,
    rootFolderId: payload.rootFolderId,
    expiresAtMs,
  }

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveAesKey(pinTrim, salt)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = utf8(JSON.stringify(full))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, key, buf(plain)),
  )

  const env: EnvelopeV1 = {
    v: 1,
    email: norm,
    saltB64: toB64(salt),
    ivB64: toB64(iv),
    ctB64: toB64(ct),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(env))
}

export async function tryQuickUnlockWithPin(
  pin: string,
): Promise<{ email: string; payload: QuickUnlockPayload } | null> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const env = JSON.parse(raw) as EnvelopeV1
    if (env.v !== 1 || !env.email || !env.saltB64 || !env.ivB64 || !env.ctB64) return null

    const salt = fromB64(env.saltB64)
    const iv = fromB64(env.ivB64)
    const ct = fromB64(env.ctB64)
    const key = await deriveAesKey(pin.trim(), salt)
    let plain: ArrayBuffer
    try {
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(iv) }, key, buf(ct))
    } catch {
      return null
    }
    const text = new TextDecoder().decode(plain)
    const payload = JSON.parse(text) as QuickUnlockPayload
    if (
      !payload?.clientId ||
      !payload?.accessToken ||
      !payload?.rootFolderId ||
      typeof payload.clientId !== 'string'
    ) {
      return null
    }
    if (payload.expiresAtMs != null && Date.now() > payload.expiresAtMs) {
      return null
    }
    return { email: env.email, payload }
  } catch {
    return null
  }
}
