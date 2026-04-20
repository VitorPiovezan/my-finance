import { downloadFileBytes, listFolderChildren, type DriveFile } from './driveApi'

/** Nome fixo do backup na pasta raiz configurada (mesmo arquivo é atualizado ao reenviar). */
export const SQLITE_DRIVE_BACKUP_NAME = 'my-finance.sqlite'

function concatUint8Arrays(a: Uint8Array, b: Uint8Array, c: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length + c.length)
  out.set(a, 0)
  out.set(b, a.length)
  out.set(c, a.length + b.length)
  return out
}

/** Procura o arquivo de backup na pasta raiz (nome exato). */
export async function findSqliteBackupFile(
  token: string,
  rootFolderId: string,
  fileName: string = SQLITE_DRIVE_BACKUP_NAME,
): Promise<DriveFile | null> {
  const files = await listFolderChildren(token, rootFolderId, { nameEquals: fileName })
  if (files.length === 0) return null
  if (files.length === 1) return files[0] ?? null
  return files.sort((a, b) => {
    const ta = a.modifiedTime ? Date.parse(a.modifiedTime) : 0
    const tb = b.modifiedTime ? Date.parse(b.modifiedTime) : 0
    return tb - ta
  })[0]!
}

/**
 * Cria ou substitui o .sqlite na pasta. Se já existir arquivo com o mesmo nome, atualiza o conteúdo.
 */
export async function uploadSqliteBackupToDrive(params: {
  token: string
  rootFolderId: string
  data: Uint8Array
  fileName?: string
}): Promise<{ fileId: string; created: boolean }> {
  const { token, rootFolderId, data } = params
  const fileName = params.fileName ?? SQLITE_DRIVE_BACKUP_NAME
  const existing = await findSqliteBackupFile(token, rootFolderId, fileName)

  const boundary = `mf_${Math.random().toString(36).slice(2)}_${Date.now()}`
  const enc = new TextEncoder()

  if (existing) {
    const metaJson = JSON.stringify({})
    const head = enc.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: application/x-sqlite3\r\n\r\n`,
    )
    const tail = enc.encode(`\r\n--${boundary}--`)
    const body = concatUint8Arrays(head, data, tail)

    const r = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}?uploadType=multipart&fields=id,name,modifiedTime`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: new Blob([new Uint8Array(body)]),
      },
    )
    if (!r.ok) {
      const err = await r.text()
      throw new Error(`Drive upload (atualizar) ${r.status}: ${err.slice(0, 280)}`)
    }
    return { fileId: existing.id, created: false }
  }

  const metaJson = JSON.stringify({ name: fileName, parents: [rootFolderId] })
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: application/x-sqlite3\r\n\r\n`,
  )
  const tail = enc.encode(`\r\n--${boundary}--`)
  const body = concatUint8Arrays(head, data, tail)

  const r = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime',
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
    throw new Error(`Drive upload (criar) ${r.status}: ${err.slice(0, 280)}`)
  }
  const j = (await r.json()) as { id?: string }
  if (!j.id) throw new Error('Drive não retornou id do arquivo.')
  return { fileId: j.id, created: true }
}

/** Baixa o conteúdo binário do backup no Drive. */
export async function downloadSqliteBackupBytes(
  token: string,
  rootFolderId: string,
  fileName: string = SQLITE_DRIVE_BACKUP_NAME,
): Promise<{ bytes: Uint8Array; file: DriveFile }> {
  const file = await findSqliteBackupFile(token, rootFolderId, fileName)
  if (!file) {
    throw new Error(
      `Não há "${fileName}" na pasta raiz. Envie um backup pelo app antes ou verifique o nome.`,
    )
  }
  const bytes = await downloadFileBytes(token, file.id)
  return { bytes, file }
}
