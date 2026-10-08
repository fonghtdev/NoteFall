import { soundEnd, type Note } from './models'

/**
 * SoundFont 2 (.sf2): a bank of recorded instruments. This reads the file and plays notes from it (the parts of the format a piano needs):
 * key and velocity ranges, root key and tuning, looping, the volume envelope (delay, attack, hold, decay, sustain, release), pan, attenuation,
 * and the low-pass filter (a library's "bright" and "dark" pianos are often the same samples with another cutoff), darkened for soft notes by the default velocity modulator.
 * LFOs, the modulation envelope and other modulators are ignored.
 */

/** One playable zone: which keys and velocities it answers, and how its sample is played. */
export interface Region {
  keyLo: number; keyHi: number; velLo: number; velHi: number
  sample: number             // index into the sample headers
  start: number; end: number; loopStart: number; loopEnd: number // frames inside the sample data
  loop: 0 | 1 | 3            // 0 none, 1 loop while sounding, 3 loop while the key is held
  root: number               // MIDI key the sample was recorded at
  cents: number              // extra tuning
  scale: number              // cents per key (100 = normal)
  pan: number                // -1 left .. 1 right
  gain: number               // linear, from the attenuation
  delay: number; attack: number; hold: number; decay: number; sustain: number; release: number // seconds, sustain a level 0..1
  cutoff: number; q: number  // low-pass filter: cutoff in cents (13500 and up = open), resonance in centibels
}
export interface Preset { name: string; bank: number; program: number; regions: Region[] }
interface SampleHeader { name: string; start: number; end: number; loopStart: number; loopEnd: number; rate: number; pitch: number; correction: number; type: number }
export interface SoundFont { name: string; presets: Preset[]; samples: SampleHeader[]; pcm: Int16Array }

const str = (v: DataView, at: number, n: number) => { let s = ''; for (let i = 0; i < n; i++) { const c = v.getUint8(at + i); if (!c) break; s += String.fromCharCode(c) } return s }
const tc = (x: number) => 2 ** (x / 1200) // timecents -> seconds

interface Zone { gens: Map<number, number>; lo: [number, number]; vel: [number, number] }
const GEN = { startOff: 0, endOff: 1, startLoopOff: 2, endLoopOff: 3, startCoarse: 4, filterFc: 8, filterQ: 9, endCoarse: 12, pan: 17, delay: 33, attack: 34, hold: 35, decay: 36, sustain: 37, release: 38, instrument: 41, keyRange: 43, velRange: 44, startLoopCoarse: 45, attenuation: 48, endLoopCoarse: 50, coarse: 51, fine: 52, sampleId: 53, sampleModes: 54, scale: 56, root: 58 }
const RANGES = new Set<number>([GEN.keyRange, GEN.velRange])

/** The zones of one preset / instrument from its bag, generator and header lists; the first zone with no target is the global one. */
function zonesOf(bagFrom: number, bagTo: number, bags: [number, number][], gens: [number, number][], target: number): { global?: Zone; zones: Zone[] } {
  const out: Zone[] = []
  let global: Zone | undefined
  for (let b = bagFrom; b < bagTo; b++) {
    const g = new Map<number, number>()
    let key: [number, number] = [0, 127], vel: [number, number] = [0, 127]
    for (let i = bags[b][0]; i < bags[b + 1][0]; i++) {
      const [op, amt] = gens[i]
      if (op === GEN.keyRange) key = [amt & 255, (amt >> 8) & 255]
      else if (op === GEN.velRange) vel = [amt & 255, (amt >> 8) & 255]
      else g.set(op, op === GEN.instrument || op === GEN.sampleId ? amt : amt > 32767 ? amt - 65536 : amt) // generator amounts are signed words (an instrument or sample number is not)
    }
    const z = { gens: g, lo: key, vel }
    if (g.has(target)) out.push(z)
    else if (b === bagFrom) global = z
  }
  return { global, zones: out }
}

