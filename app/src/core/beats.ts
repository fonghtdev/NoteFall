import { end, type Note } from './models'

export interface BeatGrid {
  bpm: number
  offset: number // time of a beat, seconds, 0 <= offset < one beat
  barStart: number // which beat (0..beatsPerBar-1) is the first of a bar
  beatsPerBar?: number // default 4; sheet music imports know it exactly
}

const period = (g: BeatGrid) => 60 / g.bpm
const wrap = (x: number, p: number) => ((x % p) + p) % p

/** How well a grid explains the onsets: Gaussian hit score minus what random onsets would score. */
function score(on: Float64Array, w: Float64Array, bpm: number, offset: number, sigma: number): number {
  const p = 60 / bpm, chance = (sigma * Math.sqrt(Math.PI)) / p
  let s = 0
  for (let i = 0; i < on.length; i++) {
    const d = wrap(on[i] - offset + p / 2, p) - p / 2 // signed distance to nearest beat
    s += w[i] * (Math.exp(-((d / sigma) ** 2)) - chance)
  }
  return s
}

/**
 * Tempo + beat phase from note onsets (works for MIDI and transcribed audio alike).
 * ponytail: constant tempo only, rubato/tempo changes drift; octave errors fixed by the x2/÷2 buttons.
 */
export function estimateGrid(notes: Note[]): BeatGrid | undefined {
  // chords/ornaments within 30 ms count once, at the strongest velocity
  const sorted = [...notes].sort((a, b) => a.start - b.start)
  const on: number[] = [], w: number[] = []
  for (const n of sorted) {
    if (on.length && n.start - on[on.length - 1] < 0.03) w[w.length - 1] = Math.max(w[w.length - 1], n.velocity)
    else { on.push(n.start); w.push(n.velocity) }
  }
  if (on.length < 4) return undefined
  const O = Float64Array.from(on), W = Float64Array.from(w)

  const search = (lo: number, hi: number, bpmStep: number, phaseStep: number, sigma: number, off0: number, offSpan: number, prior: boolean) => {
    let best = { bpm: lo, offset: 0, s: -Infinity }
    for (let bpm = lo; bpm <= hi; bpm += bpmStep) {
      const p = 60 / bpm
      const span = Math.min(offSpan, p)
      for (let o = 0; o < span; o += phaseStep) {
        let s = score(O, W, bpm, off0 + o, sigma)
        if (prior) s *= Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.6) ** 2) // gentle preference for walking-pace tempi
        if (s > best.s) best = { bpm, offset: off0 + o, s }
      }
    }
    return best
  }

  const c = search(60, 200, 0.5, 0.02, 0.04, 0, Infinity, true)
  const f = search(c.bpm - 0.5, c.bpm + 0.5, 0.02, 0.002, 0.02, c.offset - 0.02, 0.04, false)
  const bpm = f.bpm
  const offset = wrap(f.offset, 60 / bpm)

  // bar line: the beat (of 4) carrying the most onset weight, usually the downbeat
  const bins = [0, 0, 0, 0]
  const q = 60 / bpm
  for (let i = 0; i < O.length; i++) {
    const k = Math.round((O[i] - offset) / q)
    if (Math.abs(O[i] - offset - k * q) < 0.05) bins[wrap(k, 4)] += W[i]
  }
  return { bpm, offset, barStart: bins.indexOf(Math.max(...bins)) }
}

/** Beat times in [from, to], with `bar` true on the first beat of each 4-beat bar. */
export function beatTimes(g: BeatGrid, from: number, to: number): { t: number; bar: boolean }[] {
  const p = period(g), out = []
  for (let k = Math.ceil((from - g.offset) / p); g.offset + k * p <= to; k++) {
    out.push({ t: g.offset + k * p, bar: wrap(k - g.barStart, g.beatsPerBar ?? 4) === 0 })
  }
  return out
}

/** Tempo x2 / ÷2: same beat positions are kept, the bar phase restarts. Out-of-range results are ignored. */
export const scaleTempo = (g: BeatGrid, factor: number): BeatGrid => {
  const bpm = g.bpm * factor
  return bpm < 30 || bpm > 300 ? g : { bpm, offset: wrap(g.offset, 60 / bpm), barStart: 0 }
}

export const shiftOffset = (g: BeatGrid, dt: number): BeatGrid => ({ ...g, offset: wrap(g.offset + dt, period(g)) })

/** Snap note starts/ends to 1/`div` of a beat when they're within `tol` seconds of a grid line. */
export function quantize(notes: Note[], g: BeatGrid, div = 4, tol = 0.05): Note[] {
  const step = period(g) / div
  const snap = (t: number) => {
    const s = g.offset + Math.round((t - g.offset) / step) * step
    return Math.abs(s - t) <= tol ? s : t
  }
  return notes.map((n) => {
    const s = snap(n.start)
    const e = Math.max(snap(end(n)), s + 0.05)
    return { ...n, start: s, duration: e - s }
  })
}

/** How many quarter notes one metronome click lasts in a time signature: 6/8 and 9/8 click on the dotted quarter, 3/8 and 5/8 on each eighth… */
export const clickStep = (beats: number, unit: number): number => (unit === 8 ? (beats % 3 === 0 && beats > 3 ? 1.5 : 0.5) : 4 / unit)

/** A beat grid for sheet music: its beats are the metronome clicks, so 6/8 has two per bar and 3/8 three. `bpm` is quarter notes per minute. */
export const gridForSignature = (bpm: number, beats: number, unit: number, offset = 0): BeatGrid => {
  const step = clickStep(beats, unit)
  return { bpm: bpm / step, offset, barStart: 0, beatsPerBar: Math.max(1, Math.round((beats * 4) / unit / step)) }
}
