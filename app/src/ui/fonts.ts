import { CATALOG, addFont, downloadFont, listFonts, loadSoundFont, removeFont, setPreset, type FontInfo } from '../core/soundfonts'

const mb = (n: number) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e }

const plain = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
/** Positions of the names that hold every word of the query (accents and case do not matter); all of them for an empty query. */
export const filterPresets = (names: string[], query: string): number[] => {
  const words = plain(query).split(/\s+/).filter(Boolean)
  return names.flatMap((n, i) => (words.every((w) => plain(n).includes(w)) ? [i] : []))
}
const SEARCH_FROM = 12 // a short list needs no search

/**
 * The "Thư viện đàn" dialog: install a SoundFont from a file or from the free list, pick which instrument of it plays, remove it.
 * `changed(use, remake)` tells the page the list changed: `use` is a voice to switch to, `remake` that the piano sound has to be rendered again.
 */
export function initFontsDialog(changed: (use?: string, remake?: boolean) => void, current: () => string) {
  const dlg = document.getElementById('dlg-fonts') as HTMLDialogElement
  const installed = document.getElementById('fonts-installed')!, catalog = document.getElementById('fonts-catalog')!, status = document.getElementById('fonts-status')!
  const say = (t: string, warn = false) => { status.textContent = t; status.classList.toggle('warn', warn) }

  const drawInstalled = () => {
    installed.replaceChildren()
    const fonts = listFonts()
    if (!fonts.length) installed.append(el('p', 'hint', 'Chưa có thư viện nào. Nạp một file .sf2 hoặc tải một bộ miễn phí bên dưới.'))
    for (const f of fonts) installed.append(installedRow(f))
  }
  const installedRow = (f: FontInfo) => {
    const row = el('div', 'font-row'), info = el('div', 'font-info')
    info.append(el('strong', '', f.name), el('span', 'hint', mb(f.size)))
    const sel = el('select', 'field'); sel.setAttribute('aria-label', `Tiếng đàn trong ${f.name}`)
    const pick = el('div', 'font-pick'), search = el('input', 'field'); search.type = 'search'; search.placeholder = 'Tìm tiếng đàn…'; search.setAttribute('aria-label', `Tìm tiếng đàn trong ${f.name}`)
    let names: string[] = [], plainNames: string[] = [], chosen = 0
    const list = () => { // only the instruments that match the search; the one in use stays in view while the search is empty
      const hits = filterPresets(names, search.value)
      sel.replaceChildren(...(hits.length ? hits.map((i) => new Option(names[i], String(i))) : [new Option('Không có tiếng đàn nào khớp', '')]))
      sel.disabled = !hits.length
      if (hits.includes(chosen)) sel.value = String(chosen)
    }
    void loadSoundFont(f.id).then((lib) => {
      if (!lib) { sel.replaceChildren(new Option('(file đã mất, hãy nạp lại)', '')); sel.disabled = true; return }
      plainNames = lib.font.presets.map((p) => p.name)
      names = lib.font.presets.map((p) => `${p.name}${p.bank ? ` (ngân hàng ${p.bank})` : ''}`)
      chosen = lib.preset
      list()
      if (names.length >= SEARCH_FROM) pick.prepend(search)
    })
    search.oninput = list
    sel.onchange = () => { chosen = +sel.value; setPreset(f.id, chosen, plainNames[chosen]); changed(undefined, current() === `sf2:${f.id}`) }
    pick.append(sel)
    const use = el('button', 'btn sm primary', 'Dùng'); use.type = 'button'; use.onclick = () => { changed(`sf2:${f.id}`, true); dlg.close() }
    const del = el('button', 'btn sm ghost', 'Xoá'); del.type = 'button'
    del.onclick = async () => { const inUse = current() === `sf2:${f.id}`; await removeFont(f.id); drawInstalled(); drawCatalog(); changed(inUse ? 'crystal' : undefined, inUse); say(`Đã xoá ${f.name}`) }
    row.append(info, pick, use, del)
    return row
  }

  const drawCatalog = () => {
    catalog.replaceChildren()
    for (const e of CATALOG) {
      const row = el('div', 'font-row'), info = el('div', 'font-info')
      info.append(el('strong', '', e.name), el('span', 'hint', `${mb(e.size)} · ${e.note}`))
      const have = listFonts().some((f) => f.id === e.id)
      const btn = el('button', 'btn sm', have ? 'Đã cài' : 'Tải về'); btn.type = 'button'; btn.disabled = have
      btn.onclick = async () => {
        btn.disabled = true
        try {
          await downloadFont(e, (p) => { btn.textContent = `${Math.round(p * 100)}%` })
          say(`Đã cài ${e.name}`); drawInstalled(); drawCatalog(); changed()
        } catch (err) { btn.disabled = false; btn.textContent = 'Tải về'; say(`Không tải được ${e.name}: ${err instanceof Error ? err.message : err}`, true) }
      }
      row.append(info, btn)
      catalog.append(row)
    }
  }

  const file = document.getElementById('fonts-file') as HTMLInputElement
  file.onchange = async () => {
    const f = file.files?.[0]; file.value = ''
    if (!f) return
    say(`Đang đọc ${f.name}…`)
    try { const info = await addFont(await f.arrayBuffer(), f.name); say(`Đã cài ${info.name}`); drawInstalled(); changed() }
    catch (err) { say(err instanceof Error ? err.message : 'Không đọc được file', true) }
  }
  document.getElementById('fonts-pick')!.onclick = () => file.click()
  document.getElementById('btn-fonts')!.onclick = () => { say(''); drawInstalled(); drawCatalog(); dlg.showModal() }
}
