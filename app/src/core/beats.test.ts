import { describe, expect, it } from 'vitest'
import { beatTimes, estimateGrid, quantize, scaleTempo, shiftOffset } from './beats'
import type { Note } from './models'

// 16 bars of 4/4: strong on beats, eighth notes in between, small human jitter
function song(bpm: number, offset: number): Note[] {
  const p = 60 / bpm, notes: Note[] = []
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5)
  for (let i = 0; i < 128; i++) {
    const down = i % 8 === 0
    notes.push({ pitch: 60 + (i % 7), start: offset + (i * p) / 2 + rnd() * 0.01, duration: 0.2, velocity: down ? 110 : i % 2 === 0 ? 80 : 50 })
  }
  return notes
}

describe('beat grid', () => {
  for (const bpm of [90, 120, 140]) {
    it(`finds ${bpm} bpm and phase`, () => {
      const g = estimateGrid(song(bpm, 0.3))!
      expect(g.bpm).toBeCloseTo(bpm, 0)
      const p = 60 / g.bpm
      const d = ((g.offset - 0.3) % p + p) % p
      expect(Math.min(d, p - d)).toBeLessThan(0.02)
      expect(g.barStart).toBe(0) // note 0 is the strong downbeat
    })
  }
  it('too few notes -> no grid', () => expect(estimateGrid(song(120, 0).slice(0, 3))).toBeUndefined())
  it('x2 / shift / beatTimes', () => {
    const g = { bpm: 100, offset: 0.1, barStart: 0 }
    expect(scaleTempo(g, 2).bpm).toBe(200)
    expect(scaleTempo(g, 0.1)).toBe(g)  // below 30 bpm: ignored
    expect(scaleTempo(g, 4)).toBe(g)    // above 300 bpm: ignored
    expect(shiftOffset(g, 0.05).offset).toBeCloseTo(0.15)
    expect(shiftOffset(g, -0.2).offset).toBeCloseTo(0.5) // wraps into one beat (0.6 s)
    const b = beatTimes(g, 0, 1.3)
    expect(b.map((x) => +x.t.toFixed(2))).toEqual([0.1, 0.7, 1.3])
    expect(b.map((x) => x.bar)).toEqual([true, false, false])
  })
  it('quantize snaps near-grid notes only', () => {
    const g = { bpm: 120, offset: 0, barStart: 0 } // 16th = 0.125 s
    const [a, b] = quantize([
      { pitch: 60, start: 0.51, duration: 0.2, velocity: 90 },  // -> 0.5
      { pitch: 62, start: 0.56, duration: 0.2, velocity: 90 },  // 0.06 from 0.5 and 0.625: left alone
    ], g)
    expect(a.start).toBeCloseTo(0.5)
    expect(b.start).toBeCloseTo(0.56)
  })
})
