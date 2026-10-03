import { end, type Note } from './models'
import { mixSampled } from './sf2'
import { loadSoundFont } from './soundfonts'

/**
 * Notes -> piano audio, rendered offline so it plays, seeks and exports like any decoded file.
 *
 * 'crystal' models a concert grand with a clear, bright, singing tone (the clarity of an acrylic-cased grand such as the Heintzman Crystal):
 *  - every string is a set of inharmonic partials (stiff strings: partial k at k·f·√(1+B·k²)), so octaves and chords have the slightly
 *    stretched shimmer of a real piano;
 *  - the hammer strikes 1/8 of the way along the string, which thins out the 8th partial, and hits softer notes with a duller felt
 *    (steeper spectral slope) than loud ones: loud notes are brighter, not only louder;
 *  - each partial decays on its own: highs fade fast, lows ring; a quick first decay and a long, quiet after-ring;
 *  - mid and treble notes have two or three strings, a hair out of tune, which beat slowly and make the note "alive";
 *  - a short felt thump at the strike, a gentle soundboard colour (warm lows, presence), notes spread left → right by pitch,
 *    and a light hall.
 * 'simple' is the old plain additive tone, kept for comparison.
 */
export type PianoVoice = 'crystal' | 'simple' | `sf2:${string}` // 'sf2:<id>' plays an installed SoundFont (see soundfonts.ts)
export const VOICES: Record<'crystal' | 'simple', string> = { crystal: 'Piano cơ (Crystal)', simple: 'Đơn giản' }
let current: PianoVoice = 'crystal'
export const setPianoVoice = (v: PianoVoice) => { current = v }
export const getPianoVoice = () => current

/** The numbers that give the instrument its character: change these to tune the tone. */
export const PIANO = {
  strike: 1 / 8,          // where the hammer hits, as a fraction of the string
  slopeSoft: 1.9, slopeLoud: 0.85, // spectral slope k^-slope for the softest / loudest hit
  decay1: 4.6,            // seconds for the first decay of the fundamental of C4 (e-fold)
  decayPerOctave: 0.95,   // lower notes ring longer: each octave down multiplies the decay by 2^this
  highDecay: 0.5,         // partial k decays 1 + highDecay·(k-1) times faster than the fundamental
  afterRing: { weight: 0.3, slow: 5.5 }, // the quiet long tail: share of the sound and how much longer it lasts
  detuneCents: 0.9,       // spread of the unison strings
  release: 0.11,          // seconds the damper takes to quiet a released note
  thump: 0.05,            // strength of the hammer thump
  reverbWet: 0.13, reverbSeconds: 1.7,
}

/** Inharmonicity coefficient B of a string: thicker, shorter strings in the treble are stiffer. */
export const inharmonicity = (pitch: number) => 4e-5 * 2 ** (((pitch - 21) / 12) * 0.62)
/** How many partials are worth rendering: the high ones of a treble note are above hearing anyway. */
export const partialCount = (pitch: number) => (pitch < 48 ? 14 : pitch < 72 ? 10 : pitch < 96 ? 6 : 3)
/** Partial frequencies of one string. */
export const partials = (f0: number, pitch: number, n = partialCount(pitch)) => Array.from({ length: n }, (_, i) => { const k = i + 1; return k * f0 * Math.sqrt(1 + inharmonicity(pitch) * k * k) })
/** Relative amplitudes of those partials for a hit of velocity 0..1. */
export const partialAmps = (n: number, vel: number) => {
  const slope = PIANO.slopeSoft + (PIANO.slopeLoud - PIANO.slopeSoft) * Math.min(1, Math.max(0, vel))
  return Array.from({ length: n }, (_, i) => { const k = i + 1; return Math.abs(Math.sin(k * Math.PI * PIANO.strike)) / k ** slope })
}
/** Decay time constant of partial k of a note (seconds). */
export const decayOf = (pitch: number, k: number) => Math.min(20, PIANO.decay1 * 2 ** (-((pitch - 60) / 12) * PIANO.decayPerOctave)) / (1 + PIANO.highDecay * (k - 1))