export function parseSf2(buf: ArrayBuffer): SoundFont {
  const v = new DataView(buf)
  if (v.byteLength < 12 || str(v, 0, 4) !== 'RIFF' || str(v, 8, 4) !== 'sfbk') throw new Error('Đây không phải file SoundFont (.sf2)')
  const chunks = new Map<string, [number, number]>() // chunk id -> [data offset, length]
  const walk = (from: number, to: number) => {
    for (let at = from; at + 8 <= to;) {
      const id = str(v, at, 4), len = v.getUint32(at + 4, true)
      if (id === 'LIST') walk(at + 12, at + 8 + len); else chunks.set(id, [at + 8, len])
      at += 8 + len + (len & 1)
    }
  }
  walk(12, v.byteLength)
  const need = (id: string) => { const c = chunks.get(id); if (!c) throw new Error(`File SoundFont thiếu phần "${id}"`); return c }
  const [smplAt, smplLen] = need('smpl')
  const pcm = new Int16Array(buf.slice(smplAt, smplAt + (smplLen & ~1)))
  const table = <T>(id: string, size: number, read: (at: number) => T): T[] => { const [at, len] = need(id); return Array.from({ length: Math.floor(len / size) }, (_, i) => read(at + i * size)) }
  const phdr = table('phdr', 38, (a) => ({ name: str(v, a, 20), program: v.getUint16(a + 20, true), bank: v.getUint16(a + 22, true), bag: v.getUint16(a + 24, true) }))
  const pbag = table<[number, number]>('pbag', 4, (a) => [v.getUint16(a, true), v.getUint16(a + 2, true)])
  const pgen = table<[number, number]>('pgen', 4, (a) => [v.getUint16(a, true), v.getUint16(a + 2, true)])
  const inst = table('inst', 22, (a) => ({ name: str(v, a, 20), bag: v.getUint16(a + 20, true) }))
  const ibag = table<[number, number]>('ibag', 4, (a) => [v.getUint16(a, true), v.getUint16(a + 2, true)])
  const igen = table<[number, number]>('igen', 4, (a) => [v.getUint16(a, true), v.getUint16(a + 2, true)])
  const samples = table<SampleHeader>('shdr', 46, (a) => ({ name: str(v, a, 20), start: v.getUint32(a + 20, true), end: v.getUint32(a + 24, true), loopStart: v.getUint32(a + 28, true), loopEnd: v.getUint32(a + 32, true), rate: v.getUint32(a + 36, true), pitch: v.getUint8(a + 40), correction: v.getInt8(a + 41), type: v.getUint16(a + 44, true) })).slice(0, -1) // (the last header is a terminator)

  const presets: Preset[] = []
  for (let p = 0; p < phdr.length - 1; p++) {
    const { global: pg, zones: pz } = zonesOf(phdr[p].bag, phdr[p + 1].bag, pbag, pgen, GEN.instrument)
    const regions: Region[] = []
    for (const z of pz) {
      const ii = z.gens.get(GEN.instrument)!
      const { global: ig, zones: iz } = zonesOf(inst[ii].bag, inst[ii + 1].bag, ibag, igen, GEN.sampleId)
      for (const s of iz) {
        const key: [number, number] = [Math.max(s.lo[0], z.lo[0]), Math.min(s.lo[1], z.lo[1])], vel: [number, number] = [Math.max(s.vel[0], z.vel[0]), Math.min(s.vel[1], z.vel[1])]
        if (key[0] > key[1] || vel[0] > vel[1]) continue
        const g = (op: number, dflt: number) => (s.gens.get(op) ?? ig?.gens.get(op) ?? dflt) + ((z.gens.get(op) ?? pg?.gens.get(op) ?? 0) * (RANGES.has(op) ? 0 : 1)) // an instrument value, plus what the preset adds to it
        const sid = s.gens.get(GEN.sampleId)!, sh = samples[sid]
        if (!sh) continue
        const root = g(GEN.root, -1)
        const mode = g(GEN.sampleModes, 0) & 3
        const type = sh.type & 0x7fff
        regions.push({
          keyLo: key[0], keyHi: key[1], velLo: vel[0], velHi: vel[1], sample: sid,
          start: sh.start + g(GEN.startOff, 0) + g(GEN.startCoarse, 0) * 32768, end: sh.end + g(GEN.endOff, 0) + g(GEN.endCoarse, 0) * 32768,
          loopStart: sh.loopStart + g(GEN.startLoopOff, 0) + g(GEN.startLoopCoarse, 0) * 32768, loopEnd: sh.loopEnd + g(GEN.endLoopOff, 0) + g(GEN.endLoopCoarse, 0) * 32768,
          loop: mode === 1 ? 1 : mode === 3 ? 3 : 0,
          root: root >= 0 ? root : sh.pitch, cents: g(GEN.coarse, 0) * 100 + g(GEN.fine, 0) + sh.correction, scale: g(GEN.scale, 100),
          pan: Math.max(-1, Math.min(1, s.gens.has(GEN.pan) || ig?.gens.has(GEN.pan) ? g(GEN.pan, 0) / 500 : type === 4 ? -1 : type === 2 ? 1 : 0)),
          gain: 10 ** (-Math.max(0, g(GEN.attenuation, 0)) / 200),
          delay: tc(g(GEN.delay, -12000)), attack: tc(g(GEN.attack, -12000)), hold: tc(g(GEN.hold, -12000)), decay: tc(g(GEN.decay, -12000)),
          sustain: 10 ** (-Math.min(1440, Math.max(0, g(GEN.sustain, 0))) / 200), release: tc(g(GEN.release, -12000)),
          cutoff: g(GEN.filterFc, 13500), q: Math.max(0, g(GEN.filterQ, 0)),
        })
      }
    }
    if (regions.length) presets.push({ name: phdr[p].name, bank: phdr[p].bank, program: phdr[p].program, regions })
  }
  let name = 'SoundFont'
  const info = chunks.get('INAM'); if (info) name = str(v, info[0], info[1]) || name
  return { name, presets, samples, pcm }
}

/** The preset a piano player wants: bank 0, program 0 (GM "Acoustic Grand Piano"), else the first one. */
export const defaultPreset = (f: SoundFont) => Math.max(0, f.presets.findIndex((p) => p.bank === 0 && p.program === 0))

