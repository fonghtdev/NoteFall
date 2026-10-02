import { describe, expect, it } from 'vitest'
import minuet from './fixtures/minuet-p1.json'
import { readScore } from './omr'
import type { PagePrims } from './primitives'
import { playOrder, toNotes, unroll } from './playback'
import { setGraceBeats } from './realize'

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const name = (m: number) => NAMES[m % 12] + (Math.floor(m / 12) - 1)
const fmt = (ns: { pitch: number; start: number; duration: number }[]) =>
  ns.sort((a, b) => a.start - b.start || a.pitch - b.pitch).map((n) => `${name(n.pitch)}@${n.start}/${n.duration}`).join(' ')

// Bach, Minuet in G (BWV Anh. 114), right hand, written from the published melody (not from the parser's output).
const q = (p: string, s: number) => `${p}@${s}/1`, e = (p: string, s: number) => `${p}@${s}/0.5`
// mordent = main note, neighbour, main note as quick 32nds; the rest of the written length goes to the last note
const mord = (main: string, nb: string, at: number, len: number) => [`${main}@${at}/0.125`, `${nb}@${at + 0.125}/0.125`, `${main}@${at + 0.25}/${len - 0.25}`]
const ph1 = [e('G4', 1), e('A4', 1.5), e('B4', 2), e('C5', 2.5)]
const RH: string[] = [
  [q('D5', 0), ...ph1],
  [q('D5', 0), q('G4', 1), q('G4', 2)],
  [q('E5', 0), ...mord('C5', 'B4', 1, 0.5), e('D5', 1.5), e('E5', 2), e('F#5', 2.5)], // mordent on C5
  [q('G5', 0), q('G4', 1), q('G4', 2)],
  [...mord('C5', 'B4', 0, 1), e('D5', 1), e('C5', 1.5), e('B4', 2), e('A4', 2.5)],
  [q('B4', 0), e('C5', 1), e('B4', 1.5), e('A4', 2), e('G4', 2.5)],
  [q('F#4', 0), e('G4', 1), e('A4', 1.5), e('B4', 2), e('G4', 2.5)],
  [], // bar 8: grace note + dotted half, checked separately
  [q('D5', 0), ...ph1],
  [q('D5', 0), q('G4', 1), q('G4', 2)],
  [q('E5', 0), ...mord('C5', 'B4', 1, 0.5), e('D5', 1.5), e('E5', 2), e('F#5', 2.5)], // mordent on C5
  [q('G5', 0), q('G4', 1), q('G4', 2)],
  [...mord('C5', 'B4', 0, 1), e('D5', 1), e('C5', 1.5), e('B4', 2), e('A4', 2.5)],
  [q('B4', 0), e('C5', 1), e('B4', 1.5), e('A4', 2), e('G4', 2.5)],
  [q('A4', 0), e('B4', 1), e('A4', 1.5), e('G4', 2), e('F#4', 2.5)],
  [`G4@0/3`],
  [q('B5', 0), e('G5', 1), e('A5', 1.5), e('B5', 2), e('G5', 2.5)],
  [q('A5', 0), e('D5', 1), e('E5', 1.5), e('F#5', 2), e('D5', 2.5)],
  [q('G5', 0), e('E5', 1), e('F#5', 1.5), e('G5', 2), e('D5', 2.5)],
  [q('C#5', 0), e('B4', 1), e('C#5', 1.5), q('A4', 2)],
  [e('A4', 0), e('B4', 0.5), e('C#5', 1), e('D5', 1.5), e('E5', 2), e('F#5', 2.5)],
  [q('G5', 0), q('F#5', 1), q('E5', 2)],
  [q('F#5', 0), q('A4', 1), q('C#5', 2)],
  [`D5@0/3`],
  [q('D5', 0), e('G4', 1), e('F#4', 1.5), q('G4', 2)],
  [q('E5', 0), e('G4', 1), e('F#4', 1.5), q('G4', 2)],
  [q('D5', 0), q('C5', 1), q('B4', 2)],
  [e('A4', 0), e('G4', 0.5), e('F#4', 1), e('G4', 1.5), q('A4', 2)],
  [e('D4', 0), e('E4', 0.5), e('F#4', 1), e('G4', 1.5), e('A4', 2), e('B4', 2.5)],
  [q('C5', 0), ...mord('B4', 'C5', 1, 1), q('A4', 2)], // inverted mordent on B4: upper neighbour
  [e('B4', 0), e('D5', 0.5), q('G4', 1), q('F#4', 2)],
  [`G4@0/3 D4@0/3 B3@0/3`],
].map((m) => (Array.isArray(m) ? m.join(' ') : m))

const score = readScore([minuet as unknown as PagePrims])

