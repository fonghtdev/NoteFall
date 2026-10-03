import { handOf, type Note } from '../core/models'
import { TPQ, barTicks, emptyScore, putNote, spell, splitLength, starts, type Score } from './model'

/** Krumhansl-Kessler key profiles: how much each pitch class (from the tonic) belongs to a major / minor key. */
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
/** Key signature (sharps +, flats -) of the major key on each pitch class; the flat side is chosen where the sharp side would need more than 6. */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5]

const correlation = (a: number[], b: number[]) => {
  const ma = a.reduce((x, y) => x + y, 0) / 12, mb = b.reduce((x, y) => x + y, 0) / 12
  let num = 0, da = 0, db = 0
  for (let i = 0; i < 12; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2 }
  return da && db ? num / Math.sqrt(da * db) : 0
}

/** The key signature that best explains the notes (the 24 major / minor keys, weighted by how long each pitch sounds); a minor key gets its relative major's signature. */
export function detectKey(notes: Pick<Note, 'pitch' | 'duration'>[]): number {
  const h = new Array<number>(12).fill(0)
  for (const n of notes) h[n.pitch % 12] += Math.max(0.05, n.duration)
  if (h.every((v) => v === 0)) return 0
  let best = { r: -Infinity, fifths: 0 }
  for (let tonic = 0; tonic < 12; tonic++) {
    const rot = (p: number[]) => h.map((_, i) => p[(i - tonic + 12) % 12]) // the profile laid on this tonic
    const maj = correlation(h, rot(MAJOR)), min = correlation(h, rot(MINOR))
    if (maj > best.r) best = { r: maj, fifths: MAJOR_FIFTHS[tonic] }
    if (min > best.r) best = { r: min, fifths: MAJOR_FIFTHS[(tonic + 3) % 12] }
  }
  return best.fifths
}

/**
 * Turn performed notes into an editable score: 16th-note grid, each hand on its own staff (the hand the file says, otherwise middle C and above),
 * chords for notes that start together, a second voice where a note starts while another still sounds, the key found from the notes unless given.
 */
export function scoreFromNotes(notes: Note[], bpm = 100, time = { beats: 4, unit: 4 }, key?: number): Score {
  const grid = 0.25 // quarter notes per 16th
  const spb = 60 / bpm
  const sig = key ?? detectKey(notes)
  const q = notes
    .map((n) => ({ pitch: n.pitch, staff: handOf(n), s: Math.round(n.start / spb / grid), e: Math.max(Math.round(n.start / spb / grid) + 1, Math.round((n.start + n.duration) / spb / grid)) }))
    .sort((a, b) => a.s - b.s || a.pitch - b.pitch)
  const unitsPerBar = (barTicks(time) / TPQ) / grid
  const lastEnd = Math.max(0, ...q.map((n) => n.e))
  const s = emptyScore(Math.max(1, Math.ceil(lastEnd / unitsPerBar)), time, sig)
  s.tempo = Math.round(bpm)
  s.title = 'Từ nốt rơi'
  for (let staff = 0; staff < 2; staff++) {
    const mine = q.filter((n) => n.staff === staff)
    const onsets = [...new Set(mine.map((n) => n.s))].sort((a, b) => a - b)
    const busy: number[] = [] // per voice: until when it is taken
    const events = onsets.map((t) => {
      const group = mine.filter((n) => n.s === t)
      let voice = busy.findIndex((until) => until <= t) // the first voice that is free; a new one when all sound
      if (voice < 0) voice = Math.min(busy.length, 3)
      const end = Math.max(...group.map((n) => n.e))
      busy[voice] = end
      return { t, group, voice, end }
    })
    events.forEach((ev, i) => {
      const next = events.slice(i + 1).find((o) => o.voice === ev.voice)
      const end = Math.min(ev.end, next ? next.t : Infinity) // what the voice plays next cuts this note short
      let from = ev.t
      while (from < end) { // never cross a barline: split into tied pieces
        const m = Math.floor(from / unitsPerBar), barEnd = (m + 1) * unitsPerBar
        const to = Math.min(end, barEnd)
        const at = (from - m * unitsPerBar) * grid * TPQ
        const len = (to - from) * grid * TPQ
        let pos = at
        const pieces = splitLength(at, len)
        pieces.forEach((piece, pi) => {
          ev.group.forEach((n, gi) => putNote(s, { m, staff, voice: ev.voice }, pos, piece, spell(n.pitch, sig), gi > 0))
          const voiceEvs = s.measures[m].staves[staff][ev.voice]
          const placed = voiceEvs.find((e, k) => starts(voiceEvs)[k] === pos)
          if (placed && !(pi === pieces.length - 1 && to === end)) placed.tie = true
          pos += piece
        })
        from = to
      }
    })
  }
  return s
}
