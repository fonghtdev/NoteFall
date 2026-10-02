import { icon, type IconName } from '../ui/icons'
import { popover } from '../ui/popover'
import { renderNotes } from '../core/synth'
import { toNotes, unroll } from '../core/score/playback'
import { hitTest, keyAlter, type Hit } from './hit'
import {
  STEPS, TPQ, barTicks, contextAt, deleteEv, deleteMeasure, diatonic, emptyScore, findEv, fromDiatonic, insertMeasure, putNote, putRest,
  TUPLETS, makeTuplet, navigationProblems, pruneRefs, setJump, setVolta, toggleMark, type Mark, putInTuplet, removeTuplet, setDyn, setKey, setLength, setTime, starts, toggleArt, toggleSpan, toggleTie, transpose, validate, type Art, type Dyn, type Pitch, type Score,
} from './model'
import { toPerformance } from './perform'
import { keyName, renderScore, type Layout } from './render'
import { exportMidi, exportMusicXml, exportPdf, importFile, saveJson } from './io'

export interface ComposerHooks { toFalling(score: Score): void | Promise<void> }

const DRAFT = 'notefall.draft'
const LOGICAL_WIDTH = 1000
const DURATIONS: [string, string, number][] = [
  ['1', 'Móc 4 (1/64)', TPQ / 16], ['2', 'Móc 3 (1/32)', TPQ / 8], ['3', 'Móc kép (1/16)', TPQ / 4], ['4', 'Móc đơn (1/8)', TPQ / 2],
  ['5', 'Đen (1/4)', TPQ], ['6', 'Trắng (1/2)', 2 * TPQ], ['7', 'Tròn (1/1)', 4 * TPQ],
]
const TIME_SIGS = ['2/4', '3/4', '4/4', '5/4', '6/4', '2/2', '3/8', '6/8', '9/8', '12/8']

type Mode = 'select' | 'input'

export class Composer {
  score: Score
  layout!: Layout
  sel?: number               // selected event id (the one the keyboard moves)
  range: number[] = []       // all selected events (Shift+click extends), in score order
  mode: Mode = 'select'
  dur = TPQ
  dotted = false
  voice = 0
  cursor = { m: 0, staff: 0, at: 0 }
  pendingAlter?: number      // accidental chosen before entering the next note
  private lastD = 35
  private lastPlaced?: { m: number; staff: number; voice: number; at: number; ticks: number }
  private undoStack: string[] = []
  private redoStack: string[] = []
  private host!: HTMLDivElement
  private ghost?: SVGEllipseElement
  private status!: HTMLElement
  private playing?: AudioBufferSourceNode
  private ctx?: AudioContext
  private btns = new Map<string, HTMLButtonElement>()

  constructor(private root: HTMLElement, private hooks: ComposerHooks) {
    this.score = this.loadDraft() ?? emptyScore(8)
    this.buildUi()
    document.addEventListener('keydown', (e) => this.onKey(e))
    this.refresh()
  }

  // ---- state helpers -----------------------------------------------------------------------------------
  get ticks() { return this.dotted ? this.dur * 1.5 : this.dur }
  get bar() { return barTicks(contextAt(this.score, this.cursor.m).time) }
  get visible() { return !this.root.hidden }

  /** What a mark applies to: the whole selection, or the single selected event. */
  targets(): number[] { return this.range.length ? this.range : this.sel === undefined ? [] : [this.sel] }

  /** The bars the navigation buttons act on: those of the selected notes, otherwise the bar of the cursor. */
  measureRange(): [number, number] {
    const bars = this.targets().map((id) => findEv(this.score, id)?.m).filter((m): m is number => m !== undefined)
    return bars.length ? [Math.min(...bars), Math.max(...bars)] : [Math.min(this.cursor.m, this.score.measures.length - 1), Math.min(this.cursor.m, this.score.measures.length - 1)]
  }

  private checkNavigation() {
    const p = navigationProblems(this.score)
    if (p.length) this.say('⚠ ' + p.join(' · '))
  }

  ending(nums?: number[]) { const [a, b] = this.measureRange(); this.commit((s) => setVolta(s, a, b, nums)) }
  /** Segno and Coda sit at the start of the first selected bar; Fine and To Coda act at the end of the last one. */
  mark(k: Mark) { const [a, b] = this.measureRange(); this.commit((s) => toggleMark(s, k === 'segno' || k === 'coda' ? a : b, k)); this.checkNavigation() }
  jump(j?: { kind: 'dc' | 'ds'; al: 'end' | 'fine' | 'coda' }) { const [, b] = this.measureRange(); this.commit((s) => setJump(s, b, j)); this.checkNavigation() }

  /** All events of one staff+voice in playing order. */
  private voiceEvents(staff: number, voice: number) {
    return this.score.measures.flatMap((m) => m.staves[staff]?.[voice] ?? [])
  }

  /** Select from the current event to `id` (same staff and voice). */
  selectRange(id: number) {
    const a = this.sel !== undefined ? findEv(this.score, this.sel) : undefined, b = findEv(this.score, id)
    if (!a || !b || a.staff !== b.staff || a.voice !== b.voice) { this.sel = id; this.range = []; return }
    const all = this.voiceEvents(a.staff, a.voice).map((e) => e.id)
    const i = all.indexOf(this.sel!), j = all.indexOf(id)
    this.range = all.slice(Math.min(i, j), Math.max(i, j) + 1)
  }

  /** Run an edit as one undo step. */
  commit(edit: (s: Score) => void) {
    const before = JSON.stringify(this.score)
    edit(this.score)
    pruneRefs(this.score)
    if (validate(this.score).length) { this.score = JSON.parse(before) as Score; this.say('Thao tác bị huỷ vì làm lệch nhịp'); return }
    this.undoStack.push(before)
    if (this.undoStack.length > 200) this.undoStack.shift()
    this.redoStack = []
    this.refresh()
  }
  undo() { this.step(this.undoStack, this.redoStack) }
  redo() { this.step(this.redoStack, this.undoStack) }
  private step(from: string[], to: string[]) {
    const prev = from.pop()
    if (!prev) return
    to.push(JSON.stringify(this.score))
    this.score = JSON.parse(prev) as Score
    if (this.sel !== undefined && !findEv(this.score, this.sel)) this.sel = undefined
    this.refresh()
  }

