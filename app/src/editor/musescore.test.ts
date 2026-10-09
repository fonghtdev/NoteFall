// @vitest-environment jsdom
// The composer driven by keys, as a MuseScore user types: each case is MuseScore's behaviour (read from its noteinput / cmd / edittie / editnote code and default shortcuts).
import { describe, expect, it } from 'vitest'
import { Composer } from './composer'
import { emptyScore } from './model'

;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
const hooks = { toFalling() {}, piano: { options: () => [], value: () => '', set() {}, openLibrary() {}, isDefault: () => true, setDefault() {} }, click: () => ({ sound: 'wood' as const, accent: true }) }
const make = () => { localStorage.clear(); const root = document.createElement('div'); document.body.append(root); const c = new Composer(root, hooks); c.setScore(emptyScore(2)); return c }
const nm = (p: { step: string; alter: number; octave: number }) => p.step + (p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter)) + p.octave
const LEN: Record<number, string> = { 3840: 'w', 2880: 'h.', 1920: 'h', 1440: 'q.', 960: 'q', 720: 'e.', 480: 'e', 240: 's' }
const bar = (c: Composer, m: number, staff = 0, v = 0) => (c.score.measures[m]?.staves[staff]?.[v] ?? []).map((e) => (e.pitches.length ? e.pitches.map(nm).join('+') : 'r') + ':' + (LEN[e.ticks] ?? e.ticks) + (e.tie ? '~' : '') + (e.graces?.length ? '[g]' : '')).join(' ')
type K = string | [string, Partial<KeyboardEventInit>]
const keys = (c: Composer, ...ks: K[]) => ks.forEach((k) => (Array.isArray(k) ? c.key(k[0], k[1]) : c.key(k)))
const shift = (k: string): K => [k, { shiftKey: true }]
const select = (c: Composer, ...i: number[]) => { const evs = c.score.measures[0].staves[0][0]; c.sel = evs[i[0]].id; c.range = i.length > 1 ? i.map((j) => evs[j].id) : [] }
const typed = (...ks: K[]) => { const c = make(); keys(c, 'n', ...ks); return c }

