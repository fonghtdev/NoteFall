// @vitest-environment jsdom
// The composer driven by keys, as a MuseScore user types: each case is MuseScore's behaviour (read from its noteinput / cmd / edittie / editnote code and default shortcuts).
import { describe, expect, it } from 'vitest'
import { Composer } from './composer'
import { emptyScore } from './model'

;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
const hooks = { toFalling() {}, piano: { options: () => [], value: () => '', set() {}, openLibrary() {}, isDefault: () => true, setDefault() {} }, click: () => ({ sound: 'wood' as const, volume: 0, accent: true }) }
const make = () => { localStorage.clear(); const root = document.createElement('div'); document.body.append(root); const c = new Composer(root, hooks); c.setScore(emptyScore(2)); return c }
const nm = (p: { step: string; alter: number; octave: number }) => p.step + (p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter)) + p.octave
const LEN: Record<number, string> = { 3840: 'w', 2880: 'h.', 1920: 'h', 1440: 'q.', 960: 'q', 720: 'e.', 480: 'e' }
const bar = (c: Composer, m: number, staff = 0, v = 0) => (c.score.measures[m]?.staves[staff]?.[v] ?? []).map((e) => (e.pitches.length ? e.pitches.map(nm).join('+') : 'r') + ':' + (LEN[e.ticks] ?? e.ticks) + (e.tie ? '~' : '') + (e.graces?.length ? '[g]' : '')).join(' ')
type K = string | [string, Partial<KeyboardEventInit>]
const keys = (c: Composer, ...ks: K[]) => ks.forEach((k) => (Array.isArray(k) ? c.key(k[0], k[1]) : c.key(k)))
const shift = (k: string): K => [k, { shiftKey: true }]
const select = (c: Composer, ...i: number[]) => { const evs = c.score.measures[0].staves[0][0]; c.sel = evs[i[0]].id; c.range = i.length > 1 ? i.map((j) => evs[j].id) : [] }
const typed = (...ks: K[]) => { const c = make(); keys(c, 'n', ...ks); return c }