  setScore(s: Score) {
    this.score = s
    this.undoStack = []; this.redoStack = []
    this.sel = undefined; this.range = []
    this.cursor = { m: 0, staff: 0, at: 0 }
    this.refresh()
  }

  say(t: string, warn = false) { this.status.textContent = t; this.status.classList.toggle('warn', warn || t.startsWith('⚠')) }

  private loadDraft(): Score | undefined {
    try { const s = JSON.parse(localStorage.getItem(DRAFT) ?? 'null') as Score | null; if (s?.measures?.length && !validate(s).length) return s } catch { /* ignore */ }
  }
  private saveDraft() { try { localStorage.setItem(DRAFT, JSON.stringify(this.score)) } catch { /* ignore */ } }

  // ---- drawing -----------------------------------------------------------------------------------------
  refresh() {
    const keep = this.root.querySelector('.cmp-page')?.scrollTop ?? 0
    this.layout = renderScore(this.host, this.score, { width: LOGICAL_WIDTH, selected: new Set(this.targets()) })
    const page = this.root.querySelector('.cmp-page')
    if (page) page.scrollTop = keep
    this.drawBarHighlight()
    this.drawCursor()
    this.syncToolbar()
    this.saveDraft()
  }

  private svg() { return this.host.querySelector('svg')! }

  /** A faint band behind the bars the navigation buttons will act on. */
  private drawBarHighlight() {
    const [a, b] = this.measureRange()
    for (let i = a; i <= b; i++) {
      const dm = this.layout.measures[i]
      if (!dm) continue
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      const y0 = dm.staves[0].top - 24, y1 = dm.staves[dm.staves.length - 1].bottom + 14
      r.setAttribute('x', String(dm.x)); r.setAttribute('y', String(y0)); r.setAttribute('width', String(dm.w)); r.setAttribute('height', String(y1 - y0))
      r.setAttribute('fill', '#1d6fff'); r.setAttribute('opacity', '0.06'); r.setAttribute('pointer-events', 'none')
      this.svg().insertBefore(r, this.svg().firstChild)
    }
  }

  private cursorX(): { x: number; y0: number; y1: number } | undefined {
    const dm = this.layout.measures[this.cursor.m]
    if (!dm) return
    const st = dm.staves[this.cursor.staff]
    const ev = dm.evs.find((e) => e.staff === this.cursor.staff && e.voice === this.voice && e.at === this.cursor.at)
    const x = ev ? ev.x : dm.x + dm.w - 8
    return { x, y0: st.top - 10, y1: st.bottom + 10 }
  }

  private drawCursor() {
    if (this.mode !== 'input') return
    const c = this.cursorX()
    if (!c) return
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    l.setAttribute('x', String(c.x - 9)); l.setAttribute('y', String(c.y0)); l.setAttribute('width', '2'); l.setAttribute('height', String(c.y1 - c.y0))
    l.setAttribute('fill', '#1d6fff'); l.setAttribute('opacity', '0.8'); l.setAttribute('pointer-events', 'none')
    this.svg().appendChild(l)
  }

  // ---- input from the mouse ----------------------------------------------------------------------------
  private toLogical(e: MouseEvent): [number, number] {
    const r = this.svg().getBoundingClientRect()
    return [((e.clientX - r.left) * this.layout.width) / r.width, ((e.clientY - r.top) * this.layout.width) / r.width]
  }

  /** A click in score coordinates (also used by tests). */
  click(x: number, y: number, mods: { shift?: boolean; alt?: boolean } = {}) {
    const hit = hitTest(this.layout, x, y, this.voice)
    if (!hit) { if (this.mode === 'select') { this.sel = undefined; this.range = []; this.refresh() } return }
    this.cursor = { m: hit.m, staff: hit.staff, at: hit.at }
    if (this.mode === 'input' && !mods.alt) { this.enterAt(hit, mods.shift ?? false); return }
    const near = hit.ev && Math.abs(hit.ev.x - x) < 28 ? hit.ev : undefined
    if (near && mods.shift && this.sel !== undefined) this.selectRange(near.id)
    else { this.sel = near?.id; this.range = [] }
    this.refresh()
    if (near) this.say(this.describe(near.id))
  }

  private pitchAt(m: number, d: number): Pitch {
    const { key } = contextAt(this.score, m)
    const p = fromDiatonic(d)
    p.alter = this.pendingAlter ?? keyAlter(key, p.step)
    return p
  }

  private enterAt(hit: Hit, chord: boolean) {
    const p = this.pitchAt(hit.m, hit.diatonic)
    this.pendingAlter = undefined
    this.place(hit.m, hit.staff, this.voice, hit.at, p, chord)
  }

  /** Put a note and move the cursor behind it (the bar after the last one is appended on demand). */
  private place(m: number, staff: number, voice: number, at: number, p: Pitch, chord: boolean) {
    const evs = this.score.measures[m]?.staves[staff]?.[voice] ?? []
    const member = evs[starts(evs).indexOf(at)]
    if (member?.tup && !(chord && this.lastPlaced)) { // a tuplet member keeps its own length
      this.commit((s) => putInTuplet(s, member.id, p, false))
      this.lastPlaced = { m, staff, voice, at, ticks: member.ticks }
      this.lastD = diatonic(p); this.sel = member.id; this.range = []
      if (!chord) this.advance(m, staff, at + member.ticks)
      this.refresh()
      return
    }
    const ticks = this.ticks
    let id = 0
    let end = at
    this.commit((s) => {
      const where = chord && this.lastPlaced ? this.lastPlaced : { m, staff, voice, at, ticks }
      id = putNote(s, where, where.at, where.ticks, p, chord && !!this.lastPlaced)
      const f = findEv(s, id)
      end = where.at + (f?.ev.ticks ?? ticks)
      if (!chord || !this.lastPlaced) this.lastPlaced = { m, staff, voice, at, ticks: f?.ev.ticks ?? ticks }
    })
    this.lastD = diatonic(p)
    this.sel = id
    if (!chord) this.advance(m, staff, end)
    this.refresh()
  }

