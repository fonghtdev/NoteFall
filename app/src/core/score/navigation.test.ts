import { describe, expect, it } from 'vitest'
import { readNavigation, words, type BarGeom } from './navigation'
import type { Glyph, PagePrims } from './primitives'

const sp = 5
const bars: BarGeom[] = [0, 1, 2, 3].map((i) => ({ x0: 100 + i * 100, x1: 200 + i * 100, top: 400, bottom: 380, sp })) // four bars, staff 380..400
const page = (glyphs: Glyph[], segs: PagePrims['segs'] = []): PagePrims => ({ width: 600, height: 800, glyphs, segs, polys: [], curves: [] })

/** Text glyphs laid out left to right from x, 6 pt wide each, 10 pt font. */
const text = (s: string, x: number, y: number): Glyph[] =>
  [...s].map((c, i) => ({ font: 't', code: c.codePointAt(0)!, x: x + i * 6, y, size: 10, w: 6 })).filter((g) => g.code !== 0x20)

describe('words', () => {
  it('glues letters into words and keeps spaces', () => {
    expect(words(text('D.C. al Fine', 100, 420)).map((w) => w.text)).toEqual(['D.C. al Fine'])
  })
})

describe('navigation words', () => {
  const nav = (s: string, x1: number) => readNavigation(page(text(s, x1 - s.length * 6, 425)), bars)

  it('D.C. al Fine at the end of bar 4', () => {
    expect(nav('D.C. al Fine', 500)[3].jump).toEqual({ kind: 'dc', al: 'fine' })
  })
  it('D.S. al Coda, D.C. alone, Fine, To Coda', () => {
    expect(nav('D.S. al Coda', 400)[2].jump).toEqual({ kind: 'ds', al: 'coda' })
    expect(nav('D.C.', 300)[1].jump).toEqual({ kind: 'dc', al: 'end' })
    expect(nav('Fine', 200)[0].fine).toBe(true)
    expect(nav('To Coda', 400)[2].toCoda).toBe(true)
  })
  it('ordinary text is left alone', () => {
    const n = nav('Allegro', 300)
    expect(n.every((x) => !x.jump && !x.fine && !x.toCoda && !x.volta)).toBe(true)
    expect(nav('Fine tuning', 300).every((x) => !x.fine)).toBe(true)
  })
})

describe('ending brackets', () => {
  // a line 2 spaces above the staff over bars 3-4, hook down at its left end, "1." beside it
  const y = 400 + 3 * sp
  const bracket = (x0: number, x1: number, label: string, closed: boolean): PagePrims => page(
    text(label, x0 + 3, y - 2 * sp),
    [{ x1: x0, y1: y, x2: x1, y2: y, w: 0.5 }, { x1: x0, y1: y, x2: x0, y2: y - 2 * sp, w: 0.5 }, ...(closed ? [{ x1: x1, y1: y, x2: x1, y2: y - 2 * sp, w: 0.5 }] : [])],
  )
  it('finds the bars under a first ending', () => {
    const n = readNavigation(bracket(300, 400, '1.', true), bars)
    expect(n.map((x) => x.volta)).toEqual([undefined, undefined, [1], undefined])
  })
  it('a two-bar second ending', () => {
    const n = readNavigation(bracket(200, 400, '2.', false), bars)
    expect(n.map((x) => x.volta)).toEqual([undefined, [2], [2], undefined])
  })
  it('a line without a hook or a number is not an ending', () => {
    const p = page([], [{ x1: 300, y1: y, x2: 400, y2: y, w: 0.5 }])
    expect(readNavigation(p, bars).every((x) => !x.volta)).toBe(true)
  })
})
