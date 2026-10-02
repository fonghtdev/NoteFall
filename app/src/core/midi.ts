import { Midi } from '@tonejs/midi'
import type { Note } from './models'

/** Exact notes from a .mid file (tempo map handled by @tonejs/midi). */
export function parseMidi(data: ArrayBuffer): Note[] {
  const tracks = new Midi(data).tracks.filter((t) => t.notes.length)
  const mean = (t: (typeof tracks)[number]) => t.notes.reduce((a, n) => a + n.midi, 0) / t.notes.length
  // two tracks are almost always the two hands: the higher one is the right hand. Anything else: unknown (split by pitch later)
  const right = tracks.length === 2 ? (mean(tracks[0]) >= mean(tracks[1]) ? tracks[0] : tracks[1]) : undefined
  return tracks
    .flatMap((t) => t.notes.map((n) => ({ pitch: n.midi, start: n.time, duration: n.duration, velocity: Math.max(1, Math.round(n.velocity * 127)), ...(right ? { hand: (t === right ? 0 : 1) as 0 | 1 } : {}) })))
    .sort((a, b) => a.start - b.start)
}
