import { readScore, type Score } from './omr'
import { extractPrims, type PagePrims } from './primitives'

/** Nothing the reader knows in this PDF (a scan, or an engraver it cannot read yet): optical recognition can still turn its pages into MusicXML. */
export class ScanPdfError extends Error {
  constructor(message: string, readonly pages: number) { super(message) }
}
const isScan = (pages: PagePrims[]) => !pages.some((p) => p.glyphs.length || p.segs.length)

/** Why a PDF gave no bars, for when it cannot be recognised here either (the web, a tablet): a page of pictures, or an engraver the reader does not know yet. */
export function whyUnreadable(pages: PagePrims[]): string {
  return !isScan(pages)
    ? 'PDF này được xuất từ phần mềm app chưa hỗ trợ đọc trực tiếp. Bản NoteFall trên máy tính (Mac / Windows) tự chuyển nó sang MusicXML; ở đây hãy mở file MusicXML hoặc MIDI của bài.'
    : 'PDF này là ảnh chụp hoặc bản scan. Bản NoteFall trên máy tính (Mac / Windows) tự nhận dạng nó sang MusicXML; ở đây hãy mở file MusicXML hoặc MIDI của bài.'
}

/** Reads a vector sheet-music PDF. Throws a readable message when the file holds no engraved score (e.g. a scan). */
export async function readPdfScore(data: ArrayBuffer): Promise<Score> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), fontExtraProperties: true }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) pages.push(await extractPrims(await doc.getPage(i), pdfjs.OPS as unknown as Record<string, number>))
  const score = readScore(pages)
  const info = (await doc.getMetadata().catch(() => null))?.info as { Title?: string } | undefined
  const title = info?.Title?.split(' - ')[0].trim()
  if (title) score.title = title
  if (!score.measures.length) throw new ScanPdfError(whyUnreadable(pages), doc.numPages) // a scan or an engraver it cannot read: recognition turns the pages into MusicXML
  return score
}
