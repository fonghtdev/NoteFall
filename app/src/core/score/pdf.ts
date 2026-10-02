import { readScore, type Score } from './omr'
import { extractPrims } from './primitives'

/** Reads a vector sheet-music PDF. Throws a readable message when the file holds no engraved score (e.g. a scan). */
export async function readPdfScore(data: ArrayBuffer): Promise<Score> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) pages.push(await extractPrims(await doc.getPage(i), pdfjs.OPS as unknown as Record<string, number>))
  const score = readScore(pages)
  const info = (await doc.getMetadata().catch(() => null))?.info as { Title?: string } | undefined
  const title = info?.Title?.split(' - ')[0].trim()
  if (title) score.title = title
  if (!score.measures.length) throw new Error('Không tìm thấy bản nhạc dạng vector trong PDF này (ảnh scan hoặc kiểu chữ nhạc khác chưa được hỗ trợ).')
  return score
}
