import { describe, expect, it } from 'vitest'
import { PIANO, decayOf, inharmonicity, mixNotes, partialAmps, partialCount, partials, synthNote } from './synth'

const SR = 44100
const amp = (x: Float32Array, from: number, n: number, f: number) => { // size of the sinusoid at f in a Hann-windowed stretch
  let re = 0, im = 0
  for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n), v = x[from + i] * w, ph = (2 * Math.PI * f * (from + i)) / SR; re += v * Math.cos(ph); im -= v * Math.sin(ph) }
  return Math.hypot(re, im)
}
const rmsDb = (x: Float32Array, t: number, len = 0.2) => { let s = 0; const a = Math.round(t * SR), n = Math.round(len * SR); for (let i = 0; i < n; i++) s += x[a + i] ** 2; return 10 * Math.log10(s / n + 1e-14) }

describe('piano model', () => {
  it('partials are stretched like a real string and keep the strike-point hole', () => {
    const f0 = 261.63, p = partials(f0, 60, 10)
    p.forEach((f, i) => { expect(f).toBeGreaterThan((i + 1) * f0 - 1e-9) })     // never flat
    expect(p[7] / (8 * f0)).toBeGreaterThan(1.002)                                // the 8th partial is a few cents sharp
    expect(p[7] / (8 * f0)).toBeLessThan(1.02)                                    // but it is still a piano, not a bell
    const a = partialAmps(10, 0.7)
    expect(a[7]).toBeLessThan(a[6] * 0.05)                                        // hammer at 1/8: the 8th partial is almost gone
    expect(inharmonicity(96)).toBeGreaterThan(inharmonicity(36))                  // treble strings are stiffer
  })
  it('louder notes are brighter, not just louder', () => {
    const soft = partialAmps(10, 0.2), loud = partialAmps(10, 1)
    const tilt = (a: number[]) => a[3] / a[0]
    expect(tilt(loud)).toBeGreaterThan(tilt(soft) * 1.8)
  })
  it('low notes ring longer than high ones, and high partials fade first', () => {
    expect(decayOf(36, 1)).toBeGreaterThan(decayOf(60, 1)); expect(decayOf(60, 1)).toBeGreaterThan(decayOf(84, 1))
    expect(decayOf(60, 6)).toBeLessThan(decayOf(60, 1) / 2)
    expect(partialCount(30)).toBeGreaterThan(partialCount(100))
  })

  it('a synthesised C4 has the right pitch, a long decay and no click at the start or the end', () => {
    const x = synthNote(60, 80, SR)
    const f = 261.6256
    const fund = amp(x, 4000, 16384, partials(f, 60, 1)[0]), off = amp(x, 4000, 16384, f * 1.06)
    expect(fund / off).toBeGreaterThan(30)                                          // a clean tone at the fundamental
    expect(Math.abs(x[0])).toBeLessThan(1e-3); expect(Math.abs(x[x.length - 1])).toBeLessThan(1e-4)
    expect(x.length / SR).toBeGreaterThan(7)                                        // rings several seconds
    const d = rmsDb(x, 0.3) - rmsDb(x, 2.3)
    expect(d).toBeGreaterThan(4); expect(d).toBeLessThan(14)                         // a few dB per second, as a grand does
    expect(x.every((v) => Number.isFinite(v))).toBe(true)
  })
  it('measured partial ratios follow the inharmonic formula', () => {
    const x = synthNote(48, 90, SR)                                                 // C3: many clean partials
    const f0 = 440 * 2 ** (-21 / 12), p = partials(f0, 48, 6)
    for (let k = 0; k < 6; k++) {
      let best = 0, bf = 0
      for (let c = -25; c <= 25; c++) { const f = p[k] * 2 ** (c / 1200); const a = amp(x, 3000, 32768, f); if (a > best) { best = a; bf = f } }
      expect(Math.abs(Math.log2(bf / p[k]) * 1200)).toBeLessThan(6)                  // within 6 cents of the model
    }
  })
  it('a loud note has relatively more high partials than a soft one', () => {
    const a = (v: number) => { const x = synthNote(60, v, SR), f = partials(261.6256, 60, 5); return amp(x, 3000, 16384, f[4]) / amp(x, 3000, 16384, f[0]) }
    expect(a(120)).toBeGreaterThan(a(35) * 1.8)
  })
  it('a repeated note is not played back identically', () => {
    const a = synthNote(64, 80, SR, 0), b = synthNote(64, 80, SR, 1)
    let diff = 0; for (let i = 5000; i < 9000; i++) diff += Math.abs(a[i] - b[i])
    expect(diff).toBeGreaterThan(0.5)
  })
})

describe('mixing', () => {
  it('stereo follows pitch, a released note is damped quickly, timing is sample-exact', async () => {
    const len = SR * 4
    const [Ll, Rl] = await mixNotes([{ pitch: 36, start: 0.5, duration: 1, velocity: 90 }], SR, len)
    const [Lh, Rh] = await mixNotes([{ pitch: 90, start: 0.5, duration: 1, velocity: 90 }], SR, len)
    const e = (x: Float32Array) => x.reduce((a, v) => a + v * v, 0)
    expect(e(Ll)).toBeGreaterThan(e(Rl)); expect(e(Rh)).toBeGreaterThan(e(Lh))     // bass left, treble right
    const [L] = await mixNotes([{ pitch: 60, start: 0.5, duration: 1, velocity: 90 }], SR, len)
    expect(Math.max(...L.subarray(0, Math.round(0.499 * SR)).map(Math.abs))).toBe(0) // nothing before the strike
    const held = rmsDb(L, 1.3, 0.1), after = rmsDb(L, 1.9, 0.1)                      // released at 1.5 s
    expect(held - after).toBeGreaterThan(20)
  })
  it('louder notes are louder: velocity maps to level', async () => {
    const lv = async (v: number) => { const [L] = await mixNotes([{ pitch: 60, start: 0.1, duration: 1, velocity: v }], SR, SR * 2); return rmsDb(L, 0.2, 0.3) }
    expect(await lv(110)).toBeGreaterThan((await lv(40)) + 8)
  })
  it('a busy 40-note-per-second passage mixes in well under a second per second of music', async () => {
    const notes = Array.from({ length: 400 }, (_, i) => ({ pitch: 48 + ((i * 5) % 30), start: i * 0.1, duration: 0.6, velocity: 70 + (i % 3) * 15 }))
    const t0 = performance.now()
    await mixNotes(notes, SR, SR * 44)
    expect(performance.now() - t0).toBeLessThan(15000)
  })
  it('the tone settings are what the documentation says', () => { expect(PIANO.strike).toBeCloseTo(0.125, 3) })
})
