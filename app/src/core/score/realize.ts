import type { ScoreNote } from './omr'

// Written notation -> played notes. Shared by the PDF reader and the composer, so both sound the same.

export interface WPitch { step: string; alter: number; octave: number }
export interface WEvent {
  ticks: number              // 960 per quarter note
  pitches: WPitch[]          // empty = rest
  tie?: boolean
  orn?: 'mordent' | 'inverted'
  graces?: WPitch[]          // small notes before this one (appoggiatura)
  art?: string[]             // 'staccato' | 'accent' | 'tenuto' | 'marcato' | 'fermata'
  vel?: number               // 1..127 from the dynamics in force (default 85)
}

const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const STEPS = 'CDEFGAB'
const SHARPS = ['F', 'C', 'G', 'D', 'A', 'E', 'B'], FLATS = ['B', 'E', 'A', 'D', 'G', 'C', 'F']

export const midiOfPitch = (p: WPitch) => 12 * (p.octave + 1) + SEMI[p.step] + p.alter
const keyAlterOf = (fifths: number, step: string) => (fifths > 0 ? (SHARPS.slice(0, fifths).includes(step) ? 1 : 0) : fifths < 0 ? (FLATS.slice(0, -fifths).includes(step) ? -1 : 0) : 0)
/** How long one grace note lasts, in quarter notes (user setting; default a 32nd). */
let GRACE = 0.125
export const setGraceBeats = (beats: number) => { GRACE = Math.min(1, Math.max(0.03, beats)) }
export const getGraceBeats = () => GRACE

/**
 * Play one voice of one bar. Rules (the same everywhere):
 *  - grace notes are quick (a 32nd each) and take their time from the start of the main note, which sounds just after them;
 *  - a mordent plays main / lower neighbour / main, an inverted mordent main / upper neighbour / main, as quick 32nds;
 *  - the neighbour follows the key signature, unless that letter was altered earlier in the bar;
 *  - staccato halves the length, marcato shortens it a little, accent and marcato play louder (tenuto and slurs keep full length).
 */
export function realizeVoice(events: WEvent[], fifths: number, staff: number): ScoreNote[] {
  const out: ScoreNote[] = []
  const seen = new Map<string, number>() // "step+octave" -> alteration stated earlier in this bar
  let t = 0
  for (const e of events) {
    const dur = e.ticks / 960
    for (const p of e.pitches) seen.set(p.step + p.octave, p.alter)
    if (e.pitches.length) {
      // a grace note is quick: a 32nd each, taken from the start of the main note (never more than a quarter of it)
      const gLen = e.graces?.length ? Math.min(GRACE, dur / (4 * e.graces.length)) : 0
      const stolen = gLen * (e.graces?.length ?? 0)
      e.graces?.forEach((g, i) => out.push({ pitch: midiOfPitch(g), start: t + i * gLen, duration: gLen, staff, velocity: e.vel }))
      const start = t + stolen
      const art = e.art ?? []
      const shorten = art.includes('staccato') ? 0.5 : art.includes('marcato') ? 0.8 : 1
      const vel = Math.max(1, Math.min(127, Math.round((e.vel ?? 85) + (art.includes('marcato') ? 20 : art.includes('accent') ? 14 : 0))))
      const len = (dur - stolen) * shorten
      e.pitches.forEach((p, i) => {
        if (e.orn && i === e.pitches.length - 1) { // the ornament belongs to the top note
          const idx = STEPS.indexOf(p.step) + (e.orn === 'mordent' ? -1 : 1)
          const step = STEPS[((idx % 7) + 7) % 7], octave = p.octave + Math.floor(idx / 7)
          const nb = { step, octave, alter: seen.get(step + octave) ?? keyAlterOf(fifths, step) }
          const f = Math.min(0.125, len / 4)
          out.push(
            { pitch: midiOfPitch(p), start, duration: f, staff, velocity: vel },
            { pitch: midiOfPitch(nb), start: start + f, duration: f, staff, velocity: vel },
            { pitch: midiOfPitch(p), start: start + 2 * f, duration: len - 2 * f, staff, tieNext: e.tie || undefined, velocity: vel },
          )
        } else out.push({ pitch: midiOfPitch(p), start, duration: len, staff, tieNext: e.tie || undefined, velocity: vel })
      })
    }
    t += dur
  }
  return out
}
