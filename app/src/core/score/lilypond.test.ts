import { describe, expect, it } from 'vitest'
import { smuflOfName } from './glyphNames'
import { whyUnreadable } from './pdf'
import { findStaves } from './omr'
import { extractPrims, type PagePrims, type Seg } from './primitives'

// PDFs from LilyPond (Mutopia and others): symbols have names instead of fixed codes, chord notes are stacked with a line feed, and long strokes lie between the staff lines.
describe('glyph names', () => {
  it('turns Emmentaler names into SMuFL codes, whatever character the file used for them', () => {
    expect(smuflOfName('noteheads.s2')).toBe(0xe0a4)
    expect(smuflOfName('clefs.G')).toBe(0xe050)
    expect(smuflOfName('rests.2')).toBe(0xe4e5)
    expect(smuflOfName('flags.u3')).toBe(0xe240)
    expect(smuflOfName('f', 'ABCDEF+Emmentaler-16')).toBe(0xe522)   // a dynamic letter counts only in a music font
    expect(smuflOfName('f', 'ABCDEF+CenturySchL-Roma')).toBeUndefined()
    expect(smuflOfName('brace201')).toBeUndefined()
  })
})

describe('reading the page', () => {
  const OPS = { beginText: 1, setFont: 2, setTextMatrix: 3, showText: 4, setLeading: 5, nextLine: 6, endText: 7 } as Record<string, number>
  const glyph = (code: number) => ({ originalCharCode: code, unicode: String.fromCharCode(code), width: 330, isSpace: false })
  const fakePage = (ops: [number, unknown][]) => ({
    view: [0, 0, 600, 800],
    getOperatorList: async () => ({ fnArray: ops.map((o) => o[0]), argsArray: ops.map((o) => o[1]) }),
    commonObjs: { get: (_id: string, done: (f: unknown) => void) => done({ name: 'ABCDEF+Emmentaler-16', differences: { 0: 'noteheads.s2' } }) },
  })

  it('reads a chord LilyPond writes with a line feed between its notes, and names the head by its glyph name', async () => {
    const p = await extractPrims(fakePage([
      [OPS.beginText, null], [OPS.setFont, ['f1', 20]], [OPS.setTextMatrix, [1, 0, 0, 1, 100, 300]],
      [OPS.showText, [[glyph(0)]]], [OPS.setLeading, [10]], [OPS.nextLine, undefined], [OPS.showText, [[glyph(0)]]], [OPS.nextLine, undefined], [OPS.showText, [[glyph(0)]]], [OPS.endText, null],
    ]), OPS)
    expect(p.glyphs.map((g) => [g.code, g.y])).toEqual([[0xe0a4, 300], [0xe0a4, 290], [0xe0a4, 280]])
  })
})

describe('finding the staves', () => {
  const line = (y: number, x1 = 0, x2 = 500): Seg => ({ x1, y1: y, x2, y2: y, w: 0.5 })
  const page = (segs: Seg[]): PagePrims => ({ width: 600, height: 800, glyphs: [], segs, polys: [], curves: [] })
  const staff = [100, 105, 110, 115, 120]

  it('finds a staff with a long stroke between its lines', () => {
    const [s, ...rest] = findStaves(page([...staff.map((y) => line(y)), line(112)]))
    expect(rest).toHaveLength(0)
    expect([s.top, s.bottom]).toEqual([120, 100])
  })
  it('keeps the whole length of a staff line when a short stroke sits a hair above it', () => {
    const [s] = findStaves(page([...staff.map((y) => line(y)), line(99.97, 400, 450)]))
    expect(s.x1 - s.x0).toBe(500)
  })
  it('finds two staves one below the other', () => {
    expect(findStaves(page([...staff, ...staff.map((y) => y + 60)].map((y) => line(y))))).toHaveLength(2)
  })
})

describe('a PDF that gives no bars', () => {
  const blank = { width: 600, height: 800, glyphs: [], segs: [], polys: [], curves: [] }
  it('says a page of pictures is a scan, and anything drawn but unread is an unknown writer', () => {
    expect(whyUnreadable([blank, blank])).toMatch(/ảnh chụp hoặc bản scan/)
    expect(whyUnreadable([blank, { ...blank, segs: [{ x1: 0, y1: 1, x2: 9, y2: 1, w: 1 }] }])).toMatch(/chưa hỗ trợ/)
  })
})