describe('composer keys behave like MuseScore', () => {
  it('a letter goes to the octave nearest the note before it in the same voice; with nothing before, near the clef (C5 treble, C3 bass)', () => {
    expect(bar(typed('5', 'c', 'b'), 0)).toBe('C5:q B4:q r:h')
    const c = make(); keys(c, '5', 'n'); c.cursor = { m: 0, staff: 1, at: 0 }; keys(c, 'c'); expect(bar(c, 0, 1)).toBe('C3:q r:q r:h')
    const v = typed('5', 'c', 'd', 'e', 'f', ['2', { ctrlKey: true, altKey: true, code: 'Digit2' }]); v.cursor = { m: 0, staff: 0, at: 1920 }; keys(v, 'a')
    expect(bar(v, 0, 0, 1)).toBe('r:h A4:q r:q') // voice 2 has nothing before: near C5, not near voice 1's F5
  })
  it('Shift+letter adds the first such note above the top of the chord', () => {
    expect(bar(typed('5', 'c', shift('G'), shift('E')), 0)).toBe('C5+G5+E6:q r:q r:h')
  })
  it('a note longer than what is left of the bar goes on in the next bar, tied; the cursor follows', () => {
    expect([bar(typed('5', 'c', 'd', 'e', '6', 'f', '5', 'g'), 0), bar(typed('5', 'c', 'd', 'e', '6', 'f', '5', 'g'), 1)]).toEqual(['C5:q D5:q E5:q F5:q~', 'F5:q G5:q r:h'])
  })
  it('lengthening a selected note over the barline ties it on', () => {
    const c = typed('5', 'c', 'd', 'e', 'f', 'Escape'); select(c, 2); keys(c, '7')
    expect([bar(c, 0), bar(c, 1)]).toEqual(['C5:q D5:q E5:h~', 'E5:h r:h'])
  })
  it('a note written over another keeps its grace notes', () => {
    const c = typed('5', 'c', 'Escape'); select(c, 0); c.addGraceNote('acc'); keys(c, 'n'); c.cursor = { m: 0, staff: 0, at: 0 }; keys(c, 'e')
    expect(bar(c, 0)).toBe('E5:q[g] r:q r:h')
  })
  it('a grace note is picked up by the pointer in either mode (entering notes too), as notes are', () => {
    const c = typed('5', 'c', 'Escape'); select(c, 0); c.addGraceNote('acc'); c.selGrace = undefined; keys(c, 'n')
    const id = c.score.measures[0].staves[0][0][0].id, g = c.layout.graces[0], inner = c as unknown as { toLogical(): number[]; mouseDown(e: object): void }
    expect(g).toMatchObject({ id, i: 0 })
    inner.toLogical = () => [g.x - 2, g.y - 3] // a little off the head, as a finger lands
    inner.mouseDown({ clientX: 0, clientY: 0, target: null, preventDefault() {} })
    expect(c.selGrace).toEqual({ id, i: 0 })
  })
  it('Delete on a picked grace note takes only that grace note', () => {
    const c = typed('5', 'c', 'Escape'); select(c, 0); c.addGraceNote('acc'); c.addGraceNote('app') // the second one is picked
    keys(c, 'Delete'); expect(bar(c, 0)).toBe('C5:q[g] r:q r:h'); expect(c.score.measures[0].staves[0][0][0].graces).toHaveLength(1)
  })
  it('Delete, the arrows and J act on every selected note', () => {
    let c = typed('5', 'c', 'd', 'e', 'f', 'Escape'); select(c, 0, 1); keys(c, 'Delete'); expect(bar(c, 0)).toBe('r:h E5:q F5:q')
    c = typed('5', 'c', 'd', 'e', 'f', 'Escape'); select(c, 0, 1); keys(c, 'ArrowUp'); expect(bar(c, 0)).toBe('C#5:q D#5:q E5:q F5:q')
    c = typed('5', 'c', 'd', 'Escape'); select(c, 0, 1); keys(c, '+', 'j'); expect(bar(c, 0)).toBe('Db5:q Eb5:q r:h')
  })
  it('J cycles the spellings; Alt+Shift+arrow steps through the scale', () => {
    const c = typed('5', 'c', 'Escape'); select(c, 0); keys(c, '+', 'j'); expect(bar(c, 0)).toBe('Db5:q r:q r:h')
    keys(c, 'j'); expect(bar(c, 0)).toBe('B##4:q r:q r:h')
    const d = typed('5', 'c', 'Escape'); select(d, 0); keys(d, ['ArrowUp', { altKey: true, shiftKey: true }]); expect(bar(d, 0)).toBe('D5:q r:q r:h')
  })
  it('Shift+arrows grow and shrink the selection from the note first picked', () => {
    const c = typed('5', 'c', 'd', 'e', 'Escape'); select(c, 0)
    keys(c, shift('ArrowRight'), shift('ArrowRight')); expect(c.range).toHaveLength(3)
    keys(c, shift('ArrowLeft')); expect(c.range).toHaveLength(2)
  })
  it('R repeats: the selection after itself, or (entering notes) the last chord at the cursor', () => {
    const c = typed('5', 'c', 'd', 'Escape'); select(c, 0); keys(c, 'r'); expect(bar(c, 0)).toBe('C5:q C5:q r:h')
    expect(bar(typed('5', 'c', 'r', 'r'), 0)).toBe('C5:q C5:q C5:q r:q')
  })
  it('Ctrl+2…6 make that tuplet', () => {
    const c = typed('5', 'c', 'Escape'); select(c, 0); keys(c, ['5', { ctrlKey: true, code: 'Digit5' }])
    expect(c.score.measures[0].staves[0][0].filter((e) => e.tup?.n === 5)).toHaveLength(5)
  })
})
