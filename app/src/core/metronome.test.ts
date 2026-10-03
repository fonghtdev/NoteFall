import { describe, expect, it } from 'vitest'
import { clickStep, gridForSignature } from './beats'
import { fromText } from '../editor/demo'
import { toPerformance } from '../editor/perform'
import { scoreClicks, secondsAt, tempoRatios } from './score/playback'

describe('metronome beats', () => {
  it('click step per time signature', () => {
    expect([[4, 4], [3, 4], [2, 2], [6, 8], [9, 8], [12, 8], [3, 8], [5, 8], [7, 8], [4, 16]].map(([b, u]) => clickStep(b, u))).toEqual([1, 1, 2, 1.5, 1.5, 1.5, 0.5, 0.5, 0.5, 0.25])
  })
  it('grid for 6/8 at quarter = 90: two clicks per bar, one per second', () => {
    const g = gridForSignature(90, 6, 8)
    expect(g.beatsPerBar).toBe(2); expect(60 / g.bpm).toBeCloseTo(1, 5)      // a dotted quarter = 1.5 quarters of 2/3 s
  })
  it('clicks of a piece: accents on the first beat, repeats played twice, tempo changes respected', () => {
    const s = fromText([{ rh: 'C5:4', lh: 'r:4' }, { rh: 'D5:4', lh: 'r:4' }], { tempo: 60 })
    s.measures[0].startRepeat = true; s.measures[1].endRepeat = true
    s.measures[1].tempo = 120
    const p = toPerformance(s)
    const c = scoreClicks(p, true, 60, tempoRatios(p, true))
    expect(c.filter((x) => x.accent)).toHaveLength(4)             // 2 bars x 2 passes
    expect(c.map((x) => +x.t.toFixed(3))).toEqual([0, 1, 2, 3, 4, 4.5, 5, 5.5, 6, 7, 8, 9, 10, 10.5, 11, 11.5].slice(0, c.length)) // bar 1 at 60, bar 2 at 120; pass 2 again
    expect(c).toHaveLength(16)
  })
  it('6/8 bar: clicks on the dotted quarter', () => {
    const s = fromText([{ rh: 'C5:3', lh: 'r:3' }], { beats: 6, unit: 8, tempo: 60 })
    const c = scoreClicks(toPerformance(s), true, 60)
    expect(c.map((x) => x.t)).toEqual([0, 1.5]); expect(c.map((x) => x.accent)).toEqual([true, false])
    expect(secondsAt(3, 60)).toBe(3)
  })
})

import { afterEach, beforeEach, vi } from 'vitest'
import { DEFAULT_CLICK, Follower, type ClickSource } from './metronome'

describe('Follower', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const beats: ClickSource = (a, b) => { const out = []; for (let k = Math.ceil(a); k <= b; k++) out.push({ t: k, accent: k % 4 === 0 }); return out } // one click per second from 0
  it('sounds every click once, at the right moment, with the accent on the bar start', () => {
    let song = -0.2
    const ctx = { currentTime: 100 } as unknown as AudioContext
    const played: { when: number; accent: boolean }[] = []
    const f = new Follower(ctx, () => song, () => beats, () => DEFAULT_CLICK, undefined, (_c, when, accent) => { played.push({ when, accent }) })
    f.start()
    for (let i = 0; i < 160; i++) { vi.advanceTimersByTime(25); song += 0.025; (ctx as { currentTime: number }).currentTime += 0.025 } // four seconds of playing
    f.stop()
    expect(played.length).toBe(4)                                   // the song ran from -0.2 to 3.8 s: clicks at 0, 1, 2, 3 (4 s is still ahead)
    expect(played.map((p) => p.accent)).toEqual([true, false, false, false])
    expect(played[0].when - 100).toBeCloseTo(0.2, 1)               // 0.2 s after the start: the song was at -0.2
    expect(played[1].when - played[0].when).toBeCloseTo(1, 1)
  })
  it('after a seek it forgets what it had scheduled', () => {
    let song = 0.5
    const ctx = { currentTime: 0 } as unknown as AudioContext
    const played: number[] = []
    const f = new Follower(ctx, () => song, () => beats, () => DEFAULT_CLICK, undefined, (_c, when) => { played.push(+when.toFixed(2)) })
    f.start(); vi.advanceTimersByTime(100)
    song = 7.95; f.reset(); vi.advanceTimersByTime(100)
    f.stop()
    expect(played.some((w) => Math.abs(w - 0.05) < 0.2)).toBe(true) // 8 s is 0.05 s ahead of 7.95
  })
  it('stops cleanly and makes no sound with no source', () => {
    const ctx = { currentTime: 0 } as unknown as AudioContext
    let n = 0
    const f = new Follower(ctx, () => 0, () => undefined, () => DEFAULT_CLICK, undefined, () => { n++ })
    f.start(); vi.advanceTimersByTime(300); f.stop(); vi.advanceTimersByTime(300)
    expect(n).toBe(0); expect(f.running).toBe(false)
  })
})