describe('Minuet in G (vector PDF)', () => {
  it('finds every bar, with a rhythm that adds up in each one', () => {
    expect(score.beatsPerBar).toBe(3)
    expect(score.beatUnit).toBe(4)
    expect(score.measures).toHaveLength(32)
    expect(score.measures.filter((m) => m.suspect).map((m) => m.index)).toEqual([])
    expect(score.warnings).toEqual([])
  })

  it('right hand equals the published melody, note for note', () => {
    score.measures.forEach((m, i) => {
      if (i === 7) return
      const got = fmt(m.notes.filter((n) => n.staff === 0).map((n) => ({ pitch: n.pitch, start: n.start, duration: n.duration })))
      const want = RH[i].split(' ').sort().join(' ')
      // compare as sets of events: same notes, same positions, same lengths
      expect(got.split(' ').sort().join(' '), `bar ${i + 1}`).toBe(want)
    })
  })

  it('bar 8: the small B4 is a quick grace note (a 32nd), then A4 holds the rest of the dotted half', () => {
    const rh = score.measures[7].notes.filter((n) => n.staff === 0)
    expect(fmt(rh)).toBe('B4@0/0.125 A4@0.125/2.875')
  })

  it('left hand: chords, two voices with hidden rests, rests', () => {
    const lh = (i: number) => fmt(score.measures[i].notes.filter((n) => n.staff === 1))
    expect(lh(0)).toBe('G3@0/2 B3@0/2 D4@0/2 A3@2/1')       // two voices; the upper one has an unprinted rest
    expect(lh(1)).toBe('B3@0/3')
    expect(lh(24)).toBe('B3@0/2 D4@1/2 B3@2/1')              // rest + half note over a half note + quarter
    expect(lh(25)).toBe('C4@0/2 E4@1/2 C4@2/1')
    expect(lh(28)).toBe('D3@0/3 F#3@2/1')                    // dotted half under two quarter rests, then F#3
    expect(lh(31)).toBe('G3@0/1 D3@1/1 G2@2/1')
  })

  it('knows the repeats and plays 1-16, 1-16, 17-32, 17-32', () => {
    const flags = score.measures.map((m) => (m.startRepeat ? '|:' : '') + (m.endRepeat ? ':|' : ''))
    expect(flags[15]).toBe(':|')
    expect(flags[16]).toBe('|:')
    expect(flags[31]).toBe(':|')
    expect(flags.filter(Boolean)).toHaveLength(3)
    const order = playOrder(score.measures)
    expect(order).toHaveLength(64)
    expect(order.slice(14, 18)).toEqual([14, 15, 0, 1])
    expect(order.slice(30, 34)).toEqual([14, 15, 16, 17]) // second pass of 1-16 ends, 17-32 begins
    expect(order.slice(-2)).toEqual([30, 31])
    expect(playOrder(score.measures, false)).toHaveLength(32)
  })

  it('turns beats into seconds', () => {
    const timed = unroll(score)
    const notes = toNotes(timed, 120)
    expect(notes[0]).toMatchObject({ start: 0 }) // first sound at t=0
    expect(Math.max(...notes.map((n) => n.start + n.duration))).toBeCloseTo((64 * 3 * 60) / 120, 5) // 96 s
    expect(unroll(score, false).length).toBe(timed.length / 2)
  })
})

// ---- synthetic: a tie between two heads of the same pitch (not in the sample file) ----
describe('grace note length', () => {
  it('follows the setting and never eats more than a quarter of the main note', () => {
    const bar8 = () => fmt(readScore([minuet as unknown as PagePrims]).measures[7].notes.filter((n) => n.staff === 0))
    setGraceBeats(0.0625); expect(bar8()).toBe('B4@0/0.0625 A4@0.0625/2.9375')
    setGraceBeats(0.25); expect(bar8()).toBe('B4@0/0.25 A4@0.25/2.75')
    setGraceBeats(0.125); expect(bar8()).toBe('B4@0/0.125 A4@0.125/2.875')
  })
})

describe('ties', () => {
  const sp = 5, bottom = 100
  const stave = (y: number): PagePrims['segs'] => [0, 1, 2, 3, 4].map((i) => ({ x1: 0, y1: y + i * sp, x2: 300, y2: y + i * sp, w: 0.5 }))
  const head = (x: number, step: number) => ({ font: 'm', code: 0xf0cf, x, y: bottom + (step * sp) / 2, size: 4 * sp, w: 8 })
  const stem = (x: number, step: number) => ({ x1: x, y1: bottom + (step * sp) / 2, x2: x, y2: bottom + (step * sp) / 2 + 3.5 * sp, w: 0.5 })
  const prims = (tie: boolean): PagePrims => ({
    width: 300, height: 300,
    glyphs: [
      { font: 'm', code: 0xf026, x: 5, y: bottom + sp, size: 4 * sp, w: 15 },
      { font: 'm', code: 0xf034, x: 22, y: bottom + 3 * sp, size: 4 * sp, w: 8 },
      { font: 'm', code: 0xf034, x: 22, y: bottom + sp, size: 4 * sp, w: 8 },
      head(60, 3), head(100, 3), head(140, 4), head(180, 5), // A4 A4 B4 C5
      ...(tie ? [{ font: 'm', code: 0xf0d1, x: 64, y: bottom - 2, size: 20, w: 40 }] : []),
    ],
    segs: [
      ...stave(bottom),
      { x1: 1, y1: bottom, x2: 1, y2: bottom + 4 * sp, w: 0.8 }, { x1: 299, y1: bottom, x2: 299, y2: bottom + 4 * sp, w: 0.8 },
      stem(68, 3), stem(108, 3), stem(148, 4), stem(188, 5),
    ],
    polys: [], curves: [],
  })

  it('merges a curve between same-pitch heads into one longer note', () => {
    const s = readScore([prims(true)])
    expect(s.measures[0].suspect).toBeUndefined()
    expect(s.measures[0].notes.map((n) => !!n.tieNext)).toEqual([true, false, false, false])
    expect(unroll(s).map((n) => `${name(n.pitch)}@${n.start}/${n.duration}`)).toEqual(['A4@0/2', 'B4@2/1', 'C5@3/1'])
  })

  it('without the curve the same page gives four separate notes', () => {
    expect(unroll(readScore([prims(false)])).map((n) => n.duration)).toEqual([1, 1, 1, 1])
  })
})