describe('composer keys behave like MuseScore', { timeout: 20000 }, () => { // (each case types into a real composer that redraws with VexFlow under jsdom: seconds, more on a busy machine)
  it('1-9 are the toolbar buttons left to right: whole … sixty-fourth, dot, rest', () => {
    expect(bar(typed('1', 'c'), 0)).toBe('C5:w')
    expect(bar(typed('2', 'c', '4', 'd', '3', '8', 'e'), 0)).toBe('C5:h D5:e E5:q.')
    expect(bar(typed('3', 'c', '9', 'd'), 0)).toBe('C5:q r:q D5:q r:q')
  })
  it('a letter goes to the octave nearest the note before it in the same voice; with nothing before, near the clef (C5 treble, C3 bass)', () => {
    expect(bar(typed('3', 'c', 'b'), 0)).toBe('C5:q B4:q r:h')
    const c = make(); keys(c, '3', 'n'); c.cursor = { m: 0, staff: 1, at: 0 }; keys(c, 'c'); expect(bar(c, 0, 1)).toBe('C3:q r:q r:h')
    const v = typed('3', 'c', 'd', 'e', 'f', ['2', { ctrlKey: true, altKey: true, code: 'Digit2' }]); v.cursor = { m: 0, staff: 0, at: 1920 }; keys(v, 'a')
    expect(bar(v, 0, 0, 1)).toBe('r:h A4:q r:q') // voice 2 has nothing before: near C5, not near voice 1's F5
  })
  it('Shift+letter adds the first such note above the top of the chord', () => {
    expect(bar(typed('3', 'c', shift('G'), shift('E')), 0)).toBe('C5+G5+E6:q r:q r:h')
  })
  it('a note longer than what is left of the bar goes on in the next bar, tied; the cursor follows', () => {
    expect([bar(typed('3', 'c', 'd', 'e', '2', 'f', '3', 'g'), 0), bar(typed('3', 'c', 'd', 'e', '2', 'f', '3', 'g'), 1)]).toEqual(['C5:q D5:q E5:q F5:q~', 'F5:q G5:q r:h'])
  })
  it('lengthening a selected note over the barline ties it on', () => {
    const c = typed('3', 'c', 'd', 'e', 'f', 'Escape'); select(c, 2); keys(c, '1')
    expect([bar(c, 0), bar(c, 1)]).toEqual(['C5:q D5:q E5:h~', 'E5:h r:h'])
  })
  it('a note written over another keeps its grace notes', () => {
    const c = typed('3', 'c', 'Escape'); select(c, 0); c.addGraceNote('acc'); keys(c, 'n'); c.cursor = { m: 0, staff: 0, at: 0 }; keys(c, 'e')
    expect(bar(c, 0)).toBe('E5:q[g] r:q r:h')
  })
  it('a grace note is picked up by the pointer in either mode (entering notes too), as notes are', () => {
    const c = typed('3', 'c', 'Escape'); select(c, 0); c.addGraceNote('acc'); c.selGrace = undefined; keys(c, 'n')
    const id = c.score.measures[0].staves[0][0][0].id, g = c.layout.graces[0], inner = c as unknown as { toLogical(): number[]; mouseDown(e: object): void }
    expect(g).toMatchObject({ id, i: 0 })
    inner.toLogical = () => [g.x - 2, g.y - 3] // a little off the head, as a finger lands
    inner.mouseDown({ clientX: 0, clientY: 0, target: document.body, preventDefault() {} })
    expect(c.selGrace).toEqual({ id, i: 0 })
  })
  it('Delete on a picked grace note takes only that grace note', () => {
    const c = typed('3', 'c', 'Escape'); select(c, 0); c.addGraceNote('acc'); c.addGraceNote('app') // the second one is picked
    keys(c, 'Delete'); expect(bar(c, 0)).toBe('C5:q[g] r:q r:h'); expect(c.score.measures[0].staves[0][0][0].graces).toHaveLength(1)
  })
  it('Delete, the arrows and J act on every selected note', () => {
    let c = typed('3', 'c', 'd', 'e', 'f', 'Escape'); select(c, 0, 1); keys(c, 'Delete'); expect(bar(c, 0)).toBe('r:h E5:q F5:q')
    c = typed('3', 'c', 'd', 'e', 'f', 'Escape'); select(c, 0, 1); keys(c, 'ArrowUp'); expect(bar(c, 0)).toBe('C#5:q D#5:q E5:q F5:q')
    c = typed('3', 'c', 'd', 'Escape'); select(c, 0, 1); keys(c, '+', 'j'); expect(bar(c, 0)).toBe('Db5:q Eb5:q r:h')
  })
  it('J cycles the spellings; Alt+Shift+arrow steps through the scale', () => {
    const c = typed('3', 'c', 'Escape'); select(c, 0); keys(c, '+', 'j'); expect(bar(c, 0)).toBe('Db5:q r:q r:h')
    keys(c, 'j'); expect(bar(c, 0)).toBe('B##4:q r:q r:h')
    const d = typed('3', 'c', 'Escape'); select(d, 0); keys(d, ['ArrowUp', { altKey: true, shiftKey: true }]); expect(bar(d, 0)).toBe('D5:q r:q r:h')
  })
  it('Shift+arrows grow and shrink the selection from the note first picked', () => {
    const c = typed('3', 'c', 'd', 'e', 'Escape'); select(c, 0)
    keys(c, shift('ArrowRight'), shift('ArrowRight')); expect(c.range).toHaveLength(3)
    keys(c, shift('ArrowLeft')); expect(c.range).toHaveLength(2)
  })
  it('R repeats: the selection after itself, or (entering notes) the last chord at the cursor', () => {
    const c = typed('3', 'c', 'd', 'Escape'); select(c, 0); keys(c, 'r'); expect(bar(c, 0)).toBe('C5:q C5:q r:h')
    expect(bar(typed('3', 'c', 'r', 'r'), 0)).toBe('C5:q C5:q C5:q r:q')
  })
  it('Ctrl+2…6 make that tuplet', () => {
    const c = typed('3', 'c', 'Escape'); select(c, 0); keys(c, ['5', { ctrlKey: true, code: 'Digit5' }])
    expect(c.score.measures[0].staves[0][0].filter((e) => e.tup?.n === 5)).toHaveLength(5)
  })
  it('the preview starts at the selected note, else at the input cursor, else from the top', () => {
    const c = typed('3', 'c', 'd', 'e', 'f', 'g', 'Escape'); select(c, 2)
    expect(c.startPlace()).toEqual({ m: 0, at: 1920 })
    c.sel = undefined; expect(c.startPlace()).toBeUndefined()
    keys(c, 'n'); c.cursor = { m: 1, staff: 0, at: 960 }; expect(c.startPlace()).toEqual({ m: 1, at: 960 })
  })
  it('rests split like the note-value pyramid and stay split: the rest key, a shorter rest, then an edit elsewhere in the bar', () => {
    const c = make(); keys(c, 'n', '3', '9'); expect(bar(c, 0)).toBe('r:q r:q r:h')          // a quarter rest entered into an empty bar
    keys(c, 'Escape'); select(c, 2); keys(c, '4'); expect(bar(c, 0)).toBe('r:q r:q r:e r:e r:q') // the half rest made an eighth: the rest of its room follows the beats
    keys(c, 'n'); c.cursor = { m: 0, staff: 0, at: 2880 }; keys(c, '3', 'c')
    expect(bar(c, 0)).toBe('r:q r:q r:e r:e C5:q')                                               // a note later in the bar leaves the rests written before it alone
  })
  it('compound time groups rests by the dotted-quarter beat', () => {
    const six = () => { localStorage.clear(); const root = document.createElement('div'); document.body.append(root); const c = new Composer(root, hooks); c.setScore(emptyScore(2, { beats: 6, unit: 8 })); return c }
    const at = (c: Composer, tick: number) => { keys(c, 'n'); c.cursor = { m: 0, staff: 0, at: tick }; keys(c, '4', 'c') }
    let c = six(); at(c, 0); expect(bar(c, 0)).toBe('C5:e r:q r:q.')          // an eighth on beat 1: a quarter rest to the end of the beat, a dotted quarter rest for beat 2
    c = six(); at(c, 1440); expect(bar(c, 0)).toBe('r:q. C5:e r:q')
  })
  it('the title, the composer and the tempo show on the page while they are typed, one undo step per field', () => {
    const c = make(), last = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)].pop()! // (every test adds a composer to the page: this one is the last)
    const page = () => [...last('.cmp-sheet').querySelectorAll('svg text')].map((t) => t.textContent)
    const type = (id: string, ...steps: string[]) => { const el = last<HTMLInputElement>('#' + id); el.focus(); for (const v of steps) { el.value = v; el.dispatchEvent(new Event('input')) } }
    type('cmp-title', 'B', 'Ba', 'Bài'); expect(c.score.title).toBe('Bài'); expect(page()).toContain('Bài')  // still typing: the page follows
    type('cmp-tempo', '7', '77'); expect(c.score.tempo).toBe(77); expect(page()).toContain('♩ = 77')          // the 7 of 77 waits (under 30)
    c.undo(); expect(c.score.tempo).toBe(100)                                                                   // one undo: the whole tempo edit
    c.undo(); expect(c.score.title).toBe('Không tên')
  })
  it('a pedal or an ottava just put on a note is what Delete removes, not the note under it', () => {
    for (const kind of ['pedal', 'o8'] as const) {
      const c = typed('3', 'c', 'd', 'e', 'Escape'); select(c, 1)
      c.span(kind); keys(c, 'Delete')
      const evs = c.score.measures[0].staves[0][0]
      expect([bar(c, 0), !!evs[1].pedal || !!evs[1].ottava]).toEqual(['C5:q D5:q E5:q r:q', false])
    }
  })
})


describe('shadow note', () => {
  it('stays on the page after a note is placed, without leaving the score first', () => {
    const c = make(); c.setMode('input')
    const m = c.layout.measures[0], st = m.staves[0]
    const ghost = () => (c as unknown as { ghost?: SVGGElement }).ghost
    ;(c as unknown as { moveGhost(x: number, y: number, v: number): void }).moveGhost(m.x + m.w / 2, st.bottom - st.spacing * 2, 0)
    expect(ghost()?.isConnected).toBe(true)
    c.key('c')                                                      // the score is drawn again in a new <svg>
    expect(ghost()?.isConnected).toBe(true)
  })
})
