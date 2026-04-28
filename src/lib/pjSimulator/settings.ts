import type { Database } from 'sql.js'
import { SETTING_KEYS, getSetting, removeSetting, setSetting } from '../settings/appSettings'

export function getPjSimFaturamentoCents(db: Database): number {
  const raw = getSetting(db, SETTING_KEYS.pjSimFaturamentoCents)
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function setPjSimFaturamentoCents(db: Database, cents: number): void {
  if (!Number.isFinite(cents) || cents <= 0) {
    removeSetting(db, SETTING_KEYS.pjSimFaturamentoCents)
    return
  }
  setSetting(db, SETTING_KEYS.pjSimFaturamentoCents, String(Math.round(cents)))
}

export function getPjSimContaCents(db: Database): number {
  const raw = getSetting(db, SETTING_KEYS.pjSimContaCents)
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function setPjSimContaCents(db: Database, cents: number): void {
  if (!Number.isFinite(cents) || cents <= 0) {
    removeSetting(db, SETTING_KEYS.pjSimContaCents)
    return
  }
  setSetting(db, SETTING_KEYS.pjSimContaCents, String(Math.round(cents)))
}

export function getPjSimValorMantidoContaCents(db: Database): number {
  const raw = getSetting(db, SETTING_KEYS.pjSimValorMantidoContaCents)
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function setPjSimValorMantidoContaCents(db: Database, cents: number): void {
  if (!Number.isFinite(cents) || cents <= 0) {
    removeSetting(db, SETTING_KEYS.pjSimValorMantidoContaCents)
    return
  }
  setSetting(db, SETTING_KEYS.pjSimValorMantidoContaCents, String(Math.round(cents)))
}

/** Percentual sobre o faturamento (ex.: 6 para 6%). */
export function getPjSimImpostoPct(db: Database): number {
  const raw = getSetting(db, SETTING_KEYS.pjSimImpostoPct).replace(',', '.')
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function setPjSimImpostoPct(db: Database, pct: number): void {
  if (!Number.isFinite(pct) || pct <= 0) {
    removeSetting(db, SETTING_KEYS.pjSimImpostoPct)
    return
  }
  setSetting(db, SETTING_KEYS.pjSimImpostoPct, String(pct))
}

export function getPjSimProlaboreCents(db: Database): number {
  const raw = getSetting(db, SETTING_KEYS.pjSimProlaboreCents)
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function setPjSimProlaboreCents(db: Database, cents: number): void {
  if (!Number.isFinite(cents) || cents <= 0) {
    removeSetting(db, SETTING_KEYS.pjSimProlaboreCents)
    return
  }
  setSetting(db, SETTING_KEYS.pjSimProlaboreCents, String(Math.round(cents)))
}
