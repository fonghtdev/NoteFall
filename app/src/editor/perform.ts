import type { Measure as PerfMeasure, Score as PerfScore } from '../core/score/omr'
import { clickStep } from '../core/beats'
import { realizeVoice, type WEvent } from '../core/score/realize'
import { TPQ, barTicks, contextAt, starts, type Dyn, type Score } from './model'

export const DYN_VELOCITY: Record<Dyn, number> = { pppp: 20, ppp: 28, pp: 36, p: 49, mp: 64, mf: 80, f: 96, ff: 112, fff: 124, ffff: 127, sf: 108, sfz: 110, fp: 90, sfp: 102, rfz: 108 }
const DEFAULT_VEL = 80 // mf, as in MuseScore, until the first marking
const HAIRPIN_STEP = 22 // how far a wedge goes when no dynamic follows it

/**
 * Loudness over time for one staff: each dynamic sets a level that lasts until the next one; a hairpin glides
 * from the level where it starts to the next dynamic (or +/- a step if there is none).
 */
function velocityTimeline(s: Score, staff: number): (tick: number) => number {
  const abs: number[] = []
  let t = 0
  s.measures.forEach((_, i) => { abs.push(t); t += barTicks(contextAt(s, i).time) })
  const at = new Map<number, { abs: number; dyn?: Dyn; end?: number; type?: 'cresc' | 'dim' }>()
  const where = new Map<number, number>() // event id -> absolute tick
  s.measures.forEach((m, i) => m.staves[staff]?.forEach((events) => {
    const st = starts(events)
    events.forEach((e, k) => where.set(e.id, abs[i] + st[k]))
  }))
  s.measures.forEach((m, i) => m.staves[staff]?.forEach((events) => {
    const st = starts(events)
    events.forEach((e, k) => { if (e.dyn || e.hairpin) at.set(e.id, { abs: abs[i] + st[k], dyn: e.dyn, end: e.hairpin ? where.get(e.hairpin.end) : undefined, type: e.hairpin?.type }) })
  }))
  const marks = [...at.values()].sort((a, b) => a.abs - b.abs)
  const levels: { abs: number; v: number }[] = [] // step changes
  const ramps: { from: number; to: number; v0: number; v1: number }[] = []
  let level = DEFAULT_VEL
  for (const mk of marks) {
    if (mk.dyn) { level = DYN_VELOCITY[mk.dyn]; levels.push({ abs: mk.abs, v: level }) }
    if (mk.end !== undefined && mk.type) {
      const next = marks.find((o) => o.dyn && o.abs >= mk.end! && o.abs <= mk.end! + 1)
      const target = next ? DYN_VELOCITY[next.dyn!] : Math.max(1, Math.min(127, level + (mk.type === 'cresc' ? HAIRPIN_STEP : -HAIRPIN_STEP)))
      ramps.push({ from: mk.abs, to: mk.end, v0: level, v1: target })
    }
  }
  return (tick: number) => {
    const r = ramps.find((x) => tick >= x.from && tick < x.to)
    if (r) return Math.round(r.v0 + ((r.v1 - r.v0) * (tick - r.from)) / (r.to - r.from))
    const done = ramps.filter((x) => x.to <= tick).sort((a, b) => b.to - a.to)[0]
    const lv = levels.filter((x) => x.abs <= tick).sort((a, b) => b.abs - a.abs)[0]
    if (done && (!lv || done.to > lv.abs)) return done.v1
    return lv ? lv.v : DEFAULT_VEL
  }
}

/** Where the sustain pedal is down, in absolute ticks: from its first note to the end of its last (pedal marks of any staff hold every staff, as on a piano). */
function pedalRanges(s: Score): [number, number][] {
  const span = new Map<number, [number, number]>() // event id -> its absolute start and end
  let t = 0
  s.measures.forEach((m, i) => {
    m.staves.forEach((voices) => voices.forEach((events) => { const st = starts(events); events.forEach((e, k) => span.set(e.id, [t + st[k], t + st[k] + e.ticks])) }))
    t += barTicks(contextAt(s, i).time)
  })
  const out: [number, number][] = []
  for (const m of s.measures) for (const voices of m.staves) for (const events of voices) for (const e of events) {
    const a = e.pedal && span.get(e.id), b = e.pedal && span.get(e.pedal.end)
    if (a && b) out.push([a[0], b[1]])
  }
  return out
}

/** Editor score -> the playback representation the falling-notes view already understands (repeats, ties, tempo, dynamics). */
export function toPerformance(s: Score): PerfScore {
  const timelines = s.clefs.map((_, staff) => velocityTimeline(s, staff))
  const pedals = pedalRanges(s)
  let barStart = 0
  const measures: PerfMeasure[] = s.measures.map((m, i) => {
    const { time, key, tempo } = contextAt(s, i)
    const notes: PerfMeasure['notes'] = []
    m.staves.forEach((voices, staff) => voices.forEach((events, vi) => {
      const st = starts(events)
      const nextOf = (k: number) => events[k + 1] ?? s.measures[i + 1]?.staves[staff]?.[vi]?.[0] // a slide may run into the next bar
      const written: WEvent[] = events.map((e, k) => {
        const nx = e.gliss ? nextOf(k) : undefined
        return { ticks: e.ticks, pitches: e.pitches, tie: e.tie, orn: e.orn, graces: e.graces, art: e.art, arp: e.arp, trem: e.trem, gliss: nx?.pitches.length ? nx.pitches[0] : undefined, vel: timelines[staff](barStart + st[k]) }
      })
      notes.push(...realizeVoice(written, key, staff))
    }))
    for (const n of notes) { // under the pedal a note sounds on until the pedal goes up
      const at = barStart + n.start * TPQ, up = pedals.find(([a, b]) => at >= a && at < b)?.[1]
      if (up !== undefined && up > at + n.duration * TPQ) n.hold = (up - at) / TPQ
    }
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
    barStart += barTicks(time)
    return { index: i + 1, length: barTicks(time) / TPQ, beat: clickStep(time.beats, time.unit), tempo, tempoChanges: m.tempo && m.tempoAt ? [{ at: m.tempoAt / TPQ, bpm: m.tempo }] : undefined, notes, startRepeat: !!m.startRepeat, endRepeat: !!m.endRepeat, volta: m.volta, segno: m.segno, coda: m.coda, toCoda: m.toCoda, fine: m.fine, jump: m.jump }
  })
  return { measures, beatsPerBar: s.time.beats, beatUnit: s.time.unit, warnings: [] }
}
