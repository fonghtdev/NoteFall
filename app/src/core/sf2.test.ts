import { describe, expect, it } from 'vitest'
import { defaultPreset, lowpass, mixSampled, parseSf2 } from './sf2'
import { tinySf2 } from './sf2.fixture'

const freq = (x: Float32Array, sr: number, from: number, to: number) => { // zero crossings per second
  let c = 0
  for (let i = Math.floor(from * sr) + 1; i < Math.floor(to * sr); i++) if (x[i - 1] <= 0 && x[i] > 0) c++
  return c / (to - from)
}

describe('SoundFont files', () => {
  it('reads the presets and the zones of a file', () => {
    const f = parseSf2(tinySf2())
    expect(f.name).toBe('Tiny test')
    expect(f.presets.map((p) => p.name)).toEqual(['Piano'])
    const r = f.presets[0].regions[0]
    expect([r.keyLo, r.keyHi, r.root, r.loop, r.sample]).toEqual([0, 127, 60, 1, 0])
    expect(defaultPreset(f)).toBe(0)
  })
  it('refuses a file that is not a SoundFont', () => {
    expect(() => parseSf2(new ArrayBuffer(100))).toThrow(/SoundFont/)
  })
  it('plays a note at its pitch: the recorded key sounds as recorded, an octave up sounds twice as fast', async () => {
    const f = parseSf2(tinySf2()), sr = 44100
    for (const [pitch, hz] of [[60, 441], [72, 882], [48, 220.5]] as const) {
      const [L] = await mixSampled(f, 0, [{ pitch, start: 0, duration: 1, velocity: 100 }], sr, sr * 2)
      expect(Math.abs(freq(L, sr, 0.1, 0.9) / hz - 1)).toBeLessThan(0.03)
    }
  })
  it('a louder note is louder, and a note that ends falls silent soon after', async () => {
    const f = parseSf2(tinySf2()), sr = 44100
    const peak = (x: Float32Array, a: number, b: number) => x.slice(Math.floor(a * sr), Math.floor(b * sr)).reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    const [soft] = await mixSampled(f, 0, [{ pitch: 60, start: 0, duration: 0.5, velocity: 30 }], sr, sr * 2)
    const [loud] = await mixSampled(f, 0, [{ pitch: 60, start: 0, duration: 0.5, velocity: 120 }], sr, sr * 2)
    expect(peak(loud, 0.1, 0.4)).toBeGreaterThan(peak(soft, 0.1, 0.4) * 3)
    expect(peak(loud, 0.1, 0.4)).toBeGreaterThan(0.1)
    expect(peak(loud, 1.0, 2.0)).toBeLessThan(0.002)
  })
  it('an attack makes the note come in gradually', async () => {
    const f = parseSf2(tinySf2({ attack: Math.round(1200 * Math.log2(0.3)) })), sr = 44100 // a 0.3 s attack
    const [L] = await mixSampled(f, 0, [{ pitch: 60, start: 0, duration: 1, velocity: 100 }], sr, sr * 2)
    const peak = (a: number, b: number) => L.slice(Math.floor(a * sr), Math.floor(b * sr)).reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    expect(peak(0, 0.05)).toBeLessThan(peak(0.5, 0.9) * 0.4)
  })
  it('the low-pass filter of a zone: a low cutoff takes the tone down, an open one changes nothing; soft notes are darker', async () => {
    const sr = 44100, level = async (cutoff?: number) => { const [L] = await mixSampled(parseSf2(tinySf2({ cutoff })), 0, [{ pitch: 60, start: 0, duration: 1, velocity: 100 }], sr, sr); return Math.max(...L.slice(sr / 2, sr / 2 + 2000).map(Math.abs)) }
    const open = await level(), at262Hz = await level(6000), atTop = await level(13500)
    expect(at262Hz).toBeLessThan(open * 0.5)       // a 441 Hz tone through a 262 Hz low-pass
    expect(atTop).toBe(open)                       // 13500 cents and up: no filter
    expect(parseSf2(tinySf2({ cutoff: 6000 })).presets[0].regions[0].cutoff).toBe(6000)
    const r = { cutoff: 8000, q: 0 }
    expect(lowpass({ cutoff: 13500, q: 0 }, 100, sr)).toBeUndefined()
    expect(lowpass(r, 30, sr)!.b0).toBeLessThan(lowpass(r, 100, sr)!.b0) // velocity 30 closes it; 64 and up leave it where the zone puts it
    expect(lowpass(r, 64, sr)).toEqual(lowpass(r, 127, sr))
  })
})
