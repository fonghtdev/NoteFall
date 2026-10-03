import { icon, type IconName } from '../ui/icons'
import { popover } from '../ui/popover'
import { renderNotes } from '../core/synth'
import { tempoRatios, toNotes, unroll } from '../core/score/playback'
import { hitTest, keyAlter, type Hit } from './hit'
import {
  CLEFS, STEPS, TPQ, addGrace, barTicks, clearGrace, contextAt, copyPrevious, deleteEv, deleteMeasure, diatonic, emptyScore, findEv, flipStem, fromDiatonic, graceStep, insertMeasure, ottavaShiftAt, putNote, putRest,
  TUPLETS, makeTuplet, navigationProblems, pruneRefs, setBarline, setBreak, setClef, setJump, setRehearsal, setTempoMark, setText, setTimeSymbol, setVolta, toggleEv, toggleMark, type BarlineKind, type ClefName, type Mark, type Orn, type SpanKind, type TextField,
  putInTuplet, removeTuplet, setDyn, setKey, setLength, setTime, starts, toggleArt, toggleSpan, toggleTie, transpose, validate, allEventIds, clearMark, copyEvents, moveEv, moveMark, moveTempo, pasteClip, type Clip, type Art, type Dyn, type Ev, type Pitch, type Score,
} from './model'
import { toPerformance } from './perform'
import { DYN_GLYPH, keyName, renderScore, type DrawnEv, type Layout, type MarkRef } from './render'
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
  selMark?: MarkRef                  // a text / dynamic / tempo / rehearsal mark picked up (click it; drag it; Delete removes it)
  sysRange?: [number, number]        // a whole line (system) picked by clicking beside its bars: add / remove bar act on it
  private drag?: { kind: 'note'; ev: DrawnEv; sx: number; sy: number; moved: boolean } | { kind: 'mark'; mark: MarkRef; sx: number; sy: number; moved: boolean } | { kind: 'marquee'; sx: number; sy: number; moved: boolean; x0: number; y0: number }
  private suppressClick = false
  private clip?: Clip
  private marquee?: SVGRectElement

  constructor(private root: HTMLElement, private hooks: ComposerHooks) {
    this.score = this.loadDraft() ?? emptyScore(8)
    this.buildUi()
    document.addEventListener('keydown', (e) => this.onKey(e))
    // the application menu (macOS) turns Cmd+C / X / V into these events before the page sees a key press
    const inField = (t: EventTarget | null) => !!t && /^(INPUT|SELECT|TEXTAREA)$/.test((t as HTMLElement).tagName)
    document.addEventListener('copy', (e) => { if (this.visible && !inField(e.target)) { e.preventDefault(); this.copy() } })
    document.addEventListener('cut', (e) => { if (this.visible && !inField(e.target)) { e.preventDefault(); this.cut() } })
    document.addEventListener('paste', (e) => { if (this.visible && !inField(e.target)) { e.preventDefault(); const t = e.clipboardData?.getData('text/plain') ?? ''; if (!this.clip && t.startsWith('notefall-clip:')) { try { this.clip = JSON.parse(t.slice(14)) as Clip } catch { /* not ours */ } } this.paste() } })
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
    if (!bars.length && this.sysRange) return this.sysRange
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
    this.layout = renderScore(this.host, this.score, { width: LOGICAL_WIDTH, selected: new Set(this.targets()), selectedMark: this.selMark })
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
    if (this.suppressClick) { this.suppressClick = false; return }
    this.selMark = undefined
    const hit = hitTest(this.layout, x, y, this.voice)
    if (!hit) { // beside the bars but on a line: pick the whole line, so + / − bar know which one you mean
      const sys = this.layout.systems.findIndex((q) => y >= q.y0 && y <= q.y1)
      if (sys >= 0) {
        const bars = this.layout.measures.filter((dm) => dm.system === sys).map((dm) => dm.m)
        if (bars.length) {
          this.sysRange = [bars[0], bars[bars.length - 1]]; this.sel = undefined; this.range = []
          this.cursor = { m: bars[bars.length - 1], staff: this.cursor.staff, at: 0 }
          this.refresh()
          this.say(`Đã chọn dòng ${sys + 1} (ô ${bars[0] + 1}–${bars[bars.length - 1] + 1}): "+ Ô nhịp" thêm ô sau ô ${bars[bars.length - 1] + 1}, "− Ô nhịp" xoá ô ${bars[bars.length - 1] + 1}`)
          return
        }
      }
      this.sysRange = undefined
      if (this.mode === 'select') { this.sel = undefined; this.range = []; this.refresh() }
      return
    }
    this.sysRange = undefined
    this.cursor = { m: hit.m, staff: hit.staff, at: hit.at }
    if (this.mode === 'input' && !mods.alt) { this.enterAt(hit, mods.shift ?? false); return }
    const near = hit.ev && Math.abs(hit.ev.x - x) < 28 ? hit.ev : undefined
    if (near && mods.shift && this.sel !== undefined) this.selectRange(near.id)
    else { this.sel = near?.id; this.range = [] }
    this.refresh()
    if (near) this.say(this.describe(near.id))
    else this.say(`Đã chọn ô ${hit.m + 1} (dòng ${this.layout.measures[hit.m].system + 1}): "+ Ô nhịp" thêm sau ô này, "− Ô nhịp" xoá ô này`)
  }

  // ---- picking up and moving notes and marks -------------------------------------------------------------
  /** The note whose head lies under the pointer (any voice), for dragging. */
  private pickNote(x: number, y: number): DrawnEv | undefined {
    let best: { ev: DrawnEv; d: number } | undefined
    for (const dm of this.layout.measures) {
      if (x < dm.x - 12 || x > dm.x + dm.w + 12) continue
      for (const ev of dm.evs) {
        if (ev.rest) continue
        const sp = dm.staves[ev.staff].spacing
        for (const hy of ev.ys) {
          const d = Math.hypot(ev.x + 5 - x, hy - y)
          if (Math.abs(ev.x + 5 - x) < 10 && Math.abs(hy - y) < 0.9 * sp && (!best || d < best.d)) best = { ev, d }
        }
      }
    }
    return best?.ev
  }

  private mouseDown(e: MouseEvent) {
    if (e.button !== 0) return
    const el = (e.target as Element).closest?.('[data-mark]')
    if (el) { this.drag = { kind: 'mark', mark: JSON.parse(el.getAttribute('data-mark')!) as MarkRef, sx: e.clientX, sy: e.clientY, moved: false }; this.suppressClick = true; return }
    if (this.mode !== 'select') return
    const [x, y] = this.toLogical(e)
    const ev = this.pickNote(x, y)
    if (ev) this.drag = { kind: 'note', ev, sx: e.clientX, sy: e.clientY, moved: false }
    else this.drag = { kind: 'marquee', sx: e.clientX, sy: e.clientY, moved: false, x0: x, y0: y } // empty space: a drag draws a box and selects what is inside
  }
  private mouseMove(e: MouseEvent) {
    const d = this.drag
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return
    if (!d.moved) { d.moved = true; this.suppressClick = true; document.body.style.cursor = 'grabbing' }
    const [x, y] = this.toLogical(e)
    if (d.kind === 'marquee') {
      if (!this.marquee) {
        this.marquee = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
        this.marquee.setAttribute('fill', '#1d6fff'); this.marquee.setAttribute('fill-opacity', '0.10'); this.marquee.setAttribute('stroke', '#1d6fff'); this.marquee.setAttribute('stroke-width', '1'); this.marquee.setAttribute('pointer-events', 'none')
        this.svg().appendChild(this.marquee)
      }
      this.marquee.setAttribute('x', String(Math.min(x, d.x0))); this.marquee.setAttribute('y', String(Math.min(y, d.y0)))
      this.marquee.setAttribute('width', String(Math.abs(x - d.x0))); this.marquee.setAttribute('height', String(Math.abs(y - d.y0)))
      return
    }
    this.moveGhost(x, y, d.kind === 'note' ? (e.shiftKey ? this.voice : d.ev.voice) : 0, d.kind === 'mark')
  }
  private mouseUp(e: MouseEvent) {
    const d = this.drag
    this.drag = undefined
    document.body.style.cursor = ''
    this.ghost?.remove(); this.ghost = undefined
    this.marquee?.remove(); this.marquee = undefined
    if (!d) return
    if (d.kind === 'marquee') {
      if (d.moved) {
        const [x, y] = this.toLogical(e)
        const x0 = Math.min(x, d.x0), x1 = Math.max(x, d.x0), y0 = Math.min(y, d.y0), y1 = Math.max(y, d.y0)
        const ids = this.layout.measures.flatMap((dm) => dm.evs.filter((q) => q.x >= x0 - 4 && q.x <= x1 && q.ys.some((qy) => qy >= y0 && qy <= y1)).map((q) => q.id))
        this.selMark = undefined; this.sysRange = undefined
        this.range = ids; this.sel = ids[0]
        this.refresh(); this.say(ids.length ? `Đã chọn ${ids.length} nốt/dấu lặng: Ctrl+C sao chép, Ctrl+X cắt, Delete xoá` : 'Không có gì trong khung chọn')
        setTimeout(() => { this.suppressClick = false }, 0)
      }
      return
    }
    if (!d.moved) { // a click on a mark picks it up (a click on a note is handled by click())
      if (d.kind === 'mark') { this.selMark = d.mark; this.sel = undefined; this.range = []; this.sysRange = undefined; this.refresh(); this.say(this.markHint(d.mark)); this.suppressClick = true }
      else this.suppressClick = false
      return
    }
    const [x, y] = this.toLogical(e)
    if (d.kind === 'note') this.dropNote(d.ev, d.sy, x, y, e.shiftKey)
    else this.dropMark(d.mark, x, y)
    setTimeout(() => { this.suppressClick = false }, 0)
  }
  private markHint(m: MarkRef) { return m.kind === 'ev' ? 'Đã chọn dấu: kéo sang nốt khác để chuyển, Delete để xoá' : m.kind === 'tempo' ? 'Đã chọn dấu tốc độ: kéo tới ô / vị trí khác, Delete để xoá' : 'Đã chọn dấu tập: kéo sang ô khác, Delete để xoá' }

  /** Where a dragged note would land: same beat of the other voice with Shift, otherwise the voice it came from. */
  private dropNote(ev: DrawnEv, startY: number, x: number, y: number, shift: boolean) {
    const voice = shift ? this.voice : ev.voice
    const hit = hitTest(this.layout, x, y, voice)
    if (!hit) { this.say('Thả nốt vào khuông'); return }
    const src = findEv(this.score, ev.id)
    if (!src) return
    const st = this.layout.measures[ev.m].staves[ev.staff]
    // which pitch of a chord is being held: the head nearest the point where the drag started
    const pitched = src.ev.pitches
    const hold = ev.ys.reduce((bi, hy, i) => (Math.abs(hy - startY) < Math.abs(ev.ys[bi] - startY) ? i : bi), 0)
    void st
    const steps = hit.diatonic - diatonic(pitched[Math.min(hold, pitched.length - 1)])
    let ok = false
    const dest = { m: hit.m, staff: hit.staff, voice, at: hit.at }
    this.commit((s) => { ok = moveEv(s, ev.id, dest, steps) })
    if (!ok) { this.say('Không chuyển được nốt này (nốt trong bộ ba thì sửa trong bộ ba, hoặc không đủ chỗ)'); this.refresh(); return }
    this.sel = ev.id; this.range = []
    this.cursor = { m: dest.m, staff: dest.staff, at: dest.at }
    this.refresh()
    this.say(shift && voice !== ev.voice ? `Đã chuyển nốt sang giọng ${voice + 1}` : this.describe(ev.id))
  }

  /** The bar under a point, also above the first staff of a line (where tempo and rehearsal marks stand). */
  private barAt(x: number, y: number) {
    const sys = this.layout.systems.findIndex((q) => y >= q.y0 - 110 && y <= q.y1)
    return this.layout.measures.find((dm) => (sys < 0 || dm.system === sys) && x >= dm.x && x <= dm.x + dm.w)
  }

  private dropMark(mark: MarkRef, x: number, y: number) {
    if (mark.kind === 'ev') {
      const src = findEv(this.score, mark.id)
      const hit = hitTest(this.layout, x, y, 0)
      const dm = hit ? this.layout.measures[hit.m] : this.barAt(x, y)
      if (!src || !dm) { this.say('Thả dấu lên một nốt'); return }
      const to = dm.evs.filter((q) => q.staff === src.staff && !q.rest).reduce<DrawnEv | undefined>((a, q) => (!a || Math.abs(q.x - x) < Math.abs(a.x - x) ? q : a), undefined) // stays on its own staff
      if (!to) { this.say('Không có nốt nào ở đó để gắn dấu'); return }
      this.commit((s) => { moveMark(s, mark.id, mark.field, to.id) })
      this.selMark = { kind: 'ev', field: mark.field, id: to.id }
    } else {
      const dm = this.barAt(x, y)
      if (!dm) { this.say('Thả dấu lên một ô nhịp'); return }
      if (mark.kind === 'tempo') {
        const col = dm.evs.filter((q) => q.staff === 0).reduce<DrawnEv | undefined>((a, q) => (!a || Math.abs(q.x - x) < Math.abs(a.x - x) ? q : a), undefined)
        const at = col && col.at > 0 ? col.at : 0
        let ok = false
        this.commit((s) => { ok = moveTempo(s, mark.bar, dm.m, at) })
        if (!ok) { this.say('Không chuyển được dấu tốc độ này (dấu đầu bài giữ nguyên ở đầu)'); return }
        this.selMark = { kind: 'tempo', bar: dm.m }
        this.say(`Dấu tốc độ ở ô ${dm.m + 1}${at ? `, phách ${+(at / TPQ + 1).toFixed(2)}` : ''}`)
      } else {
        this.commit((s) => { const a = s.measures[mark.bar], b = s.measures[dm.m]; if (a?.rehearsal && b) { b.rehearsal = a.rehearsal; if (a !== b) a.rehearsal = undefined } })
        this.selMark = { kind: 'rehearsal', bar: dm.m }
      }
    }
    this.refresh()
  }

  // ---- copy, cut, paste, select all ------------------------------------------------------------------------
  /** The events a copy takes: the selection, or everything in the selected bars / line when no note is selected. */
  private copyIds(): number[] {
    const ids = this.targets()
    if (ids.length) return ids
    const [a, b] = this.measureRange()
    return this.score.measures.slice(a, b + 1).flatMap((m) => m.staves.flatMap((vs) => vs.flatMap((v) => v.map((e) => e.id))))
  }
  copy(): boolean {
    const clip = copyEvents(this.score, this.copyIds())
    if (!clip) { this.say('Chọn nốt hoặc ô nhịp để sao chép'); return false }
    this.clip = clip
    try { void navigator.clipboard?.writeText('notefall-clip:' + JSON.stringify(clip)).catch(() => {}) } catch { /* the system clipboard is optional */ }
    const n = clip.lanes.reduce((a, l) => a + l.items.length, 0)
    this.say(`Đã sao chép ${n} nốt/dấu lặng. Chọn nơi cần dán rồi nhấn Ctrl+V`)
    return true
  }
  cut() {
    if (!this.copy()) return
    const ids = this.copyIds()
    this.commit((s) => ids.forEach((id) => deleteEv(s, id)))
    this.sel = undefined; this.range = []; this.refresh()
  }
  paste() {
    if (!this.clip) {
      void navigator.clipboard?.readText().then((t) => { if (t.startsWith('notefall-clip:')) { try { this.clip = JSON.parse(t.slice(14)) as Clip; this.paste() } catch { /* not ours */ } } }).catch(() => {})
      this.say('Chưa có gì để dán: hãy sao chép nốt trước')
      return
    }
    const clip = this.clip, f = this.sel !== undefined ? findEv(this.score, this.sel) : undefined
    const dest = f ? { m: f.m, at: f.at, staff: f.staff, voice: f.voice }
      : this.sysRange ? { m: this.sysRange[0], at: 0, staff: this.cursor.staff, voice: this.voice }
      : { m: this.cursor.m, at: this.cursor.at, staff: this.cursor.staff, voice: this.voice }
    let res: ReturnType<typeof pasteClip> | undefined
    this.commit((s) => { res = pasteClip(s, clip, clip.lanes.length > 1 ? { m: dest.m, at: dest.at } : dest) })
    if (!res?.ok) { this.say(`Không dán được: ${res?.reason ?? 'không đủ chỗ'}`); this.refresh(); return }
    this.sysRange = undefined; this.selMark = undefined
    this.range = res.ids; this.sel = res.ids[0]
    if (res.end && res.end.m < this.score.measures.length) this.cursor = { m: res.end.m, staff: dest.staff, at: res.end.at }
    this.refresh()
    this.say(`Đã dán ${res.ids.length} nốt/dấu lặng tại ô ${dest.m + 1}`)
  }
  selectAll() { const ids = allEventIds(this.score); this.sel = ids[0]; this.range = ids; this.selMark = undefined; this.sysRange = undefined; this.refresh(); this.say(`Đã chọn tất cả (${ids.length}): Ctrl+C sao chép`) }

  /** Delete / Backspace on a picked mark removes it. */
  private delMark(): boolean {
    const m = this.selMark
    if (!m) return false
    this.selMark = undefined
    if (m.kind === 'ev') this.commit((s) => clearMark(s, m.id, m.field))
    else if (m.kind === 'tempo') this.commit((s) => setTempoMark(s, m.bar, undefined, undefined))
    else this.commit((s) => setRehearsal(s, m.bar, undefined))
    return true
  }

  /** The faint note / mark that follows the pointer while dragging (and in input mode). */
  private moveGhost(x: number, y: number, voice: number, small = false) {
    const hit = hitTest(this.layout, x, y, voice)
    if (!hit) { this.ghost?.remove(); this.ghost = undefined; return }
    const st = this.layout.measures[hit.m].staves[hit.staff]
    const half = Math.round((st.bottom - y) / (st.spacing / 2))
    if (!this.ghost) {
      this.ghost = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse')
      this.ghost.setAttribute('fill', '#1d6fff'); this.ghost.setAttribute('opacity', '0.35'); this.ghost.setAttribute('pointer-events', 'none')
      this.svg().appendChild(this.ghost)
    }
    this.ghost.setAttribute('rx', small ? '5' : '6.5'); this.ghost.setAttribute('ry', small ? '5' : '5')
    this.ghost.setAttribute('cx', String(small ? x : hit.ev?.x ?? x)); this.ghost.setAttribute('cy', String(small ? y : st.bottom - (half * st.spacing) / 2))
  }

  private pitchAt(m: number, d: number): Pitch {
    const { key } = contextAt(this.score, m)
    const p = fromDiatonic(d)
    p.alter = this.pendingAlter ?? keyAlter(key, p.step)
    return p
  }

  private enterAt(hit: Hit, chord: boolean) {
    const p = this.pitchAt(hit.m, hit.diatonic - 7 * ottavaShiftAt(this.score, hit.m, hit.staff, this.voice, hit.at)) // under 8va the page shows it an octave lower than it sounds
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
    else if (mod && k.toLowerCase() === 'c') this.copy()
    else if (mod && k.toLowerCase() === 'x') this.cut()
    else if (mod && k.toLowerCase() === 'v') this.paste()
    else if (mod && k.toLowerCase() === 'a') this.selectAll()
    else if (mod) used = false
    else if (/^[1-7]$/.test(k)) this.setDuration(+k - 1)
    else if (k === '.') { this.dotted = !this.dotted; this.afterToolChange() }
    else if (/^[a-gA-G]$/.test(k)) this.letter(k.toUpperCase(), e.shiftKey)
    else if (k.toLowerCase() === 'n') this.setMode(this.mode === 'input' ? 'select' : 'input')
    else if (k.toLowerCase() === 'r') this.rest()
    else if (k.toLowerCase() === 't') this.tie()
    else if (k.toLowerCase() === 's') this.slur()
    else if (k.toLowerCase() === 'x') this.flip()
    else if (k === 'ArrowUp' || k === 'ArrowDown') this.vertical(k === 'ArrowUp' ? 1 : -1, e.shiftKey ? 12 : 1, e.altKey)
    else if (k === 'ArrowLeft' || k === 'ArrowRight') this.horizontal(k === 'ArrowRight' ? 1 : -1)
    else if (k === 'Delete' || k === 'Backspace') { if (!this.delMark()) this.del() }
    else if (k === 'Escape') { if (this.drag) { this.drag = undefined; this.ghost?.remove(); this.ghost = undefined; document.body.style.cursor = '' } this.sel = undefined; this.range = []; this.selMark = undefined; this.sysRange = undefined; this.setMode('select') }
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

  ornament(kind: Orn) { this.evMark('orn', kind) }

  /** Set (or clear) a mark on the selected notes. `key` is the event field: orn, arp, gliss, trem, breath. */
  evMark<K extends 'orn' | 'arp' | 'gliss' | 'trem' | 'breath'>(key: K, value: NonNullable<Ev[K]>) {
    const ids = this.targets()
    if (!ids.length) { this.say('Chọn một nốt trước'); return }
    this.commit((s) => ids.forEach((id) => toggleEv(s, id, key, value)))
    if (key === 'arp' && !ids.some((id) => (findEv(this.score, id)?.ev.pitches.length ?? 0) > 1)) this.say('Rải hợp âm cần một hợp âm (từ 2 nốt trở lên)')
  }
  flip() { const ids = this.targets(); if (ids.length) this.commit((s) => ids.forEach((id) => flipStem(s, id))); else this.say('Chọn một nốt trước') }
  grace(kind: 'acc' | 'app') { const ids = this.targets(); if (!ids.length) { this.say('Chọn nốt chính trước'); return } this.commit((s) => addGrace(s, ids[0], kind)) }
  graceMove(dir: 1 | -1) { const ids = this.targets(); if (ids.length) this.commit((s) => graceStep(s, ids[0], dir)) }
  graceClear() { const ids = this.targets(); if (ids.length) this.commit((s) => ids.forEach((id) => clearGrace(s, id))) }

  /** The bar the palettes act on: the first selected bar, otherwise the cursor's. */
  private here() { return this.measureRange()[0] }
  clef(c: ClefName) { const staff = this.cursor.staff, m = this.here(); this.commit((s) => setClef(s, m, staff, c)); this.say(`${CLEFS[c].label}: ${m === 0 ? 'cả khuông' : `từ ô ${m + 1} trở đi`} (khuông ${staff + 1})`) }
  keySig(fifths: number) { const m = this.here(); this.commit((s) => setKey(s, m, fifths)) }
  timeSig(beats: number, unit: number, symbol?: 'common' | 'cut') {
    const m = this.here()
    let kept = true
    this.commit((s) => { kept = setTime(s, m, { beats, unit }); if (symbol) setTimeSymbol(s, m, symbol) })
    this.say(kept ? `Nhịp ${symbol === 'common' ? 'C' : symbol === 'cut' ? '¢' : `${beats}/${unit}`} từ ô ${m + 1}: các nốt được chia lại theo ô mới` : '⚠ Bộ ba bị cắt ngang bởi vạch nhịp mới, nên các ô bị ảnh hưởng đã được làm trống')
  }
  /** A tempo mark at the selected note (so it can sit in the middle of a bar), otherwise at the start of the selected bar. */
  tempoMark(bpm?: number, text?: string) {
    const f = this.sel !== undefined ? findEv(this.score, this.sel) : undefined
    const m = f ? f.m : this.here(), at = f ? f.at : 0
    this.commit((s) => setTempoMark(s, m, bpm ? Math.min(300, Math.max(20, bpm)) : undefined, text, at))
  }
  rehearsal(text?: string) { const m = this.here(); this.commit((s) => setRehearsal(s, m, text)) }
  barline(kind: BarlineKind) { const [, b] = this.measureRange(); this.commit((s) => setBarline(s, b, kind)) }
  pageBreak(kind: 'system' | 'page') { const [, b] = this.measureRange(); this.commit((s) => setBreak(s, b, kind)) }
  /** The bar the + / − buttons mean: the last bar of the picked line, otherwise the last selected bar. */
  private barForAdd() { return this.measureRange()[1] }
  addBar() { const b = this.barForAdd(); this.commit((s) => insertMeasure(s, b)); this.cursor.m = b + 1; if (this.sysRange) this.sysRange = undefined; this.refresh(); this.say(`Đã thêm ô nhịp sau ô ${b + 1}`) }
  delBar() {
    if (this.score.measures.length < 2) { this.say('Phải giữ lại ít nhất một ô nhịp'); return }
    const b = this.barForAdd()
    this.commit((s) => deleteMeasure(s, b))
    this.cursor.m = Math.max(0, Math.min(b, this.score.measures.length - 1)); this.sysRange = undefined; this.sel = undefined; this.range = []
    this.refresh(); this.say(`Đã xoá ô ${b + 1}`)
  }
  repeatBar() { const m = this.here(); if (m < 1) { this.say('Ô đầu tiên chưa có ô nào đứng trước'); return } this.commit((s) => copyPrevious(s, m)) }
  /** Text on the selected note; a lyric moves on to the next note so a whole line can be typed. */
  text(field: TextField, value: string) {
    const ids = this.targets()
    if (!ids.length) { this.say('Chọn một nốt trước'); return }
    const id = ids[0]
    this.commit((s) => setText(s, id, field, value))
    if (field === 'lyric') this.selectNextNote(id)
  }
  private selectNextNote(id: number) {
    const f = findEv(this.score, id)
    if (!f) return
    const all = this.voiceEvents(f.staff, f.voice), i = all.findIndex((e) => e.id === id)
    const nx = all.slice(i + 1).find((e) => e.pitches.length)
    if (nx) { this.sel = nx.id; this.range = []; this.refresh() }
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
  span(kind: SpanKind) {
    const ids = this.targets()
    if (ids.length < 2) { this.say('Giữ Shift và bấm nốt cuối để chọn cả đoạn, rồi bấm lại') ; return }
    if (kind === 'o8' || kind === 'o-8' || kind === 'o15' || kind === 'o-15') this.say('Ottava: nốt hiển thị cao/thấp hơn, âm thanh giữ nguyên')
    let ok = false
    this.commit((s) => { ok = toggleSpan(s, kind, ids[0], ids[ids.length - 1]) })
    if (!ok) this.say('Chỉ nối được các nốt cùng khuông và cùng giọng')
    else if (kind === 'pedal') this.say('Pedal chỉ hiển thị và xuất file; không đổi độ dài nốt')
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
    const perf = toPerformance(this.score)
    const notes = toNotes(unroll(perf), this.score.tempo, 85, tempoRatios(perf))
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
  /** A palette button drawn with a music-font glyph (or short text when it has none). */
  private pal(parent: HTMLElement, id: string, glyph: string, label: string, tip: string, fn: () => void, text = false): HTMLButtonElement {
    return this.btn(parent, id, label, tip, fn, { cls: 'ghost pal', html: text ? `<span class="ptxt">${glyph}</span>` : `<span class="glyph" aria-hidden="true">${glyph}</span>` })
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
    this.btn(edit, 'cut', 'Cắt', 'Cắt nốt đang chọn (Ctrl+X)', () => this.cut(), { cls: 'ghost icon', html: icon('cut') })
    this.btn(edit, 'copy', 'Sao chép', 'Sao chép nốt hoặc ô nhịp đang chọn (Ctrl+C)', () => void this.copy(), { cls: 'ghost icon', html: icon('copy') })
    this.btn(edit, 'paste', 'Dán', 'Dán tại nốt hoặc ô đang chọn (Ctrl+V)', () => this.paste(), { cls: 'ghost icon', html: icon('paste') })
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
    this.btn(acc, 'dsharp', 'Thăng kép', 'Thăng kép', () => this.accidental(2), { cls: 'ghost', html: '<span class="glyph" aria-hidden="true">\uE263</span>' })
    this.btn(acc, 'dflat', 'Giáng kép', 'Giáng kép', () => this.accidental(-2), { cls: 'ghost', html: '<span class="glyph" aria-hidden="true">\uE264</span>' })
    this.el('span', 'divider', tools)
    const lk = this.group(tools); lk.setAttribute('role', 'group'); lk.setAttribute('aria-label', 'Nối và luyến')
    this.btn(lk, 'tie', 'Nối nốt', 'Nối nốt đang chọn với nốt sau, cùng cao độ (T)', () => this.tie(), { cls: 'ghost', html: '<span class="glyph" aria-hidden="true">\uE1FD</span>' })
    this.btn(lk, 'slur-q', 'Luyến', 'Luyến: chọn đoạn nốt (Shift+bấm) rồi bấm (S)', () => this.slur(), { cls: 'ghost', html: '<span class="ptxt" aria-hidden="true">⌒</span>' })
    this.el('span', 'divider', tools)
    const qa = this.group(tools); qa.setAttribute('role', 'group'); qa.setAttribute('aria-label', 'Dấu nhấn nhanh')
    ;([['q-marc', 'marcato', '\uE4AC', 'Marcato'], ['q-acc', 'accent', '\uE4A0', 'Accent'], ['q-ten', 'tenuto', '\uE4A4', 'Tenuto'], ['q-stac', 'staccato', '\uE4A2', 'Staccato']] as const)
      .forEach(([id, a, gl, lab]) => this.btn(qa, id, lab, lab, () => this.articulate(a), { cls: 'ghost', html: `<span class="glyph" aria-hidden="true">${gl}</span>` }))
    this.el('span', 'divider', tools)
    const tq = this.group(tools); tq.setAttribute('role', 'group'); tq.setAttribute('aria-label', 'Bộ ba và đuôi nốt')
    this.btn(tq, 'q-tup', 'Bộ ba', 'Bộ ba tại con trỏ (Ctrl+3)', () => this.tuplet(), { cls: 'ghost', html: '<span class="ptxt" aria-hidden="true">3</span>' })
    this.btn(tq, 'q-flip', 'Đổi hướng đuôi', 'Đổi hướng đuôi nốt (X)', () => this.flip(), { cls: 'ghost', html: '<span class="ptxt" aria-hidden="true">⇅</span>' })
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
    this.host.addEventListener('mousedown', (e) => this.mouseDown(e))
    window.addEventListener('mousemove', (e) => this.mouseMove(e))
    window.addEventListener('mouseup', (e) => this.mouseUp(e))
    this.host.addEventListener('mouseleave', () => { this.ghost?.remove(); this.ghost = undefined })

    const insp = this.el('aside', 'cmp-insp', body); insp.setAttribute('aria-label', 'Bảng ký hiệu')
    try { insp.hidden = localStorage.getItem('notefall.insp') === '0' } catch { /* ignore */ }
    queueMicrotask(() => this.btns.get('panel')?.setAttribute('aria-pressed', String(!insp.hidden)))

    const sc = this.section(insp, 'Bản nhạc')
    const title = this.el('input', 'field', sc); title.placeholder = 'Tiêu đề'; title.id = 'cmp-title'; title.setAttribute('aria-label', 'Tiêu đề')
    title.onchange = () => this.commit((s) => { s.title = title.value })
    const comp = this.el('input', 'field', sc); comp.placeholder = 'Tác giả'; comp.id = 'cmp-composer'; comp.setAttribute('aria-label', 'Tác giả')
    comp.onchange = () => this.commit((s) => { s.composer = comp.value })
    const tempoRow = this.el('label', 'row between', sc); tempoRow.append('Tốc độ đầu bài (♩ =)')
    const tempo = this.el('input', 'field', tempoRow); tempo.type = 'number'; tempo.min = '30'; tempo.max = '300'; tempo.id = 'cmp-tempo'; tempo.title = 'Tempo (♩ = …)'
    tempo.onchange = () => this.commit((s) => { s.tempo = Math.min(300, Math.max(30, +tempo.value || 100)) })

    // ---- palettes, in the order and with the names MuseScore uses
    const P = (vi: string, en: string, open = false) => this.section(insp, `${vi} <small>${en}</small>`, open)
    const grid = (p: HTMLElement) => this.el('div', 'grid', p)
    const needsNote = 'Chọn nốt trước (Shift+bấm để chọn cả đoạn)'

    const ar = P('Rải & lướt', 'Arpeggios & glissandos'); let g = grid(ar)
    this.pal(g, 'arp-up', '\uE63F', 'Rải lên', 'Rải hợp âm từ thấp lên cao', () => this.evMark('arp', 'up'))
    this.pal(g, 'arp-down', '\uE640', 'Rải xuống', 'Rải hợp âm từ cao xuống thấp', () => this.evMark('arp', 'down'))
    this.pal(g, 'arp-plain', '\uE63C', 'Rải', 'Rải hợp âm (không mũi tên)', () => this.evMark('arp', 'plain'))
    this.pal(g, 'gliss-s', 'gliss ─', 'Lướt thẳng', 'Lướt từ nốt này đến nốt kế (đường thẳng)', () => this.evMark('gliss', 'straight'), true)
    this.pal(g, 'gliss-w', 'gliss ∿', 'Lướt lượn', 'Lướt từ nốt này đến nốt kế (đường lượn)', () => this.evMark('gliss', 'wavy'), true)

    const tr = P('Tremolo', 'Tremolos'); g = grid(tr)
    ;([[1, '\uE220'], [2, '\uE221'], [3, '\uE222']] as const).forEach(([n, gl]) => this.pal(g, `trem${n}`, gl, `Tremolo ${n} vạch`, `Tremolo ${n} vạch: nốt lặp 1/${8 * 2 ** (n - 1)}`, () => this.evMark('trem', n)))

    const gr = P('Nốt láy', 'Grace notes'); g = grid(gr)
    this.pal(g, 'acc', 'Láy ngắn ⁄', 'Acciaccatura', 'Nốt láy ngắn có gạch chéo, thêm trước nốt đang chọn', () => this.grace('acc'), true)
    this.pal(g, 'app', 'Láy dài', 'Appoggiatura', 'Nốt láy không gạch, thêm trước nốt đang chọn', () => this.grace('app'), true)
    this.pal(g, 'gup', 'Láy ↑', 'Nâng nốt láy', 'Nâng nốt láy cuối lên một bậc', () => this.graceMove(1), true)
    this.pal(g, 'gdn', 'Láy ↓', 'Hạ nốt láy', 'Hạ nốt láy cuối xuống một bậc', () => this.graceMove(-1), true)
    this.pal(g, 'gclr', 'Bỏ láy', 'Xoá nốt láy', 'Xoá nốt láy của nốt đang chọn', () => this.graceClear(), true)
    this.cap(gr, 'Độ nhanh nốt láy khi nghe: Cài đặt → Nốt láy')

    const cl = P('Khoá nhạc', 'Clefs'); g = grid(cl); g.classList.add('wide')
    ;(Object.keys(CLEFS) as ClefName[]).forEach((c) => this.pal(g, `clef-${c}`, CLEFS[c].glyph, CLEFS[c].label, `Khoá ${CLEFS[c].label}: đổi từ ô đang chọn trở đi, cho khuông ${'đang chọn'}`, () => this.clef(c)))
    this.cap(cl, 'Áp dụng cho khuông đang chọn, từ ô đang chọn. Nốt giữ nguyên cao độ.')

    const ks = P('Hoá biểu', 'Key signatures'); g = grid(ks); g.classList.add('wide')
    for (let f = -7; f <= 7; f++) this.pal(g, `key${f}`, `${keyName(f)}<small>${f > 0 ? f + '♯' : f < 0 ? -f + '♭' : '0'}</small>`, `${keyName(f)} (${f})`, `Hoá biểu ${keyName(f)} từ ô đang chọn`, () => this.keySig(f), true)

    const ts = P('Nhịp', 'Time signatures'); g = grid(ts)
    for (const t of ['2/4', '3/4', '4/4', '5/4', '6/4', '7/4', '2/2', '3/2', '3/8', '6/8', '9/8', '12/8', '5/8', '7/8']) this.pal(g, `time${t}`, t, `Nhịp ${t}`, `Nhịp ${t} từ ô đang chọn (các nốt được chia lại)`, () => { const [b, u] = t.split('/').map(Number); this.timeSig(b, u) }, true)
    this.pal(g, 'time-c', '\uE08A', 'Nhịp C', 'Nhịp 4/4 ký hiệu C', () => this.timeSig(4, 4, 'common'))
    this.pal(g, 'time-cut', '\uE08B', 'Nhịp ¢', 'Nhịp 2/2 ký hiệu ¢', () => this.timeSig(2, 2, 'cut'))

    const tp0 = P('Tốc độ', 'Tempo'); g = grid(tp0)
    for (const [t, b] of [['Largo', 50], ['Adagio', 70], ['Andante', 90], ['Moderato', 108], ['Allegro', 132], ['Presto', 176]] as const) this.pal(g, `tp-${t}`, t, `${t} ♩=${b}`, `${t}, ♩ = ${b}, từ ô đang chọn`, () => this.tempoMark(b, t), true)
    const trow = this.el('div', 'row', tp0)
    const tbpm = this.el('input', 'field', trow); tbpm.type = 'number'; tbpm.min = '20'; tbpm.max = '300'; tbpm.placeholder = '♩ ='; tbpm.id = 'cmp-bpm'; tbpm.setAttribute('aria-label', 'Số phách mỗi phút'); tbpm.style.width = '72px'
    const ttxt = this.el('input', 'field', trow); ttxt.placeholder = 'Chữ (vd. Vivace)'; ttxt.id = 'cmp-tempotext'; ttxt.setAttribute('aria-label', 'Chữ chỉ tốc độ')
    const tapply = this.el('div', 'grid', tp0)
    this.btn(tapply, 'tp-apply', 'Đặt tốc độ', 'Đặt tốc độ tại nốt đang chọn (hoặc đầu ô đang chọn); kéo dấu để đổi chỗ', () => this.tempoMark(+tbpm.value || undefined, ttxt.value.trim() || undefined), { html: 'Đặt' })
    this.btn(tapply, 'tp-clear', 'Bỏ tốc độ', 'Bỏ dấu tốc độ ở ô đang chọn', () => this.tempoMark(undefined, undefined), { html: 'Bỏ' })
    for (const t of ['rit.', 'accel.', 'a tempo']) this.btn(tapply, `tp-${t}`, t, `Chữ "${t}" (chỉ hiển thị, không đổi tốc độ)`, () => { const m = this.here(); this.commit((s) => { s.measures[m].tempoText = t }) }, { html: t })

    const pt = P('Cao độ', 'Pitch'); g = grid(pt)
    for (const [k, gl, lab] of [['o8', '8va', '8va (lên 1 quãng tám)'], ['o-8', '8vb', '8vb (xuống 1 quãng tám)'], ['o15', '15ma', '15ma (lên 2 quãng tám)'], ['o-15', '15mb', '15mb (xuống 2 quãng tám)']] as const)
      this.pal(g, k, gl, lab, `${lab}: chọn đoạn nốt (Shift+bấm) rồi bấm`, () => this.span(k), true)
    this.cap(pt, 'Nốt trong đoạn được viết thấp/cao hơn một quãng; âm thanh giữ nguyên.')

    const ac = P('Dấu hoá', 'Accidentals'); g = grid(ac)
    ;([[-2, '\uE264', 'Giáng kép'], [-1, '\uE260', 'Giáng'], [0, '\uE261', 'Bình'], [1, '\uE262', 'Thăng'], [2, '\uE263', 'Thăng kép']] as const).forEach(([al, gl, lab]) => this.pal(g, `acc${al}`, gl, lab, `${lab} cho nốt đang chọn (hoặc nốt kế tiếp khi nhập)`, () => this.accidental(al)))

    const dy = P('Sắc thái', 'Dynamics', true); g = grid(dy)
    for (const d of ['pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'sf', 'sfz', 'fp', 'sfp', 'rfz'] as Dyn[]) this.btn(g, `dyn-${d}`, d, `Sắc thái ${d}`, () => this.dynamic(d), { cls: 'ghost dyn', html: `<span class="glyph" aria-hidden="true">${DYN_GLYPH[d]}</span>` })
    this.btn(g, 'dyn-none', 'Bỏ sắc thái', 'Bỏ sắc thái', () => this.dynamic(undefined), { cls: 'ghost', html: 'Bỏ' })
    this.cap(dy, 'Mạnh dần / nhẹ dần (chọn đoạn bằng Shift+bấm)')
    g = grid(dy)
    this.btn(g, 'cresc', 'Mạnh dần', 'Hairpin mạnh dần', () => this.span('cresc'), { html: 'cresc. &lt;' })
    this.btn(g, 'dim', 'Nhẹ dần', 'Hairpin nhẹ dần', () => this.span('dim'), { html: 'dim. &gt;' })

    const ar2 = P('Dấu nhấn & hoa mỹ', 'Articulations', true); g = grid(ar2)
    ;([['stac', 'staccato', '\uE4A2', 'Staccato', 'Ngắt nốt'], ['stacc2', 'staccatissimo', '\uE4A6', 'Staccatissimo', 'Ngắt rất ngắn'], ['acc', 'accent', '\uE4A0', 'Accent', 'Nhấn'], ['ten', 'tenuto', '\uE4A4', 'Tenuto', 'Giữ đủ giá trị'], ['marc', 'marcato', '\uE4AC', 'Marcato', 'Nhấn mạnh'], ['ferm', 'fermata', '\uE4C0', 'Fermata', 'Ngân dài (chỉ hiển thị)'], ['upb', 'upbow', '\uE612', 'Kéo lên', 'Up bow'], ['dnb', 'downbow', '\uE610', 'Kéo xuống', 'Down bow']] as const)
      .forEach(([id, a, gl, lab, tip]) => this.pal(g, id, gl, lab, `${lab}: ${tip}`, () => this.articulate(a)))
    this.pal(g, 'loure', '\uE4B2', 'Portato', 'Portato (louré): tenuto + staccato', () => { this.articulate('tenuto'); this.articulate('staccato') })
    g = grid(ar2)
    this.pal(g, 'trill', '\uE566', 'Trill', 'Trill: luân phiên với nốt trên', () => this.ornament('trill'))
    this.pal(g, 'turn', '\uE567', 'Turn', 'Turn: trên – chính – dưới – chính', () => this.ornament('turn'))
    this.pal(g, 'mord', '\uE56D', 'Mordent', 'Nốt chính – nốt dưới – nốt chính', () => this.ornament('mordent'))
    this.pal(g, 'invm', '\uE56C', 'Mordent đảo', 'Nốt chính – nốt trên – nốt chính', () => this.ornament('inverted'))
    this.pal(g, 'breath', '\uE4CE', 'Dấu lấy hơi', 'Dấu lấy hơi sau nốt (chỉ hiển thị)', () => this.evMark('breath', 'breath'))
    this.pal(g, 'caes', '\uE4D1', 'Caesura', 'Caesura // sau nốt (chỉ hiển thị)', () => this.evMark('breath', 'caesura'))
    this.pal(g, 'flip', 'Lật đuôi ⇅', 'Đổi hướng đuôi nốt', 'Đổi hướng đuôi nốt (X)', () => this.flip(), true)
    this.pal(g, 'slur', 'Luyến ⌒', 'Luyến', 'Dấu luyến từ nốt đầu đến nốt cuối của đoạn chọn (S)', () => this.slur(), true)
    this.pal(g, 'tie2', 'Nối ‿', 'Nối nốt', 'Nối nốt đang chọn với nốt sau, cùng cao độ (T)', () => this.tie(), true)

    const tx = P('Chữ', 'Text'); 
    const tkind = this.el('select', 'field', tx); tkind.id = 'cmp-textkind'; tkind.setAttribute('aria-label', 'Loại chữ')
    ;([['lyric', 'Lời hát (Enter: sang nốt kế)'], ['chord', 'Hợp âm (Am7, C/E…)'], ['staffText', 'Chữ trên khuông'], ['expr', 'Chữ biểu cảm (dolce…)']] as const).forEach(([v, l]) => tkind.add(new Option(l, v)))
    const tin = this.el('input', 'field', tx); tin.id = 'cmp-text'; tin.placeholder = 'Gõ chữ cho nốt đang chọn, Enter'; tin.setAttribute('aria-label', 'Chữ cho nốt đang chọn')
    tin.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); this.text(tkind.value as TextField, tin.value); tin.value = tkind.value === 'lyric' ? '' : tin.value } e.stopPropagation() }
    this.cap(tx, 'Chữ gắn vào nốt đang chọn. Bỏ trống rồi Enter để xoá.')
    const rrow = this.el('div', 'row', tx)
    const rin = this.el('input', 'field', rrow); rin.id = 'cmp-rehearsal'; rin.placeholder = 'Dấu tập (A, B, 1…)'; rin.setAttribute('aria-label', 'Dấu tập')
    this.btn(rrow, 'rehearsal', 'Đặt dấu tập', 'Đặt dấu tập trong khung ở ô đang chọn (bỏ trống = xoá)', () => this.rehearsal(rin.value), { html: 'Đặt' })

    const kb = P('Pedal', 'Keyboard'); g = grid(kb)
    this.pal(g, 'pedal', '\uE650', 'Pedal', 'Pedal đạp: chọn đoạn nốt (Shift+bấm) rồi bấm. Chỉ hiển thị và xuất file', () => this.span('pedal'))
    this.cap(kb, 'Pedal chỉ hiển thị và xuất MusicXML; không đổi độ dài nốt.')

    const bar = P('Lặp & nhảy', 'Repeats & jumps')
    g = grid(bar)
    this.btn(g, 'rs', 'Dấu lặp bắt đầu', 'Dấu lặp bắt đầu', () => this.commit((s) => { const m = s.measures[this.here()]; m.startRepeat = !m.startRepeat }), { html: '|:' })
    this.btn(g, 're', 'Dấu lặp kết thúc', 'Dấu lặp kết thúc', () => this.commit((s) => { const m = s.measures[this.here()]; m.endRepeat = !m.endRepeat; if (m.endRepeat) m.barline = undefined }), { html: ':|' })
    this.btn(g, 'rbar', 'Lặp ô trước', 'Chép nội dung ô trước vào ô này', () => this.repeatBar(), { html: 'Chép ô trước' })
    const vsel = this.el('select', 'field', bar); vsel.id = 'cmp-volta'; vsel.title = 'Ô nhịp tạm (1., 2.…) cho các ô đang chọn'; vsel.setAttribute('aria-label', 'Ô nhịp tạm')
    ;[['', 'Ô nhịp tạm…'], ['none', '(bỏ)'], ['1', '1.'], ['2', '2.'], ['3', '3.'], ['1,2', '1., 2.'], ['1,2,3', '1.–3.']].forEach(([v, l]) => vsel.add(new Option(l, v)))
    vsel.onchange = () => { if (vsel.value) this.ending(vsel.value === 'none' ? undefined : vsel.value.split(',').map(Number)); vsel.value = '' }
    this.cap(bar, 'Điều hướng')
    g = grid(bar)
    this.btn(g, 'segno', 'Segno', 'Dấu Segno ở đầu ô (đích của D.S.)', () => this.mark('segno'), { cls: 'sm', html: '<span class="glyph sm" aria-hidden="true">\uE047</span> Segno' })
    this.btn(g, 'coda', 'Coda', 'Dấu Coda ở đầu ô (đích của "To Coda")', () => this.mark('coda'), { cls: 'sm', html: '<span class="glyph sm" aria-hidden="true">\uE048</span> Coda' })
    this.btn(g, 'tocoda', 'To Coda', 'Cuối ô này nhảy sang Coda (sau D.C./D.S. al Coda)', () => this.mark('toCoda'))
    this.btn(g, 'fine', 'Fine', 'Cuối ô này kết thúc (sau D.C./D.S. al Fine)', () => this.mark('fine'))
    const jsel = this.el('select', 'field', bar); jsel.id = 'cmp-jump'; jsel.title = 'Nhảy ở cuối ô đang chọn'; jsel.setAttribute('aria-label', 'Nhảy')
    ;[['', 'Nhảy…'], ['none', '(không nhảy)'], ['dc-end', 'D.C.'], ['dc-fine', 'D.C. al Fine'], ['dc-coda', 'D.C. al Coda'], ['ds-end', 'D.S.'], ['ds-fine', 'D.S. al Fine'], ['ds-coda', 'D.S. al Coda']].forEach(([v, l]) => jsel.add(new Option(l, v)))
    jsel.onchange = () => { if (jsel.value) { const [k, al] = jsel.value.split('-'); this.jump(jsel.value === 'none' ? undefined : { kind: k as 'dc' | 'ds', al: al as 'end' | 'fine' | 'coda' }) } jsel.value = '' }

    const bl = P('Vạch nhịp', 'Barlines'); g = grid(bl)
    for (const [k, lab, gl] of [['single', 'Vạch đơn', '│'], ['double', 'Vạch đôi', '║'], ['final', 'Vạch kết', '┃┃'], ['dashed', 'Vạch đứt', '¦'], ['dotted', 'Vạch chấm', '⁞'], ['none', 'Ẩn vạch', '∅']] as const)
      this.pal(g, `bl-${k}`, gl, lab, `${lab} ở cuối ô đang chọn`, () => this.barline(k as BarlineKind), true)

    const lay = P('Bố cục', 'Layout'); g = grid(lay)
    this.btn(g, 'sysbreak', 'Xuống dòng', 'Bắt đầu hệ khuông mới sau ô đang chọn', () => this.pageBreak('system'), { html: 'Xuống dòng ↵' })
    this.btn(g, 'pgbreak', 'Sang trang', 'Bắt đầu trang mới sau ô đang chọn (khi xuất PDF)', () => this.pageBreak('page'), { html: 'Sang trang ⎘' })
    g = grid(lay)
    this.btn(g, 'addbar', 'Thêm ô nhịp', 'Thêm ô nhịp sau ô đang chọn (hoặc sau ô cuối của dòng đang chọn)', () => this.addBar(), { html: `${icon('plus')}Ô nhịp` })
    this.btn(g, 'delbar', 'Xoá ô nhịp', 'Xoá ô nhịp đang chọn (hoặc ô cuối của dòng đang chọn)', () => this.delBar(), { html: `${icon('minus')}Ô nhịp` })

    const tp = P('Bộ ba', 'Tuplets')
    const tup = this.el('select', 'field', tp); tup.id = 'cmp-tup'; tup.title = 'Loại bộ ba'; tup.setAttribute('aria-label', 'Loại bộ ba')
    TUPLETS.forEach((t, i) => tup.add(new Option(t.label, String(i))))
    g = grid(tp)
    this.btn(g, 'tuplet', 'Tạo bộ ba', 'Tạo bộ ba tại con trỏ với độ dài nốt đang chọn (Ctrl+3)', () => this.tuplet(), { cls: 'sm', html: 'Tạo (Ctrl+3)' })
    this.btn(g, 'untuplet', 'Gỡ bộ ba', 'Gỡ bộ ba của nốt đang chọn', () => this.unTuplet(), { html: 'Gỡ' })

    // ---- status bar
    const sb = this.el('div', 'cmp-statusbar', r)
    this.status = this.el('span', 'cmp-status', sb); this.status.setAttribute('role', 'status'); this.status.textContent = 'Bấm vào một nốt để chọn, hoặc nhấn N để nhập nốt mới'
    const hb = this.el('button', 'btn ghost sm', sb); hb.type = 'button'; hb.innerHTML = `${icon('keyboard')}Phím tắt <kbd>?</kbd>`; hb.onclick = () => (document.getElementById('dlg-keys') as HTMLDialogElement | null)?.showModal()
  }

  /** In input mode a faint note follows the mouse so you can see what a click will do. */
  private hover(e: MouseEvent) {
    if (this.mode !== 'input' || this.drag) return
    const [x, y] = this.toLogical(e)
    this.moveGhost(x, y, this.voice)
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
