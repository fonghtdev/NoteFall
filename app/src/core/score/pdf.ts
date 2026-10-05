import { readScore, type Score } from './omr'
import { extractPrims, type PagePrims } from './primitives'

/** Why a PDF gave no bars, in words for the user: a page of pictures (a scan or a photo) holds nothing to read, anything else was drawn in a way the reader does not know yet. */
export function whyUnreadable(pages: PagePrims[]): string {
  const drawn = pages.some((p) => p.glyphs.length || p.segs.length)
  return drawn
    ? 'Không đọc được bản nhạc trong PDF này: file có chữ nhạc nhưng được vẽ theo kiểu app chưa hỗ trợ (phần mềm xuất file hiếm gặp). Hãy thử file MusicXML hoặc MIDI của bài.'
    : 'PDF này là ảnh chụp hoặc bản scan nên không có nốt nào để đọc. Hãy dùng PDF xuất từ phần mềm soạn nhạc (MuseScore, LilyPond…) hoặc file MusicXML / MIDI.'
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
  if (!score.measures.length) throw new Error(whyUnreadable(pages))
  return score
}