  private advance(m: number, staff: number, at: number) {
    const bar = barTicks(contextAt(this.score, m).time)
    if (at >= bar) {
      if (m + 1 >= this.score.measures.length) this.commit((s) => insertMeasure(s, s.measures.length - 1))
      this.cursor = { m: m + 1, staff, at: 0 }
    } else this.cursor = { m, staff, at }
  }

  // ---- keyboard ----------------------------------------------------------------------------------------
  private onKey(e: KeyboardEvent) {
    if (!this.visible) return
    const t = e.target as HTMLElement
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
    const k = e.key
    const mod = e.ctrlKey || e.metaKey
    let used = true
    if (mod && k.toLowerCase() === 'z') e.shiftKey ? this.redo() : this.undo()
    else if (mod && k.toLowerCase() === 'y') this.redo()
    else if (mod && k === '3') this.tuplet()
    else if (mod) used = false
    else if (/^[1-7]$/.test(k)) this.setDuration(+k - 1)
    else if (k === '.') { this.dotted = !this.dotted; this.afterToolChange() }
    else if (/^[a-gA-G]$/.test(k)) this.letter(k.toUpperCase(), e.shiftKey)
    else if (k.toLowerCase() === 'n') this.setMode(this.mode === 'input' ? 'select' : 'input')
    else if (k.toLowerCase() === 'r') this.rest()
    else if (k.toLowerCase() === 't') this.tie()
    else if (k.toLowerCase() === 's') this.slur()
    else if (k === 'ArrowUp' || k === 'ArrowDown') this.vertical(k === 'ArrowUp' ? 1 : -1, e.shiftKey ? 12 : 1, e.altKey)
    else if (k === 'ArrowLeft' || k === 'ArrowRight') this.horizontal(k === 'ArrowRight' ? 1 : -1)
    else if (k === 'Delete' || k === 'Backspace') this.del()
    else if (k === 'Escape') { this.sel = undefined; this.range = []; this.setMode('select') }
    else if (k === '+' || k === '=') this.accidental(1)
    else if (k === '-') this.accidental(-1)
    else if (k === ' ') void this.togglePlay()
    else used = false
    if (used) e.preventDefault()
  }

  /** Test hook / programmatic key press. */
  key(k: string, opts: Partial<KeyboardEventInit> = {}) {
    this.onKey(new KeyboardEvent('keydown', { key: k, cancelable: true, ...opts }))
  }

  setDuration(i: number) {
    this.dur = DURATIONS[i][2]
    if (this.sel !== undefined && this.mode === 'select') {
      const id = this.sel
      this.commit((s) => setLength(s, id, this.ticks))
    } else this.afterToolChange()
  }
  private afterToolChange() {
    if (this.sel !== undefined && this.mode === 'select') { const id = this.sel; this.commit((s) => setLength(s, id, this.ticks)) } else this.refresh()
  }

  setMode(m: Mode) {
    this.mode = m
    this.refresh()
    this.say(m === 'input' ? 'Nhập nốt: bấm vào khuông hoặc gõ A–G (Shift = thêm vào hợp âm, R = dấu lặng, N hoặc Esc để thoát)' : 'Chọn: bấm vào nốt để chọn, ↑↓ đổi cao độ, Delete xoá')
  }

  /** The letter keys: enter a note at the cursor (input mode) or respell the selected note. */
  letter(letter: string, chord: boolean) {
    const idx = STEPS.indexOf(letter as never)
    if (this.mode === 'input') {
      const m = this.cursor.m
      const base = this.lastD
      let best = idx, bd = Infinity
      for (let oct = 0; oct <= 8; oct++) { const d = oct * 7 + idx; if (Math.abs(d - base) < bd) { bd = Math.abs(d - base); best = d } }
      const p = this.pitchAt(m, best)
      this.pendingAlter = undefined
      this.place(m, this.cursor.staff, this.voice, this.cursor.at, p, chord)
    } else if (this.sel !== undefined) {
      const f = findEv(this.score, this.sel)
      if (!f || f.ev.pitches.length !== 1) return
      const old = diatonic(f.ev.pitches[0])
      let best = idx, bd = Infinity
      for (let oct = 0; oct <= 8; oct++) { const d = oct * 7 + idx; if (Math.abs(d - old) < bd) { bd = Math.abs(d - old); best = d } }
      const id = this.sel
      this.commit((s) => { const g = findEv(s, id)!; g.ev.pitches = [this.pitchAt(g.m, best)] })
      this.pendingAlter = undefined
    }
  }

  rest() {
    if (this.mode === 'input') {
      const { m, staff, at } = this.cursor
      this.commit((s) => putRest(s, { m, staff, voice: this.voice }, at, this.ticks))
      this.advance(m, staff, at + Math.min(this.ticks, this.bar - at))
      this.refresh()
    } else if (this.sel !== undefined) { const id = this.sel; this.commit((s) => deleteEv(s, id)) }
  }

  ornament(kind: 'mordent' | 'inverted') {
    if (this.sel === undefined) { this.say('Chọn một nốt trước'); return }
    const id = this.sel
    this.commit((s) => { const f = findEv(s, id); if (f && f.ev.pitches.length) f.ev.orn = f.ev.orn === kind ? undefined : kind })
  }

