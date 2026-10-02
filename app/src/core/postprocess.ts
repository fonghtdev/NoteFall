import { end, type Note } from './models'

/**
 * Drop weak/short notes, clamp to piano range, merge duplicate onsets, cap polyphony.
 * Same-pitch notes are merged only when they START together: a re-struck key is a new note, not a longer one.
 */
export function clean(notes: Note[], o: { minDur?: number; minVel?: number; mergeGap?: number; maxPoly?: number } = {}): Note[] {
  const { minDur = 0.05, minVel = 20, mergeGap = 0.03, maxPoly = 10 } = o
  const sorted = notes
    .filter((n) => n.pitch >= 21 && n.pitch <= 108 && n.velocity >= minVel)
    .sort((a, b) => a.start - b.start)

  const merged: Note[] = []
  const last = new Map<number, number>() // pitch -> index in merged
  for (const n of sorted) {
    const i = last.get(n.pitch)
    const prev = i === undefined ? undefined : merged[i]
    if (prev && n.start - prev.start <= mergeGap) {
      merged[i!] = {
        pitch: n.pitch, start: prev.start,
        duration: Math.max(end(prev), end(n)) - prev.start,
        velocity: Math.max(prev.velocity, n.velocity),
      }
    } else {
      last.set(n.pitch, merged.push(n) - 1)
    }
  }

  const out: Note[] = []
  let active: Note[] = []
  for (const n of merged.filter((n) => n.duration >= minDur)) { // ponytail: O(n*poly) sweep, fine for song-sized inputs
    active = active.filter((a) => end(a) > n.start)
    if (active.length >= maxPoly) {
      const weakest = active.reduce((a, b) => (b.velocity < a.velocity ? b : a))
      if (weakest.velocity >= n.velocity) continue
      active.splice(active.indexOf(weakest), 1)
      out.splice(out.indexOf(weakest), 1)
    }
    active.push(n)
    out.push(n)
  }
  return out
}
