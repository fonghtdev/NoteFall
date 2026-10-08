import { describe, expect, it } from 'vitest'
import { hitTest } from './hit'
import type { DrawnEv, Layout } from './render'

const ev = (id: number, at: number, ticks: number, x: number, rest: boolean): DrawnEv => ({ id, m: 0, staff: 0, voice: 0, at, ticks, x, rest, ys: [], left: 0, right: 11 })
const page = (evs: DrawnEv[]): Layout => ({ width: 600, height: 100, systems: [], graces: [], measures: [{ m: 0, x: 80, w: 440, system: 0, notes: [100, 500], staves: [{ top: 0, bottom: 40, spacing: 10, clef: 'treble' }], evs }] })

describe('hitTest inside a rest (entering notes)', () => {
  it('a whole-bar rest (drawn in the middle) gives the beat under the pointer, on the grid of the length entered', () => {
    const l = page([ev(1, 0, 3840, 300, true)])
    expect(hitTest(l, 400, 20, 0, 960)?.at).toBe(2880) // 3/4 of the way: beat 4
    expect(hitTest(l, 400, 20, 0, 1920)?.at).toBe(1920) // halves: the second half
    expect(hitTest(l, 150, 20, 0, 960)?.at).toBe(0)
    expect(hitTest(l, 400, 20, 0)?.at).toBe(0)           // no length (picking): the column, as before
  })
  it('a rest after a note: its own room only; on the note it is that note column', () => {
    const l = page([ev(1, 0, 1920, 110, false), ev(2, 1920, 1920, 300, true)])
    expect(hitTest(l, 420, 20, 0, 960)?.at).toBe(2880)
    expect(hitTest(l, 120, 20, 0, 960)?.at).toBe(0)
  })
})