  /** Make a tuplet of the current note length where the cursor / selected note is, then type its notes. */
  tuplet() {
    const sel = this.sel !== undefined ? findEv(this.score, this.sel) : undefined
    const loc = sel ? { m: sel.m, staff: sel.staff, voice: sel.voice, at: sel.at } : { m: this.cursor.m, staff: this.cursor.staff, voice: this.voice, at: this.cursor.at }
    const t = TUPLETS[+(this.root.querySelector<HTMLSelectElement>('#cmp-tup')?.value ?? 0)]
    let ids: number[] = []
    this.commit((s) => { ids = makeTuplet(s, loc, loc.at, this.dur, t.n, t.m) })
    if (!ids.length) { this.say(`Không đủ chỗ trong ô nhịp cho ${t.n}:${t.m} ở độ dài này`); return }
    this.cursor = { m: loc.m, staff: loc.staff, at: loc.at }
    this.sel = ids[0]; this.range = []
    this.setMode('input')
    this.say(`${t.label}: gõ ${t.n} nốt (A–G) hoặc bấm vào khuông`)
  }

  unTuplet() { if (this.sel !== undefined) { const id = this.sel; this.commit((s) => removeTuplet(s, id)) } }

  dynamic(d?: Dyn) {
    const ids = this.targets()
    if (!ids.length) { this.say('Chọn một nốt trước'); return }
    this.commit((s) => setDyn(s, ids[0], d))
  }

  /** Hairpin or slur over the selected notes (first to last). */
  span(kind: 'slur' | 'cresc' | 'dim') {
    const ids = this.targets()
    if (ids.length < 2) { this.say('Giữ Shift và bấm nốt cuối để chọn cả đoạn, rồi bấm lại') ; return }
    let ok = false
    this.commit((s) => { ok = toggleSpan(s, kind, ids[0], ids[ids.length - 1]) })
    if (!ok) this.say('Chỉ nối được các nốt cùng khuông và cùng giọng')
  }
  slur() { this.span('slur') }

  articulate(a: Art) {
    const ids = this.targets()
    if (!ids.length) { this.say('Chọn một nốt trước'); return }
    this.commit((s) => ids.forEach((id) => toggleArt(s, id, a)))
  }

  tie() { if (this.sel !== undefined) { const id = this.sel; this.commit((s) => toggleTie(s, id)) } }

  del() {
    if (this.sel === undefined) return
    const id = this.sel
    this.commit((s) => deleteEv(s, id))
  }

  /** ↑/↓: semitone (Shift: octave); with Alt: switch staff instead. */
  private vertical(dir: number, amount: number, alt: boolean) {
    if (alt) { this.cursor.staff = Math.max(0, Math.min(this.score.clefs.length - 1, this.cursor.staff - dir)); this.refresh(); return }
    if (this.sel === undefined) return
    const id = this.sel
    this.commit((s) => transpose(s, id, dir * amount))
  }

  /** ←/→: move to the previous/next event of the same voice (in input mode: move the insertion cursor). */
  private horizontal(dir: number) {
    const voiceEvents = (m: number, staff: number, v: number) => this.score.measures[m]?.staves[staff]?.[v] ?? []
    if (this.mode === 'input') {
      const { m, staff, at } = this.cursor
      const ev = voiceEvents(m, staff, this.voice), st = starts(ev)
      const i = st.findIndex((x) => x >= at + (dir > 0 ? 1 : 0)) // next start strictly after / first at or after
      if (dir > 0) {
        if (i >= 0) this.cursor.at = st[i]
        else if (m + 1 < this.score.measures.length) this.cursor = { m: m + 1, staff, at: 0 }
      } else {
        const prev = st.filter((x) => x < at)
        if (prev.length) this.cursor.at = prev[prev.length - 1]
        else if (m > 0) { const pv = voiceEvents(m - 1, staff, this.voice); this.cursor = { m: m - 1, staff, at: starts(pv).pop() ?? 0 } }
      }
      this.refresh()
      return
    }
    if (this.sel === undefined) return
    const f = findEv(this.score, this.sel)
    if (!f) return
    let { m, index } = f
    const list = (mm: number) => voiceEvents(mm, f.staff, f.voice)
    index += dir
    while (index < 0 || index >= list(m).length) {
      m += dir
      if (m < 0 || m >= this.score.measures.length) return
      index = dir > 0 ? 0 : list(m).length - 1
    }
    this.sel = list(m)[index].id
    this.cursor = { m, staff: f.staff, at: starts(list(m))[index] }
    this.refresh()
    this.say(this.describe(this.sel))
  }

  accidental(alter: number) {
    if (this.sel !== undefined) {
      const id = this.sel
      const f = findEv(this.score, id)
      if (!f) return
      const cur = f.ev.pitches[0]?.alter
      const { key } = contextAt(this.score, f.m)
      this.commit((s) => {
        const g = findEv(s, id)!
        g.ev.pitches = g.ev.pitches.map((p) => ({ ...p, alter: cur === alter ? keyAlter(key, p.step) : alter }))
      })
    } else { this.pendingAlter = this.pendingAlter === alter ? undefined : alter; this.say(this.pendingAlter === undefined ? 'Bỏ dấu hoá' : `Nốt kế tiếp sẽ có ${alter > 0 ? '♯' : alter < 0 ? '♭' : '♮'}`) }
  }

  describe(id: number): string {
    const f = findEv(this.score, id)
    if (!f) return ''
    const name = (p: Pitch) => `${p.step}${p.alter > 0 ? '♯'.repeat(p.alter) : p.alter < 0 ? '♭'.repeat(-p.alter) : ''}${p.octave}`
    return `Ô ${f.m + 1} · ${f.ev.pitches.length ? f.ev.pitches.map(name).join(' ') : 'dấu lặng'} · ${f.ev.ticks / TPQ} phách${f.ev.tie ? ' · nối' : ''}`
  }

