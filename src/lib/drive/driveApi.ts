export type DriveFile = {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  size?: string
}

async function driveFetch<T>(token: string, path: string): Promise<T> {
  const r = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) {
    const err = await r.text()
    throw new Error(`Drive API ${r.status}: ${err.slice(0, 200)}`)
  }
  return r.json() as Promise<T>
}

export async function listFolderChildren(
  token: string,
  folderId: string,
  opts?: { mimeType?: string; nameContains?: string; nameEquals?: string },
): Promise<DriveFile[]> {
  const parts = [`'${folderId}' in parents`, 'trashed = false']
  if (opts?.mimeType) parts.push(`mimeType = '${opts.mimeType}'`)
  if (opts?.nameContains) parts.push(`name contains '${opts.nameContains.replace(/'/g, "\\'")}'`)
  if (opts?.nameEquals) {
    const esc = opts.nameEquals.replace(/'/g, "\\'")
    parts.push(`name = '${esc}'`)
  }
  const q = encodeURIComponent(parts.join(' and '))
  const files: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const pt = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''
    const data = await driveFetch<{ files?: DriveFile[]; nextPageToken?: string }>(
      token,
      `files?q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,size)&pageSize=200${pt}`,
    )
    if (data.files) files.push(...data.files)
    pageToken = data.nextPageToken
  } while (pageToken)
  return files
}

export async function downloadFileText(token: string, fileId: string): Promise<string> {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) {
    const err = await r.text()
    throw new Error(`Download ${r.status}: ${err.slice(0, 200)}`)
  }
  return r.text()
}

/** Download binário (ex.: .sqlite). */
export async function downloadFileBytes(token: string, fileId: string): Promise<Uint8Array> {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) {
    const err = await r.text()
    throw new Error(`Download ${r.status}: ${err.slice(0, 200)}`)
  }
  const buf = await r.arrayBuffer()
  return new Uint8Array(buf)
}

export function normalizeInstitutionKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