/**
 * The region's low-pass filter for a note of velocity `vel` (undefined: open), a two-pole (RBJ) low-pass. SoundFont 2.04's default modulator
 * closes it for soft notes: up to 2400 cents, below velocity 64 only.
 * ponytail: the default modulator only; a library's own velocity-to-cutoff modulators are not read (GeneralUser has some), parse pmod/imod if one sounds off.
 */
export function lowpass(r: Pick<Region, 'cutoff' | 'q'>, vel: number, sr: number): { b0: number; b1: number; b2: number; a1: number; a2: number } | undefined {
  if (r.cutoff >= 13500) return undefined
  const cents = r.cutoff - (vel < 64 ? 2400 * (1 - vel / 127) : 0)
  const f = Math.min(0.45 * sr, 8.176 * 2 ** (cents / 1200)), Q = 10 ** ((r.q / 10 - 3.01) / 20)
  const w = (2 * Math.PI * f) / sr, alpha = Math.sin(w) / (2 * Math.max(0.5, Q)), c = Math.cos(w), a0 = 1 + alpha
  return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - alpha) / a0 }
}

/** Mix notes from a preset into stereo (no effects). Samples are decoded once, on first use, and played back by linear interpolation. */
export async function mixSampled(f: SoundFont, presetIndex: number, notes: Note[], sr: number, length: number): Promise<[Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]> {
  const L = new Float32Array(length), R = new Float32Array(length)
  const preset = f.presets[presetIndex] ?? f.presets[0]
  if (!preset) return [L, R]
  const decoded = new Map<number, Float32Array>()
  const dataOf = (r: Region) => { let d = decoded.get(r.sample); if (!d) { const h = f.samples[r.sample]; d = Float32Array.from(f.pcm.subarray(h.start, h.end + 1), (x) => x / 32768); decoded.set(r.sample, d) } return d }
  let worked = performance.now()
  for (const n of notes) {
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity)))
    const off = Math.max(n.start + 0.06, soundEnd(n)), held = off - n.start
    const vg = (vel / 127) ** 1.7 // the usual concave velocity curve
    for (const r of preset.regions) {
      if (n.pitch < r.keyLo || n.pitch > r.keyHi || vel < r.velLo || vel > r.velHi) continue
      const data = dataOf(r), h = f.samples[r.sample], base = h.start
      const rate = (2 ** (((n.pitch - r.root) * r.scale + r.cents) / 1200) * h.rate) / sr
      const last = data.length - 1, ls = r.loopStart - base, le = r.loopEnd - base
      const looping = r.loop !== 0 && le > ls + 1
      const ang = ((r.pan + 1) * Math.PI) / 4, gl = Math.cos(ang) * r.gain * vg, gr = Math.sin(ang) * r.gain * vg
      const s0 = Math.round(n.start * sr)
      const tail = Math.max(0.05, r.release) * 7 // the release is gone after about seven time constants
      const total = Math.ceil((held + tail) * sr)
      let pos = r.start - base, lvl = 0
      const releaseK = Math.exp(-11.513 / (Math.max(0.01, r.release) * sr)) // the envelope times of a SoundFont are for a fall of 100 dB
      const decayK = Math.exp(-11.513 / (Math.max(0.01, r.decay) * sr))
      const t1 = r.delay, t2 = t1 + r.attack, t3 = t2 + r.hold
      let phase = 0 // 0 delay, 1 attack, 2 hold, 3 decay/sustain, 4 release
      const lp = lowpass(r, vel, sr)
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0
      for (let j = 0; j < total; j++) {
        const idx = s0 + j
        if (idx >= length) break
        const t = j / sr
        if (t >= held && phase < 4) phase = 4
        if (phase === 0 && t >= t1) phase = 1
        if (phase === 1 && t >= t2) { phase = 2; lvl = 1 }
        if (phase === 2 && t >= t3) phase = 3
        if (phase === 1) lvl = r.attack > 0 ? Math.min(1, (t - t1) / r.attack) : 1
        else if (phase === 3) lvl = Math.max(r.sustain, lvl * decayK)
        else if (phase === 4) { lvl *= releaseK; if (lvl < 1e-5) break }
        if (phase === 0) continue // (the delay: nothing sounds yet, and the sample has not started)
        if (looping && (r.loop === 1 || phase < 4) && pos >= le) pos = ls + ((pos - ls) % (le - ls))
        const i0 = pos | 0
        if (i0 >= last) break
        const frac = pos - i0, raw = data[i0] + (data[i0 + 1] - data[i0]) * frac
        let x = raw
        if (lp) { x = lp.b0 * raw + lp.b1 * x1 + lp.b2 * x2 - lp.a1 * y1 - lp.a2 * y2; x2 = x1; x1 = raw; y2 = y1; y1 = x }
        L[idx] += x * lvl * gl; R[idx] += x * lvl * gr
        pos += rate
      }
    }
    if (performance.now() - worked > 40) { await new Promise<void>((res) => setTimeout(res, 0)); worked = performance.now() }
  }
  return [L, R]
}