  /** Export the engraved score as PDF (the tab must be visible so the SVG is laid out). */
  async pdf() {
    try { await exportPdf(this.score, this.svg() as unknown as SVGElement, this.layout); this.say('Đã xuất PDF') } catch (e) { this.say(`Không xuất được PDF: ${e instanceof Error ? e.message : e}`) }
  }

  // ---- playback ----------------------------------------------------------------------------------------
  /** Stop the preview (also when leaving the tab, so it never plays over the falling view). */
  stop() {
    const p = this.playing
    this.playing = undefined; this.starting = false
    try { p?.stop() } catch { /* already stopped */ }
    this.syncToolbar()
  }

  private starting = false
  async togglePlay() {
    if (this.playing || this.starting) return this.stop()
    this.starting = true // rendering takes a moment: a second click must cancel, not start a second copy
    const notes = toNotes(unroll(toPerformance(this.score)), this.score.tempo)
    if (!notes.length) { this.starting = false; this.say('Chưa có nốt nào để nghe'); return }
    this.syncToolbar()
    let buf: AudioBuffer
    try {
      this.ctx ??= new AudioContext()
      await this.ctx.resume()
      buf = await renderNotes(notes, this.ctx.sampleRate)
    } catch (e) { this.starting = false; this.say('Không phát được: ' + (e as Error).message); this.syncToolbar(); return }
    if (!this.starting) return // cancelled while rendering
    this.starting = false
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.ctx.destination)
    src.onended = () => { if (this.playing === src) { this.playing = undefined; this.syncToolbar() } }
    src.start()
    this.playing = src
    this.syncToolbar()
  }

  // ---- UI ----------------------------------------------------------------------------------------------
  private btn(parent: HTMLElement, id: string, label: string, title: string, fn: () => void, o: { cls?: string; html?: string } = {}): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn ' + (o.cls ?? 'sm')
    if (o.html) b.innerHTML = o.html; else b.textContent = label
    b.title = title; b.setAttribute('aria-label', label)
    b.onclick = () => { fn(); b.blur() }
    parent.appendChild(b)
    this.btns.set(id, b)
    return b
  }
  private group(bar: HTMLElement, cls = 'group'): HTMLElement { const g = document.createElement('span'); g.className = cls; bar.appendChild(g); return g }
  private el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement): HTMLElementTagNameMap[K] { const e = document.createElement(tag); if (cls) e.className = cls; parent?.appendChild(e); return e }

  /** Collapsible section of the right-hand panel. */
  private section(parent: HTMLElement, title: string, open = true): HTMLElement {
    const d = this.el('details', '', parent); d.open = open
    const sm = this.el('summary', '', d); sm.innerHTML = `<span>${title}</span>${icon('chevron')}`
    return this.el('div', 'sec-body', d)
  }
  private cap(parent: HTMLElement, text: string) { const c = this.el('span', 'cap', parent); c.textContent = text }

  private buildUi() {
    const r = this.root
    r.innerHTML = ''

    // ---- top bar: file menu, undo/redo, mode, play, hand over to the falling view
    const top = this.el('div', 'cmp-top', r)
    const fileWrap = this.el('div', 'pop-anchor', top)
    const fileBtn = this.btn(fileWrap, 'file', 'Tệp', 'Mở, lưu, xuất', () => {}, { cls: '', html: `${icon('file')}Tệp${icon('chevron')}` })
    const menu = this.el('div', 'popover menu', fileWrap); menu.setAttribute('role', 'menu')
    const item = (label: string, ic: IconName, fn: () => void) => { const b = this.el('button', '', menu); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.innerHTML = `${icon(ic)}${label}`; b.onclick = fn }
    const fileInput = this.el('input', '', r); fileInput.type = 'file'; fileInput.hidden = true
    fileInput.accept = '.json,.musicxml,.xml,.mxl,.mid,.midi'
    fileInput.onchange = async () => {
      const f = fileInput.files?.[0]
      fileInput.value = ''
      if (!f) return
      try { this.setScore(await importFile(f)); this.say(`Đã mở ${f.name}`) } catch (e) { this.say(`Không mở được: ${e instanceof Error ? e.message : e}`, true) }
    }
    item('Bản nhạc mới', 'plus', () => { if (confirm('Bỏ bản soạn hiện tại và tạo bản mới?')) this.setScore(emptyScore(8)) })
    item('Mở…', 'folder', () => fileInput.click())
    item('Lưu bản soạn (.json)', 'save', () => saveJson(this.score))
    menu.appendChild(document.createElement('hr'))
    item('Xuất PDF', 'download', () => void this.pdf())
    item('Xuất MusicXML', 'download', () => exportMusicXml(this.score))
    item('Xuất MIDI', 'download', () => exportMidi(this.score))
    popover(fileBtn, menu)

    const edit = this.group(top)
    this.btn(edit, 'undo', 'Hoàn tác', 'Hoàn tác (Ctrl+Z)', () => this.undo(), { cls: 'ghost icon', html: icon('undo') })
    this.btn(edit, 'redo', 'Làm lại', 'Làm lại (Ctrl+Shift+Z)', () => this.redo(), { cls: 'ghost icon', html: icon('redo') })
    this.el('span', 'divider', top)

    const mode = this.el('div', 'seg', top); mode.setAttribute('role', 'group'); mode.setAttribute('aria-label', 'Chế độ')
    for (const [id, label, tip] of [['select', 'Chọn', 'Chọn nốt để sửa (Esc)'], ['input', 'Nhập nốt', 'Bấm vào khuông để đặt nốt (N)']] as const) {
      const b = this.el('button', '', mode); b.type = 'button'; b.textContent = label; b.title = tip
      b.onclick = () => { this.setMode(id); b.blur() }
      this.btns.set(id, b)
    }

    this.el('span', 'spacer', top)
    this.btn(top, 'play', 'Nghe thử', 'Nghe bản soạn (Space)', () => void this.togglePlay(), { cls: '', html: `${icon('play')}Nghe thử` })
    this.btn(top, 'falling', 'Xem nốt rơi', 'Chuyển bản soạn sang màn hình nốt rơi', () => void this.hooks.toFalling(this.score), { cls: 'primary', html: `Xem nốt rơi${icon('bars')}` })
    this.btn(top, 'panel', 'Bảng ký hiệu', 'Ẩn / hiện bảng ký hiệu', () => { const a = r.querySelector<HTMLElement>('.cmp-insp')!; a.hidden = !a.hidden; this.btns.get('panel')!.setAttribute('aria-pressed', String(!a.hidden)); try { localStorage.setItem('notefall.insp', a.hidden ? '0' : '1') } catch { /* ignore */ } }, { cls: 'ghost icon', html: icon('panel') })

    // ---- note-entry tools: what you reach for on every note
    const tools = this.el('div', 'cmp-tools', r)
    tools.setAttribute('role', 'toolbar'); tools.setAttribute('aria-label', 'Công cụ nhập nốt')
    const GLYPH: Record<number, string> = { [4 * TPQ]: '', [2 * TPQ]: '', [TPQ]: '', [TPQ / 2]: '', [TPQ / 4]: '', [TPQ / 8]: '', [TPQ / 16]: '' }
    const dur = this.group(tools); dur.setAttribute('role', 'group'); dur.setAttribute('aria-label', 'Độ dài nốt')
    DURATIONS.slice().reverse().forEach(([key, label, ticks]) => this.btn(dur, `d${ticks}`, label, `${label} — phím ${key}`, () => this.setDuration(+key - 1), { cls: 'ghost', html: `<span class="glyph" aria-hidden="true">${GLYPH[ticks]}</span>` }))
    this.btn(dur, 'dot', 'Nốt chấm', 'Nốt chấm (.)', () => { this.dotted = !this.dotted; this.afterToolChange() }, { cls: 'ghost', html: '<span class="glyph" aria-hidden="true"></span>' })
    this.btn(dur, 'rest', 'Dấu lặng', 'Dấu lặng (R) / biến nốt thành dấu lặng', () => this.rest(), { cls: 'ghost', html: '<span class="glyph" aria-hidden="true"></span>' })
    this.el('span', 'divider', tools)
    const acc = this.group(tools); acc.setAttribute('role', 'group'); acc.setAttribute('aria-label', 'Dấu hoá')
    this.btn(acc, 'sharp', 'Dấu thăng', 'Dấu thăng (+)', () => this.accidental(1), { cls: 'ghost', html: '<span class="glyph" aria-hidden="true"></span>' })
    this.btn(acc, 'flat', 'Dấu giáng', 'Dấu giáng (-)', () => this.accidental(-1), { cls: 'ghost', html: '<span class="glyph" aria-hidden="true"></span>' })
    this.btn(acc, 'natural', 'Dấu bình', 'Dấu bình', () => this.accidental(0), { cls: 'ghost', html: '<span class="glyph" aria-hidden="true"></span>' })
    this.btn(acc, 'tie', 'Nối nốt', 'Nối nốt đang chọn với nốt sau, cùng cao độ (T)', () => this.tie(), { cls: 'ghost', html: '<span class="glyph" aria-hidden="true"></span>' })
    this.el('span', 'divider', tools)
    const voice = this.el('div', 'seg sm', tools); voice.setAttribute('role', 'group'); voice.setAttribute('aria-label', 'Giọng')
    for (let v = 0; v < 4; v++) { const b = this.el('button', '', voice); b.type = 'button'; b.textContent = `${v + 1}`; b.title = `Nhập vào giọng ${v + 1}`; b.setAttribute('aria-label', `Giọng ${v + 1}`); b.onclick = () => { this.voice = v; this.refresh(); b.blur() }; this.btns.set(`v${v}`, b) }
    const vl = this.el('span', 'label', tools); vl.textContent = 'Giọng'; tools.insertBefore(vl, voice)

    // ---- body: the page + a collapsible panel for everything else
    const body = this.el('div', 'cmp-body', r)
    const page = this.el('div', 'cmp-page', body)
    this.host = this.el('div', 'cmp-sheet', page)
    this.host.addEventListener('click', (e) => { const [x, y] = this.toLogical(e); this.click(x, y, { shift: e.shiftKey, alt: e.altKey }) })
    this.host.addEventListener('mousemove', (e) => this.hover(e))
    this.host.addEventListener('mouseleave', () => { this.ghost?.remove(); this.ghost = undefined })

    const insp = this.el('aside', 'cmp-insp', body); insp.setAttribute('aria-label', 'Bảng ký hiệu')
    try { insp.hidden = localStorage.getItem('notefall.insp') === '0' } catch { /* ignore */ }
    queueMicrotask(() => this.btns.get('panel')?.setAttribute('aria-pressed', String(!insp.hidden)))

    const sc = this.section(insp, 'Bản nhạc')
    const title = this.el('input', 'field', sc); title.placeholder = 'Tiêu đề'; title.id = 'cmp-title'; title.setAttribute('aria-label', 'Tiêu đề')
    title.onchange = () => this.commit((s) => { s.title = title.value })
    const comp = this.el('input', 'field', sc); comp.placeholder = 'Tác giả'; comp.id = 'cmp-composer'; comp.setAttribute('aria-label', 'Tác giả')
    comp.onchange = () => this.commit((s) => { s.composer = comp.value })
    const sigRow = this.el('div', 'row', sc)
    const key = this.el('select', 'field', sigRow); key.title = 'Hoá biểu từ ô đang chọn'; key.id = 'cmp-key'; key.setAttribute('aria-label', 'Hoá biểu'); key.style.flex = '1.4'
    for (let f = -7; f <= 7; f++) key.add(new Option(`${keyName(f)} (${f > 0 ? f + '♯' : f < 0 ? -f + '♭' : '0'})`, String(f)))
    key.onchange = () => this.commit((s) => setKey(s, this.cursor.m, +key.value))
    const time = this.el('select', 'field', sigRow); time.title = 'Nhịp từ ô đang chọn (xoá nốt trong các ô bị ảnh hưởng)'; time.id = 'cmp-time'; time.setAttribute('aria-label', 'Nhịp'); time.style.flex = '1'
    TIME_SIGS.forEach((t) => time.add(new Option(t, t)))
    time.onchange = () => { const [b, u] = time.value.split('/').map(Number); this.commit((s) => setTime(s, this.cursor.m, { beats: b, unit: u })) }
    const tempoRow = this.el('label', 'row between', sc); tempoRow.append('Tempo (♩ =)')
    const tempo = this.el('input', 'field', tempoRow); tempo.type = 'number'; tempo.min = '30'; tempo.max = '300'; tempo.id = 'cmp-tempo'; tempo.title = 'Tempo (♩ = …)'
    tempo.onchange = () => this.commit((s) => { s.tempo = Math.min(300, Math.max(30, +tempo.value || 100)) })

    const mk = this.section(insp, 'Sắc thái & dấu nhấn')
    this.cap(mk, 'Sắc thái (cho nốt đang chọn)')
    const dg = this.el('div', 'grid', mk)
    ;([['pp', ''], ['p', ''], ['mp', ''], ['mf', ''], ['f', ''], ['ff', '']] as [Dyn, string][]).forEach(([d, g]) => this.btn(dg, `dyn-${d}`, d, `Sắc thái ${d}`, () => this.dynamic(d), { cls: 'ghost dyn', html: `<span class="glyph" aria-hidden="true">${g}</span>` }))
    this.btn(dg, 'dyn-none', 'Bỏ sắc thái', 'Bỏ sắc thái', () => this.dynamic(undefined), { cls: 'ghost', html: 'Bỏ' })
    this.cap(mk, 'Mạnh dần / nhẹ dần / luyến (chọn đoạn bằng Shift+bấm)')
    const hg = this.el('div', 'grid', mk)
    this.btn(hg, 'cresc', 'Mạnh dần', 'Hairpin mạnh dần', () => this.span('cresc'), { html: 'cresc. &lt;' })
    this.btn(hg, 'dim', 'Nhẹ dần', 'Hairpin nhẹ dần', () => this.span('dim'), { html: 'dim. &gt;' })
    this.btn(hg, 'slur', 'Luyến', 'Dấu luyến từ nốt đầu đến nốt cuối của đoạn chọn (S)', () => this.slur(), { html: 'Luyến' })
    this.cap(mk, 'Dấu nhấn')
    const ag = this.el('div', 'grid', mk)
    for (const [id, label, a, tip] of [['stac', 'Staccato', 'staccato', 'Ngắt nốt'], ['acc', 'Accent', 'accent', 'Nhấn'], ['ten', 'Tenuto', 'tenuto', 'Giữ đủ giá trị'], ['marc', 'Marcato', 'marcato', 'Nhấn mạnh'], ['ferm', 'Fermata', 'fermata', 'Ngân dài (chỉ hiển thị)']] as const)
      this.btn(ag, id, label, tip, () => this.articulate(a))
    this.cap(mk, 'Hoa mỹ')
    const og = this.el('div', 'grid', mk)
    this.btn(og, 'mord', 'Mordent', 'Nốt chính – nốt dưới – nốt chính', () => this.ornament('mordent'))
    this.btn(og, 'invm', 'Mordent đảo', 'Nốt chính – nốt trên – nốt chính', () => this.ornament('inverted'))

    const tp = this.section(insp, 'Bộ ba', false)
    const tup = this.el('select', 'field', tp); tup.id = 'cmp-tup'; tup.title = 'Loại bộ ba'; tup.setAttribute('aria-label', 'Loại bộ ba')
    TUPLETS.forEach((t, i) => tup.add(new Option(t.label, String(i))))
    const tg = this.el('div', 'grid', tp)
    this.btn(tg, 'tuplet', 'Tạo bộ ba', 'Tạo bộ ba tại con trỏ với độ dài nốt đang chọn (Ctrl+3)', () => this.tuplet(), { cls: 'sm', html: 'Tạo (Ctrl+3)' })
    this.btn(tg, 'untuplet', 'Gỡ bộ ba', 'Gỡ bộ ba của nốt đang chọn', () => this.unTuplet(), { html: 'Gỡ' })

    const bar = this.section(insp, 'Ô nhịp & lặp', false)
    const bg = this.el('div', 'grid', bar)
    this.btn(bg, 'addbar', 'Thêm ô nhịp', 'Thêm ô nhịp sau ô đang chọn', () => this.commit((s) => insertMeasure(s, this.cursor.m)), { html: `${icon('plus')}Ô nhịp` })
    this.btn(bg, 'delbar', 'Xoá ô nhịp', 'Xoá ô nhịp đang chọn', () => { this.commit((s) => deleteMeasure(s, this.cursor.m)); this.cursor.m = Math.min(this.cursor.m, this.score.measures.length - 1); this.refresh() }, { html: `${icon('minus')}Ô nhịp` })
    this.cap(bar, 'Dấu lặp')
    const rg = this.el('div', 'grid', bar)
    this.btn(rg, 'rs', 'Dấu lặp bắt đầu', 'Dấu lặp bắt đầu', () => this.commit((s) => { const m = s.measures[this.cursor.m]; m.startRepeat = !m.startRepeat }), { html: '|:' })
    this.btn(rg, 're', 'Dấu lặp kết thúc', 'Dấu lặp kết thúc', () => this.commit((s) => { const m = s.measures[this.cursor.m]; m.endRepeat = !m.endRepeat }), { html: ':|' })
    const vsel = this.el('select', 'field', bar); vsel.id = 'cmp-volta'; vsel.title = 'Ô nhịp tạm (1., 2.…) cho các ô đang chọn'; vsel.setAttribute('aria-label', 'Ô nhịp tạm')
    ;[['', 'Ô nhịp tạm…'], ['none', '(bỏ)'], ['1', '1.'], ['2', '2.'], ['3', '3.'], ['1,2', '1., 2.'], ['1,2,3', '1.–3.']].forEach(([v, l]) => vsel.add(new Option(l, v)))
    vsel.onchange = () => { if (vsel.value) this.ending(vsel.value === 'none' ? undefined : vsel.value.split(',').map(Number)); vsel.value = '' }
    this.cap(bar, 'Điều hướng')
    const ng = this.el('div', 'grid', bar)
    this.btn(ng, 'segno', 'Segno', 'Dấu Segno ở đầu ô (đích của D.S.)', () => this.mark('segno'))
    this.btn(ng, 'coda', 'Coda', 'Dấu Coda ở đầu ô (đích của "To Coda")', () => this.mark('coda'))
    this.btn(ng, 'tocoda', 'To Coda', 'Cuối ô này nhảy sang Coda (sau D.C./D.S. al Coda)', () => this.mark('toCoda'))
    this.btn(ng, 'fine', 'Fine', 'Cuối ô này kết thúc (sau D.C./D.S. al Fine)', () => this.mark('fine'))
    const jsel = this.el('select', 'field', bar); jsel.id = 'cmp-jump'; jsel.title = 'Nhảy ở cuối ô đang chọn'; jsel.setAttribute('aria-label', 'Nhảy')
    ;[['', 'Nhảy…'], ['none', '(không nhảy)'], ['dc-end', 'D.C.'], ['dc-fine', 'D.C. al Fine'], ['dc-coda', 'D.C. al Coda'], ['ds-end', 'D.S.'], ['ds-fine', 'D.S. al Fine'], ['ds-coda', 'D.S. al Coda']].forEach(([v, l]) => jsel.add(new Option(l, v)))
    jsel.onchange = () => { if (jsel.value) { const [k, al] = jsel.value.split('-'); this.jump(jsel.value === 'none' ? undefined : { kind: k as 'dc' | 'ds', al: al as 'end' | 'fine' | 'coda' }) } jsel.value = '' }

    // ---- status bar
    const sb = this.el('div', 'cmp-statusbar', r)
    this.status = this.el('span', 'cmp-status', sb); this.status.setAttribute('role', 'status'); this.status.textContent = 'Bấm vào một nốt để chọn, hoặc nhấn N để nhập nốt mới'
    const hb = this.el('button', 'btn ghost sm', sb); hb.type = 'button'; hb.innerHTML = `${icon('keyboard')}Phím tắt <kbd>?</kbd>`; hb.onclick = () => (document.getElementById('dlg-keys') as HTMLDialogElement | null)?.showModal()
  }

  /** In input mode a faint note follows the mouse so you can see what a click will do. */
  private hover(e: MouseEvent) {
    if (this.mode !== 'input') return
    const [x, y] = this.toLogical(e)
    const hit = hitTest(this.layout, x, y, this.voice)
    if (!hit) { this.ghost?.remove(); this.ghost = undefined; return }
    const dm = this.layout.measures[hit.m], st = dm.staves[hit.staff]
    const half = Math.round((st.bottom - y) / (st.spacing / 2))
    if (!this.ghost) {
      this.ghost = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse')
      this.ghost.setAttribute('rx', '6.5'); this.ghost.setAttribute('ry', '5'); this.ghost.setAttribute('fill', '#1d6fff'); this.ghost.setAttribute('opacity', '0.35'); this.ghost.setAttribute('pointer-events', 'none')
      this.svg().appendChild(this.ghost)
    }
    this.ghost.setAttribute('cx', String(hit.ev?.x ?? x)); this.ghost.setAttribute('cy', String(st.bottom - (half * st.spacing) / 2))
  }

  private syncToolbar() {
    const set = (id: string, on: boolean) => { const b = this.btns.get(id); if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)) } }
    set('select', this.mode === 'select'); set('input', this.mode === 'input'); set('dot', this.dotted)
    DURATIONS.forEach(([, , t]) => set(`d${t}`, t === this.dur))
    for (let v = 0; v < 4; v++) set(`v${v}`, v === this.voice)
    const on = !!this.playing || this.starting
    set('play', on)
    const b = this.btns.get('play'); if (b) { b.innerHTML = on ? `${icon('pause')}Dừng` : `${icon('play')}Nghe thử`; b.classList.toggle('on', on) }
    set('sharp', this.pendingAlter === 1); set('flat', this.pendingAlter === -1); set('natural', this.pendingAlter === 0)
    const ctx = contextAt(this.score, Math.min(this.cursor.m, this.score.measures.length - 1))
    const q = <T extends HTMLElement>(id: string) => this.root.querySelector<T>('#' + id)
    const k = q<HTMLSelectElement>('cmp-key'), t = q<HTMLSelectElement>('cmp-time'), tp = q<HTMLInputElement>('cmp-tempo')
    if (k) k.value = String(ctx.key)
    if (t) t.value = `${ctx.time.beats}/${ctx.time.unit}`
    if (tp && document.activeElement !== tp) tp.value = String(this.score.tempo)
    const ti = q<HTMLInputElement>('cmp-title'), co = q<HTMLInputElement>('cmp-composer')
    if (ti && document.activeElement !== ti) ti.value = this.score.title
    if (co && document.activeElement !== co) co.value = this.score.composer
    const bar = this.score.measures[Math.min(this.cursor.m, this.score.measures.length - 1)]
    set('segno', !!bar?.segno); set('coda', !!bar?.coda); set('tocoda', !!bar?.toCoda); set('fine', !!bar?.fine)
    this.btns.get('undo')!.disabled = !this.undoStack.length
    this.btns.get('redo')!.disabled = !this.redoStack.length
  }
}
