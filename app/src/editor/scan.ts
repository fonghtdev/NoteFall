import { scoreFromMusicXml } from './io'
import { joinScores, type Score } from './model'

// Scanned sheet music (desktop app only): Audiveris reads the picture, the app turns its MusicXML into a score.
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
 * Read a scanned PDF. Asks before the one-time download of Audiveris. Returns undefined when the person says no, or where scans cannot be read (the web, a tablet).
 * Shows its progress in a panel with a Cancel button; throws a readable error when the recognition fails or is cancelled.
 */
export async function scanPdf(file: File, pages: number): Promise<{ score: Score; warnings: string[] } | undefined> {
  const omr = api()
  if (!omr) return undefined
  const st = await omr.status()
  if (!st.supported) return undefined
  if (!st.installed && !confirm('PDF này là ảnh scan. Để đọc nốt từ ảnh, NoteFall cần tải bộ nhận dạng Audiveris (khoảng 85 MB, miễn phí, giấy phép AGPL). Chỉ tải một lần. Tải về bây giờ?')) return undefined
  const ui = panel(() => void omr.cancel())
  const off = omr.onProgress((p) => {
    if (p.phase === 'download') ui.show(`Đang tải bộ nhận dạng Audiveris… ${Math.round(p.ratio * 100)}%`, p.ratio, false)
    else if (p.phase === 'unpack') ui.show('Đang cài bộ nhận dạng…', undefined, false)
    else ui.show(`Đang nhận dạng trang ${p.page}/${pages}`, p.ratio)
  })
  try {
    if (!st.installed) { ui.show('Đang tải bộ nhận dạng Audiveris…', 0, false); await omr.install() }
    ui.show(`Đang nhận dạng trang 1/${pages}`, 0)
    const xml = await omr.run(new Uint8Array(await file.arrayBuffer()), pages)
    const read = xml.map((x) => scoreFromMusicXml(x))
    return { score: joinScores(read.map((r) => r.score)), warnings: ['đọc từ ảnh nên có thể sai nốt và nhịp, hãy kiểm tra lại', ...read.flatMap((r) => r.warnings)] }
  } catch (e) {
    throw new Error((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) // (Electron prefixes the main process's message)
  } finally { off(); ui.close() }
}
