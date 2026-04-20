import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { extractDriveFolderId } from '../settings/driveFolder'
import { getFirebaseDb } from './init'

/** Mesmo nome da coleção em `firestore.rules`. */
export const DRIVE_USER_CONFIGS_COLLECTION = 'drive_user_configs'

export function normalizeGoogleAccountEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export type DriveUserPublicConfig = {
  clientId: string
  driveRootFolderId: string
  updatedAt?: unknown
}

const PENDING_REG_KEY = 'mf_pending_drive_reg'

export type PendingDriveRegistration = {
  clientId: string
  driveRootFolderId: string
}

export function savePendingDriveRegistration(data: PendingDriveRegistration): void {
  try {
    window.localStorage.setItem(PENDING_REG_KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

export function loadPendingDriveRegistration(): PendingDriveRegistration | null {
  try {
    const raw = window.localStorage.getItem(PENDING_REG_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as PendingDriveRegistration
    if (!p?.clientId?.trim() || !p?.driveRootFolderId?.trim()) return null
    return {
      clientId: p.clientId.trim(),
      driveRootFolderId: p.driveRootFolderId.trim(),
    }
  } catch {
    return null
  }
}

export function clearPendingDriveRegistration(): void {
  try {
    window.localStorage.removeItem(PENDING_REG_KEY)
  } catch {
    /* ignore */
  }
}

export async function fetchDriveUserConfigByEmail(
  email: string,
): Promise<DriveUserPublicConfig | null> {
  const norm = normalizeGoogleAccountEmail(email)
  if (!norm.includes('@')) return null
  const snap = await getDoc(doc(getFirebaseDb(), DRIVE_USER_CONFIGS_COLLECTION, norm))
  if (!snap.exists()) return null
  const d = snap.data() as Partial<DriveUserPublicConfig>
  const clientId = typeof d.clientId === 'string' ? d.clientId.trim() : ''
  const driveRootFolderId =
    typeof d.driveRootFolderId === 'string' ? d.driveRootFolderId.trim() : ''
  if (!clientId || !driveRootFolderId) return null
  return { clientId, driveRootFolderId, updatedAt: d.updatedAt }
}

export async function writeDriveUserConfigForSignedInUser(params: {
  email: string
  clientId: string
  driveRootFolderId: string
}): Promise<void> {
  const norm = normalizeGoogleAccountEmail(params.email)
  await setDoc(
    doc(getFirebaseDb(), DRIVE_USER_CONFIGS_COLLECTION, norm),
    {
      clientId: params.clientId.trim(),
      driveRootFolderId: extractDriveFolderId(params.driveRootFolderId),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}
