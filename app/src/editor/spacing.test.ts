import { describe, expect, it } from 'vitest'
import { TPQ } from './model'
import { NATURAL, forceFor, gapWidth, gapsOf, leadOf, stretchOf, type Col } from './spacing'

const sum = (g: ReturnType<typeof gapsOf>, f: number) => g.reduce((a, x) => a + gapWidth(x, f), 0)
const head = (tick: number, extra = 0): Col => ({ tick, left: 0, right: 11 + extra })

describe('horizontal spacing', () => {
  it('shorter notes take less room, by a steady ratio', () => {
    expect(stretchOf(TPQ)).toBe(1)
    expect(stretchOf(TPQ / 2) / stretchOf(TPQ)).toBeCloseTo(1 / 1.5)
    expect(stretchOf(TPQ * 2) / stretchOf(TPQ)).toBeCloseTo(1.5)
  })
  it('a column that reaches far (ledger lines, dots) never gets less than it needs, whatever the line does', () => {
    const g = gapsOf([head(0, 8), head(TPQ / 4)], TPQ / 2) // sixteenths, the first with a dot
    expect(gapWidth(g[0], 0)).toBeGreaterThanOrEqual(19 + 2) // right 19 + next.left 0 + air
    expect(gapWidth(g[0], forceFor(g, 5))).toBeGreaterThanOrEqual(21)
  })
  it('a line is stretched to the width asked for, evenly in time: a half note keeps more room than an eighth', () => {
    const bar = gapsOf([head(0), head(TPQ * 2), head(TPQ * 3), head(TPQ * 3.5)], TPQ * 4)
    const f = forceFor(bar, 400)
    expect(sum(bar, f)).toBeCloseTo(400, 1)
    expect(gapWidth(bar[0], f)).toBeGreaterThan(gapWidth(bar[1], f))
    expect(gapWidth(bar[1], f)).toBeGreaterThan(gapWidth(bar[3], f))
  })
  it('natural force gives natural widths, and a line that is too long is squeezed down to the minimums at most', () => {
    const bar = gapsOf([head(0), head(TPQ), head(TPQ * 2), head(TPQ * 3)], TPQ * 4)
    expect(sum(bar, NATURAL)).toBeCloseTo(4 * NATURAL, 5)
    const f = forceFor(bar, 60) // asked for less than the minimums allow
    expect(sum(bar, f)).toBeGreaterThanOrEqual(4 * 13)
  })
  it('a bar of rests is one spring; the lead before the first column covers its accidentals', () => {
    expect(gapsOf([], TPQ * 4)).toHaveLength(1)
    expect(leadOf([{ tick: 0, left: 9, right: 11 }])).toBeGreaterThan(9)
    expect(leadOf([])).toBe(0)
  })
})
