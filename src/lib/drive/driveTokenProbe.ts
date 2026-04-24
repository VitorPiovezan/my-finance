/**
 * Confere na própria Drive API se o token lê a pasta raiz (evita token só Firebase/profile
 * que quebraria sync/backup sem abrir o segundo OAuth quando necessário).
 */
export async function driveAccessTokenWorksForFolder(
  accessToken: string,
  folderId: string,
): Promise<boolean> {
  const t = accessToken.trim()
  const id = folderId.trim()
  if (!t || !id) return false
  try {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id`,
      { headers: { Authorization: `Bearer ${t}` } },
    )
    return r.ok
  } catch {
    return false
  }
}
