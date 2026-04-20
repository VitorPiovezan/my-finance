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

/** Pasta filha com o mesmo nome normalizado (ex.: mercado-pago vs Mercado Pago). */
export async function findChildFolderByNormalizedName(
  token: string,
  parentId: string,
  normalizedKey: string,
): Promise<DriveFile | null> {
  const folders = await listFolderChildren(token, parentId, {
    mimeType: 'application/vnd.google-apps.folder',
  })
  for (const f of folders) {
    if (normalizeInstitutionKey(f.name) === normalizedKey) return f
  }
  return null
}

export async function createFolderInParent(
  token: string,
  parentId: string,
  displayName: string,
): Promise<DriveFile> {
  const r = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: displayName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  })
  if (!r.ok) {
    const err = await r.text()
    throw new Error(`Drive criar pasta ${r.status}: ${err.slice(0, 240)}`)
  }
  return r.json() as Promise<DriveFile>
}

/** Garante `root/segment1/segment2/...`, criando pastas que faltem. */
export async function ensureFolderPath(
  token: string,
  rootFolderId: string,
  segments: string[],
): Promise<string> {
  let parentId = rootFolderId
  for (const seg of segments) {
    const norm = normalizeInstitutionKey(seg)
    const existing = await findChildFolderByNormalizedName(token, parentId, norm)
    if (existing) {
      parentId = existing.id
      continue
    }
    const created = await createFolderInParent(token, parentId, seg)
    parentId = created.id
  }
  return parentId
}

function concatUint8Arrays(a: Uint8Array, b: Uint8Array, c: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length + c.length)
  out.set(a, 0)
  out.set(b, a.length)
  out.set(c, a.length + b.length)
  return out
}

/** Cria um arquivo CSV novo na pasta (não sobrescreve — nome com data/hora). */
export async function uploadNewCsvFileToFolder(params: {
  token: string
  parentFolderId: string
  fileName: string
  csvText: string
}): Promise<{ id: string }> {
  const { token, parentFolderId, fileName, csvText } = params
  const boundary = `mf_csv_${Math.random().toString(36).slice(2)}_${Date.now()}`
  const enc = new TextEncoder()
  const data = enc.encode(csvText)
  const metaJson = JSON.stringify({ name: fileName, parents: [parentFolderId] })
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\n`,
  )
  const tail = enc.encode(`\r\n--${boundary}--`)
  const body = concatUint8Arrays(head, data, tail)

  const r = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: new Blob([new Uint8Array(body)]),
    },
  )
  if (!r.ok) {
    const err = await r.text()
    throw new Error(`Drive upload CSV ${r.status}: ${err.slice(0, 280)}`)
  }
  const j = (await r.json()) as { id?: string }
  if (!j.id) throw new Error('Drive não retornou id do CSV.')
  return { id: j.id }
}
