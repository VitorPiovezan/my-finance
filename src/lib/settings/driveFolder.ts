const LS_KEY = 'my_finance_drive_root_folder_id'

/** Aceita só o ID ou a URL completa do Drive (cole o link da pasta). */
export function extractDriveFolderId(raw: string): string {
  const s = raw.trim()
  const fromPath = s.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (fromPath?.[1]) return fromPath[1]
  const fromQuery = s.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (fromQuery?.[1]) return fromQuery[1]
  return s
}

export function isLikelyDriveFolderId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{10,128}$/.test(id.trim())
}

export function getDriveRootFolderId(): string {
  const fromLs = (typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY)) || ''
  const fromEnv = (import.meta.env.VITE_DRIVE_FINANCE_ROOT_FOLDER_ID ?? '').trim()
  return extractDriveFolderId(fromLs || fromEnv)
}

export function setDriveRootFolderId(id: string): void {
  localStorage.setItem(LS_KEY, extractDriveFolderId(id))
}
