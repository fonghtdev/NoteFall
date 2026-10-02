import type { ScoreNote } from './omr'

// Written notation -> played notes. Shared by the PDF reader and the composer, so both sound the same.

export interface WPitch { step: string; alter: number; octave: number }
export interface WEvent {
  ticks: number              // 960 per quarter note
  pitches: WPitch[]          // empty = rest
  tie?: boolean
  orn?: 'mordent' | 'inverted' | 'trill' | 'turn'
  graces?: WPitch[]          // small notes before this one (appoggiatura)
  art?: string[]             // 'staccato' | 'accent' | 'tenuto' | 'marcato' | 'fermata' | 'staccatissimo' …
  arp?: 'up' | 'down' | 'plain' // chord rolled one note after the other
  gliss?: WPitch             // slide to this pitch (the first pitch of the next note) during the note
  trem?: 1 | 2 | 3           // repeated notes of 1/8, 1/16, 1/32
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
  const upper = (p: WPitch, d: number) => { // neighbour a step away, spelled by the key unless altered earlier in the bar
    const idx = STEPS.indexOf(p.step) + d
    const step = STEPS[((idx % 7) + 7) % 7], octave = p.octave + Math.floor(idx / 7)
    return { step, octave, alter: seen.get(step + octave) ?? keyAlterOf(fifths, step) }
  }
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
      const shorten = art.includes('staccatissimo') ? 0.25 : art.includes('staccato') ? 0.5 : art.includes('marcato') ? 0.8 : 1
      const vel = Math.max(1, Math.min(127, Math.round((e.vel ?? 85) + (art.includes('marcato') ? 20 : art.includes('accent') ? 14 : 0))))
      const len = (dur - stolen) * shorten
      const tie = e.tie || undefined
      const top = e.pitches.length - 1
      const roll = e.arp && e.pitches.length > 1 // rolled chord: each next note enters a little later and all end together
      const order = e.arp === 'down' ? [...e.pitches.keys()].reverse() : [...e.pitches.keys()]
      const gap = roll ? Math.min(0.08, len / (2 * e.pitches.length)) : 0
      e.pitches.forEach((p, i) => {
        const off = roll ? order.indexOf(i) * gap : 0
        const s0 = start + off, l0 = len - off
        if (e.trem && !e.orn) { // repeated notes; the last one carries the tie
          const unit = 0.5 / 2 ** (e.trem - 1), n = Math.max(1, Math.round(l0 / unit))
          for (let k = 0; k < n; k++) out.push({ pitch: midiOfPitch(p), start: s0 + (k * l0) / n, duration: l0 / n, staff, tieNext: k === n - 1 ? tie : undefined, velocity: vel })
        } else if (e.gliss && i === top && Math.abs(midiOfPitch(e.gliss) - midiOfPitch(p)) > 1) { // slide: every semitone in between, filling the note
          const a = midiOfPitch(p), b = midiOfPitch(e.gliss), dir = b > a ? 1 : -1, n = Math.abs(b - a)
          for (let k = 0; k < n; k++) out.push({ pitch: a + dir * k, start: s0 + (k * l0) / n, duration: l0 / n, staff, velocity: vel })
        } else if (e.orn && i === top) { // the ornament belongs to the top note
          if (e.orn === 'mordent' || e.orn === 'inverted') {
            const nb = upper(p, e.orn === 'mordent' ? -1 : 1)
            const f = Math.min(0.125, l0 / 4)
            out.push(
              { pitch: midiOfPitch(p), start: s0, duration: f, staff, velocity: vel },
              { pitch: midiOfPitch(nb), start: s0 + f, duration: f, staff, velocity: vel },
              { pitch: midiOfPitch(p), start: s0 + 2 * f, duration: l0 - 2 * f, staff, tieNext: tie, velocity: vel },
            )
          } else if (e.orn === 'turn') { // upper, main, lower, main
            const f = Math.min(0.125, l0 / 5)
            out.push(
              { pitch: midiOfPitch(upper(p, 1)), start: s0, duration: f, staff, velocity: vel },
              { pitch: midiOfPitch(p), start: s0 + f, duration: f, staff, velocity: vel },
              { pitch: midiOfPitch(upper(p, -1)), start: s0 + 2 * f, duration: f, staff, velocity: vel },
              { pitch: midiOfPitch(p), start: s0 + 3 * f, duration: l0 - 3 * f, staff, tieNext: tie, velocity: vel },
            )
          } else { // trill: main and upper neighbour in 32nds, ending on the main note
            const f = 0.125, n = Math.max(3, 2 * Math.floor(l0 / f / 2) - 1), step = l0 / n // an odd count, so main, upper, … ends on the main note
            const nb = upper(p, 1)
            for (let k = 0; k < n; k++) out.push({ pitch: midiOfPitch(k % 2 ? nb : p), start: s0 + k * step, duration: step, staff, tieNext: k === n - 1 ? tie : undefined, velocity: vel })
          }
        } else out.push({ pitch: midiOfPitch(p), start: s0, duration: l0, staff, tieNext: tie, velocity: vel })
      })
    }
    t += dur
  }
  return out
}