const reverbIR = (ctx: BaseAudioContext) => {
  const sr = ctx.sampleRate, len = Math.round(PIANO.reverbSeconds * sr), ir = ctx.createBuffer(2, len, sr)
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch)
    let lp = 0, seed = 12345 + ch * 777
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1 }
    for (let i = 0; i < len; i++) {
      const t = i / sr, a = Math.exp((-6.91 * t) / PIANO.reverbSeconds)         // -60 dB at the reverb time
      lp += (rnd() - lp) * (0.55 * Math.exp(-t * 1.6) + 0.12)                    // the room darkens as it rings
      d[i] = lp * a * (t < 0.012 ? 0 : 1) * 0.9
    }
  }
  return ir
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** Add a decaying sinusoid a·e^(-t/tau)·sin(2πft + phase) to `buf`, with two multiplications per sample (a damped resonator). */
function addResonator(buf: Float32Array, f: number, a: number, tau: number, sr: number, phase = 0) {
  const w = (2 * Math.PI * f) / sr, r = Math.exp(-1 / (tau * sr)), c = 2 * r * Math.cos(w), r2 = r * r
  const stop = Math.min(buf.length, Math.floor(tau * sr * Math.log(Math.max(1.0001, a / 1e-5)))) // beyond this it is below -100 dB
  let y2 = a * Math.sin(phase), y1 = a * r * Math.sin(w + phase)
  if (stop > 0) buf[0] += y2
  if (stop > 1) buf[1] += y1
  for (let i = 2; i < stop; i++) { const y = c * y1 - r2 * y2; buf[i] += y; y2 = y1; y1 = y }
}

/** One struck note, mono, from the strike until it has died away (at most 9 s). `variant` makes a second, slightly different take. */
export function synthNote(pitch: number, velocity: number, sr: number, variant = 0): Float32Array {
  const f0 = 440 * 2 ** ((pitch - 69) / 12), vel = clamp(velocity / 127, 0.02, 1)
  const n = partialCount(pitch), fs = partials(f0, pitch, n), amps = partialAmps(n, vel)
  const strings = pitch < 30 ? 1 : pitch < 52 ? 2 : 3
  const tailTau = decayOf(pitch, 1) * PIANO.afterRing.slow
  const len = Math.ceil(Math.min(9, tailTau * 7.6 + 0.3) * sr)
  const buf = new Float32Array(len)
  const w = PIANO.afterRing.weight, level = 0.5 * vel ** 1.25
  for (let k = 0; k < n; k++) {
    if (fs[k] > 0.45 * sr) break
    const a = level * amps[k]
    if (a < 0.0003) continue
    const tau = decayOf(pitch, k + 1)
    if (k < 6 && strings > 1) { // the unison strings, a hair apart: they beat slowly against each other
      for (let s = 0; s < strings; s++) {
        const cents = (s / (strings - 1) - 0.5) * 2 * PIANO.detuneCents + (variant ? 0.17 * (s - 1) : 0)
        addResonator(buf, fs[k] * 2 ** (cents / 1200), (a * (1 - w)) / strings, tau, sr, variant ? 0.35 * (k % 3) : 0)
      }
    } else addResonator(buf, fs[k], a * (1 - w), tau, sr, variant ? 0.35 * (k % 3) : 0)
    if (k < 6) addResonator(buf, fs[k], a * w, tau * PIANO.afterRing.slow, sr) // the long, quiet after-ring
  }
  // the felt hitting the string: a very short, dark knock
  if (PIANO.thump > 0 && vel > 0.08) {
    let seed = 1234 + pitch * 31 + variant * 7, lp = 0
    const cut = clamp((300 + f0 * 2) / sr, 0.01, 0.25), amp = PIANO.thump * vel * vel * 1.4, ln = Math.min(len, Math.round(0.03 * sr))
    for (let i = 0; i < ln; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; lp += ((seed / 2147483648 - 1) - lp) * cut * 4; buf[i] += amp * lp * Math.exp((-i / sr) / 0.007) }
  }
  const att = Math.round(0.003 * sr) // soften the very first samples (the hammer's attack)
  for (let i = 0; i < att && i < len; i++) buf[i] *= i / att
  const fade = Math.min(len, Math.round(0.4 * sr)) // and the end of a long sample, so cutting it never clicks
  for (let i = 0; i < fade; i++) buf[len - 1 - i] *= i / fade
  return buf
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** Mix notes into stereo with no effects yet (this part is plain JavaScript on typed arrays, fast enough for a whole piece). */
export async function mixNotes(notes: Note[], sr: number, length: number): Promise<[Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]> {
  const L = new Float32Array(length), R = new Float32Array(length)
  const bank = new Map<string, Float32Array>()
  const uses = new Map<string, number>()
  const keyOf = (n: Note) => `${n.pitch}:${Math.round(clamp(n.velocity, 8, 127) / 8)}`
  for (const n of notes) uses.set(keyOf(n), (uses.get(keyOf(n)) ?? 0) + 1)
  let seed = 4242
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  let worked = performance.now()
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i], key = keyOf(n)
    const variant = (uses.get(key) ?? 0) >= 6 ? i % 2 : 0 // a repeated note is not played back identically every time
    const bankKey = key + ':' + variant
    let smp = bank.get(bankKey)
    if (!smp) { smp = synthNote(n.pitch, Math.round(clamp(n.velocity, 8, 127) / 8) * 8, sr, variant); bank.set(bankKey, smp) }
    const t = n.start + (rnd() - 0.5) * 0.0006, off = Math.max(n.start + 0.06, end(n))
    const s0 = Math.round(t * sr), held = Math.round((off - n.start) * sr)
    const relTau = (PIANO.release * (n.pitch < 48 ? 1.5 : n.pitch > 84 ? 0.6 : 1)) / 2.3
    const gain = 10 ** (((rnd() - 0.5) * 2) / 20) // ±1 dB, like a pianist's evenness
    const pan = clamp(((n.pitch - 64) / 44) * 0.55, -0.6, 0.6), ang = ((pan + 1) * Math.PI) / 4
    const gl = Math.cos(ang) * gain, gr = Math.sin(ang) * gain
    const used = Math.min(smp.length, held + Math.ceil(relTau * sr * 7))
    const decay = Math.exp(-1 / (relTau * sr))
    let g = 1
    for (let j = 0; j < used; j++) {
      const idx = s0 + j
      if (idx >= length) break
      if (j >= held) g *= decay
      const v = smp[j] * g
      L[idx] += v * gl; R[idx] += v * gr
    }
    if (performance.now() - worked > 40) { await tick(); worked = performance.now() } // keep the page responsive while a long piece is made
  }
  return [L, R]
}

