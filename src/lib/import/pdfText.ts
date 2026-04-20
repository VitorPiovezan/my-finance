import * as pdfjs from 'pdfjs-dist'
import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api'

/** Worker do pdf.js (Vite resolve o asset). */
function setWorkerSrc(): void {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
}

/** Junta itens respeitando quebra de linha do PDF (hasEOL). */
function pageTextFromHasEol(items: TextContent['items']): string {
  const chunks: string[] = []
  for (const it of items) {
    if (!('str' in it)) continue
    const ti = it as TextItem
    const s = ti.str
    if (!s) continue
    chunks.push(s)
    if (ti.hasEOL) chunks.push('\n')
    else chunks.push(' ')
  }
  return chunks.join('').replace(/[ \t]+/g, ' ').replace(/ \n/g, '\n')
}

/**
 * Alguns PDFs de banco não marcam hasEOL; agrupa por baseline Y (linhas da tabela).
 */
function pageTextFromBaselineY(items: TextContent['items']): string {
  const rows: { y: number; x: number; str: string }[] = []
  for (const it of items) {
    if (!('str' in it)) continue
    const ti = it as TextItem
    const t = ti.transform
    if (!t || t.length < 6) continue
    const str = ti.str.trim()
    if (!str) continue
    rows.push({ x: t[4], y: t[5], str })
  }
  if (rows.length === 0) return ''
  rows.sort((a, b) => b.y - a.y || a.x - b.x)
  const lineThreshold = 8
  const lines: string[] = []
  let cur: string[] = []
  let lineY: number | null = null
  for (const r of rows) {
    if (lineY === null || Math.abs(r.y - lineY) <= lineThreshold) {
      cur.push(r.str)
      lineY = lineY === null ? r.y : lineY
    } else {
      lines.push(cur.join(' '))
      cur = [r.str]
      lineY = r.y
    }
  }
  if (cur.length) lines.push(cur.join(' '))
  return lines.join('\n')
}

function pageToText(tc: TextContent): string {
  const items = tc.items
  const textItems = items.filter((it): it is TextItem => 'str' in it)
  const withEol = pageTextFromHasEol(items)
  const newlines = (withEol.match(/\n/g) || []).length
  /** Poucas quebras mas muitos fragmentos → layout em coluna sem hasEOL (comum em faturas). */
  if (newlines < 3 && textItems.length > 18) {
    return pageTextFromBaselineY(items)
  }
  return withEol
}

/**
 * Extrai texto do PDF (hasEOL + fallback por coordenada Y para tabelas de banco).
 */
export async function extractPdfText(file: File): Promise<string> {
  setWorkerSrc()
  const data = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data }).promise
  const parts: string[] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const tc = await page.getTextContent()
    parts.push(pageToText(tc))
  }
  return parts.join('\n\n')
}
