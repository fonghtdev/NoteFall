import { scoreFromMusicXml } from './io'
import { joinScores, type Score } from './model'
import * as cache from '../core/cache'

// Sheet music the PDF reader cannot read (scans, unknown engravers; desktop app only): Audiveris renders and reads the pages into MusicXML, the app opens that.
// The MusicXML is kept per file, so the same PDF opens at once the next time.
interface OmrApi {
  status(): Promise<{ supported: boolean; installed: boolean }>
  install(): Promise<void>
  run(data: Uint8Array, pages: number): Promise<string[]>
  cancel(): Promise<void>
  onProgress(cb: (p: { phase: 'download' | 'unpack' | 'read'; ratio: number; page?: number }) => void): () => void
}
const api = () => (window as unknown as { notefall?: { omr?: OmrApi } }).notefall?.omr

/** A small panel over the page while a scan is read: what it is doing, how far it is, and a button to stop. */
function panel(onCancel: () => void) {
  const box = document.createElement('div')
  box.className = 'scanbar'
  box.setAttribute('role', 'status')
  box.innerHTML = '<strong></strong><progress max="1"></progress><small>Có thể mất vài phút, bạn vẫn dùng app bình thường.</small><button type="button" class="btn ghost sm">Huỷ</button>'
  const [title, bar, , stop] = [box.querySelector('strong')!, box.querySelector('progress')!, box.querySelector('small')!, box.querySelector('button')!]
  stop.onclick = onCancel
  document.body.append(box)
  return {
    show(text: string, ratio?: number, canStop = true) { title.textContent = text; ratio === undefined ? bar.removeAttribute('value') : (bar.value = ratio); stop.disabled = !canStop },
    close() { box.remove() },
  }
}

/**
 * Pages read on their own (side by side) know their key, which every line prints again, but not the time signature, printed once at the start:
 * a part without one gets the last one of the part before it, put where MusicXML wants it (after the key) in its first bar's attributes.
 */
export function carryTime(xml: string[]): string[] {
  const out: string[] = []
  for (const x of xml) {
    const before = out.length ? out[out.length - 1].match(/<time(?:\s[^>]*)?>[\s\S]*?<\/time>/g)?.at(-1) : undefined
    if (!before || /<time[\s>]/.test(x)) { out.push(x); continue }
    const at = /<attributes>(?:(?!<\/attributes>)[\s\S])*?<\/key>/.exec(x) ?? /<attributes>[\s\S]*?<\/divisions>/.exec(x) // after the key, else after the divisions
    out.push(at ? x.slice(0, at.index + at[0].length) + before + x.slice(at.index + at[0].length)
      : x.replace(/<attributes>/, `<attributes>${before}`) !== x ? x.replace(/<attributes>/, `<attributes>${before}`) : x.replace(/(<measure[^>]*>)/, `$1<attributes>${before}</attributes>`))
  }
  return out
}

/** The pages' MusicXML as one score. */
const fromXml = (xml: string[]) => {
  const read = carryTime(xml).map((x) => scoreFromMusicXml(x))
  return { score: joinScores(read.map((r) => r.score)), warnings: ['chuyển từ PDF bằng nhận dạng ảnh nên có thể sai nốt và nhịp, hãy kiểm tra lại', ...read.flatMap((r) => r.warnings)] }
}

/**
 * Read a PDF the reader could not (a scan, an unknown engraver). Asks before the one-time download of Audiveris. Returns undefined when the person says no, or where scans cannot be read (the web, a tablet).
 * Shows its progress in a panel with a Cancel button; throws a readable error when the recognition fails or is cancelled.
 */
export async function scanPdf(file: File, pages: number): Promise<{ score: Score; warnings: string[] } | undefined> {
  const omr = api()
  if (!omr) return undefined
  const st = await omr.status()
  if (!st.supported) return undefined
  const data = new Uint8Array(await file.arrayBuffer()), key = (await cache.fileKey(data.slice().buffer)) + ':omr'
  const done = await cache.load<string[]>(key)
  if (done?.length) return fromXml(done) // converted before: no need to recognise it again
  if (!st.installed && !confirm('App không đọc trực tiếp được PDF này (ảnh scan hoặc xuất từ phần mềm lạ). Để tự chuyển nó sang MusicXML, NoteFall cần tải bộ nhận dạng Audiveris (khoảng 85 MB, miễn phí, giấy phép AGPL). Chỉ tải một lần. Tải về bây giờ?')) return undefined
  const ui = panel(() => void omr.cancel())
  const off = omr.onProgress((p) => {
    if (p.phase === 'download') ui.show(`Đang tải bộ nhận dạng Audiveris… ${Math.round(p.ratio * 100)}%`, p.ratio, false)
    else if (p.phase === 'unpack') ui.show('Đang cài bộ nhận dạng…', undefined, false)
    else ui.show(`Đang nhận dạng trang ${p.page}/${pages}`, p.ratio)
  })
  try {
    if (!st.installed) { ui.show('Đang tải bộ nhận dạng Audiveris…', 0, false); await omr.install() }
    ui.show(`Đang nhận dạng trang 1/${pages}`, 0)
    const xml = await omr.run(data, pages)
    void cache.save(key, xml)
    return fromXml(xml)
  } catch (e) {
    throw new Error((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) // (Electron prefixes the main process's message)
  } finally { off(); ui.close() }
}