/** The soundboard's colour (unless the samples already have their own) and a light hall, done by the browser's own (fast) filters; then loud chords are kept from clipping. */
async function finish(L: Float32Array<ArrayBuffer>, R: Float32Array<ArrayBuffer>, sampleRate: number, length: number, soundboard: boolean): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, length, sampleRate)
  const src = new AudioBuffer({ length, numberOfChannels: 2, sampleRate })
  src.copyToChannel(L, 0); src.copyToChannel(R, 1)
  const input = new AudioBufferSourceNode(ctx, { buffer: src })
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 15000, Q: 0.5 })
  if (soundboard) {
    const low = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 140, gain: 2 })
    const body = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 2800, Q: 0.8, gain: 1.6 })
    const air = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 7500, gain: 1.2 })
    input.connect(low); low.connect(body); body.connect(air); air.connect(lp)
  } else input.connect(lp)
  const dry = new GainNode(ctx, { gain: 1 }), wet = new GainNode(ctx, { gain: PIANO.reverbWet })
  const verb = new ConvolverNode(ctx, { buffer: reverbIR(ctx) })
  lp.connect(dry); lp.connect(verb); verb.connect(wet)
  dry.connect(ctx.destination); wet.connect(ctx.destination)
  input.start()
  const buf = await ctx.startRendering()
  let peak = 0
  for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])) }
  if (peak > 0) for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] *= 0.85 / peak }
  return buf
}

export async function renderNotes(notes: Note[], sampleRate = 44100, voice: PianoVoice = current): Promise<AudioBuffer> {
  const length = Math.ceil((notes.reduce((m, n) => Math.max(m, end(n)), 0) + 3) * sampleRate)
  if (voice === 'simple') return renderSimple(notes, sampleRate, length)
  if (voice.startsWith('sf2:')) {
    const lib = await loadSoundFont(voice.slice(4))
    if (lib) { const [L, R] = await mixSampled(lib.font, lib.preset, notes, sampleRate, length); return finish(L, R, sampleRate, length, false) }
    console.warn('SoundFont not available any more: playing the built-in piano') // its file was removed or the browser cleared its storage
  }
  const [L, R] = await mixNotes(notes, sampleRate, length)
  return finish(L, R, sampleRate, length, true)
}

/** The old plain tone (one additive oscillator per note). */
async function renderSimple(notes: Note[], sampleRate: number, length: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, length, sampleRate)
  const amps = [0, 1, 0.55, 0.32, 0.2, 0.12, 0.07, 0.04, 0.02]
  const wave = ctx.createPeriodicWave(new Float32Array(amps.length), Float32Array.from(amps))
  for (const n of notes) {
    const osc = ctx.createOscillator()
    osc.setPeriodicWave(wave)
    osc.frequency.value = 440 * 2 ** ((n.pitch - 69) / 12)
    const g = ctx.createGain()
    const peak = 0.22 * (n.velocity / 127) ** 1.4
    const tau = Math.max(0.35, 2.6 - n.pitch * 0.022)
    const t = n.start, off = Math.max(n.start + 0.05, end(n))
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + 0.004)
    g.gain.setTargetAtTime(0, t + 0.004, tau)
    g.gain.setTargetAtTime(0, off, 0.09)
    osc.connect(g).connect(ctx.destination)
    osc.start(t)
    osc.stop(off + 1)
  }
  const buf = await ctx.startRendering()
  const data = buf.getChannelData(0)
  let peak = 0
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]))
  if (peak > 0) for (let i = 0; i < data.length; i++) data[i] *= 0.85 / peak
  return buf
}
