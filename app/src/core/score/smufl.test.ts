import { describe, expect, it } from 'vitest'
import minuet from './fixtures/minuet-p1.json'
import { readScore } from './omr'
import { SMUFL_TO_SONATA, fromSmufl } from './smufl'
import { extractPrims, type PagePrims } from './primitives'

const strip = (s: ReturnType<typeof readScore>) => JSON.stringify(s.measures.map((m) => m.notes))

describe('SMuFL fonts (MuseScore 4, Dorico, LilyPond)', () => {
  it('the same page written with SMuFL symbols reads exactly the same', () => {
    const page = minuet as unknown as PagePrims
    const back = new Map(Object.entries(SMUFL_TO_SONATA).map(([smufl, sonata]) => [sonata, +smufl]))
    back.set(0xf0fa, 0xe0a3) // several SMuFL symbols share one Sonata twin: pick one for the round trip
    back.set(0xf026, 0xe050); back.set(0xf03f, 0xe062); back.set(0xf055, 0xe4c0)
    const asSmufl: PagePrims = { ...page, glyphs: page.glyphs.map((g) => ({ ...g, code: back.get(g.code) ?? g.code })) }
    expect(asSmufl.glyphs.some((g) => g.code === 0xe0a4)).toBe(true) // really converted
    const a = readScore([page]), b = readScore([asSmufl])
    expect(b.measures.length).toBe(a.measures.length)
    expect(strip(b)).toBe(strip(a))
    expect(b.measures.every((m) => !m.suspect)).toBe(true)
  })

  it('a whole rest standing alone fills the bar, also in 3/8', () => {
    // build one 3/8 bar holding only a whole rest, using the Minuet page as a frame: remove its notes and put the rest in bar 1
    const page = minuet as unknown as PagePrims
    const rest = page.glyphs.find((g) => g.code === 0xf0ce)
    expect(rest).toBeDefined() // the sample has quarter rests; reuse one as a "whole rest" symbol
    const only: PagePrims = { ...page, glyphs: page.glyphs.filter((g) => g.code < 0xf000 || g.code > 0xf0ff || g.code === 0xf026 || g.code === 0xf03f || (g.code >= 0xf030 && g.code <= 0xf039)) }
    const s = readScore([only])
    expect(s.measures.every((m) => m.notes.length === 0)).toBe(true) // nothing but clefs and the time signature left
  })
})

describe('text placement', () => {
  it('Td moves (MuseScore 4) and the font size from setFont are honoured', async () => {
    const OPS = { save: 1, restore: 2, transform: 3, setFont: 4, setTextMatrix: 5, moveText: 6, showText: 7, beginText: 8, constructPath: 9, setLineWidth: 10, setCharSpacing: 11, stroke: 12, fill: 13, eoFill: 14, fillStroke: 15, closeStroke: 16 }
    const glyph = (u: string) => ({ unicode: u, width: 1000, isSpace: false })
    const ops: [number, unknown[]][] = [
      [OPS.transform, [0.06, 0, 0, -0.06, 0, 792]],                  // page flip + scale, like the writer's own matrix
      [OPS.beginText, []], [OPS.setFont, ['f', 100]], [OPS.setTextMatrix, [1, 0, 0, -1, 0, 0]], [OPS.moveText, [1000, -2000]],
      [OPS.showText, [[glyph('')]]],
      [OPS.moveText, [500, -500]],                                     // relative to the previous move
      [OPS.showText, [[glyph('')]]],
    ]
    const page = { view: [0, 0, 612, 792], getOperatorList: async () => ({ fnArray: ops.map((o) => o[0]), argsArray: ops.map((o) => o[1]) }) }
    const p = await extractPrims(page, OPS as unknown as Record<string, number>)
    expect(p.glyphs).toHaveLength(2)
    expect(p.glyphs[0].x).toBeCloseTo(60, 5); expect(p.glyphs[0].y).toBeCloseTo(792 - 120, 5)
    expect(p.glyphs[1].x).toBeCloseTo(90, 5); expect(p.glyphs[1].y).toBeCloseTo(792 - 150, 5)   // both moves added up
    expect(p.glyphs[0].size).toBeCloseTo(6, 5)                       // 100 (font size) * 0.06
    expect(p.glyphs[0].w).toBeCloseTo(6, 5)                          // a 1000-unit advance is one em
  })
})

describe('tuplet numbers written in a text font', () => {
  const g = (code: number, x: number, y = 100) => ({ code, x, y, font: 't', size: 9 }) as unknown as PagePrims['glyphs'][number]
  it('a lone digit is a tuplet number, two digits side by side (a tempo) are not', () => {
    const out = fromSmufl({ glyphs: [g(0x33, 50), g(0x36, 200, 300), g(0x32, 205, 300)], segs: [], polys: [] } as unknown as PagePrims).glyphs.map((q) => q.code)
    expect(out).toEqual([0xf113, 0x36, 0x32])
  })
})

describe('pages written the way MuseScore 4 writes them', () => {
  const page = minuet as unknown as PagePrims
  it('staff lines drawn as one piece per bar still make staves', () => {
    const pieces = page.segs.flatMap((s) => {
      if (Math.abs(s.y1 - s.y2) > 0.01 || Math.abs(s.x2 - s.x1) < 100) return [s]
      const w = (s.x2 - s.x1) / 4
      return [0, 1, 2, 3].map((k) => ({ ...s, x1: s.x1 + k * w, x2: s.x1 + (k + 1) * w }))
    })
    expect(strip(readScore([{ ...page, segs: pieces }])) === strip(readScore([page]))).toBe(true)
  })
  it('a dot after a rest makes it longer (the bar no longer adds up)', () => {
    const rest = page.glyphs.find((g) => g.code === 0xf0ce)!
    const dotted = { ...page, glyphs: [...page.glyphs, { ...rest, code: 0xf0aa, x: rest.x + rest.w + 2, w: 2 }] }
    const bad = (p: PagePrims) => readScore([p]).measures.filter((m) => m.suspect).length
    expect(bad(page)).toBe(0)
    expect(bad(dotted)).toBeGreaterThan(0)
  })
})
