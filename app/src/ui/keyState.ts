import { end, handOf, type Note } from '../core/models'

export const ATTACK = 0.04, RELEASE = 0.2 // seconds: key goes down fast, comes back slowly

/** Notes (sorted by start) -> which keys are pressed at time t. */
export class KeyState {
  notes: Note[]
  private maxDur: number

  constructor(notes: Note[]) {
    this.notes = [...notes].sort((a, b) => a.start - b.start)
    this.maxDur = this.notes.reduce((m, n) => Math.max(m, n.duration), 0)
  }

  /** Index of the first note with start > t (binary search). */
  private upper(t: number): number {
    let lo = 0, hi = this.notes.length
    while (lo < hi) { const m = (lo + hi) >> 1; this.notes[m].start <= t ? (lo = m + 1) : (hi = m) }
    return lo
  }

  /** Notes whose start falls in (a, b]: the ones that just hit the keys. */
  startedBetween(a: number, b: number): Note[] {
    return this.notes.slice(this.upper(a), this.upper(b))
  }

  /** Notes that are falling, being held, or have just ended (for drawing). */
  visible(t: number, lookahead: number): Note[] {
    const out: Note[] = []
    const floor = t - this.maxDur - RELEASE
    for (let i = this.upper(t + lookahead) - 1; i >= 0 && this.notes[i].start >= floor; i--) {
      if (end(this.notes[i]) + RELEASE > t) out.push(this.notes[i])
    }
    return out
  }

  /** pitch -> [press 0..1, velocity, hand] for keys with press > 0. */
  at(t: number): Map<number, [number, number, 0 | 1]> {
    const keys = new Map<number, [number, number, 0 | 1]>()
    for (const n of this.visible(t, 0)) {
      if (t < n.start) continue
      const lin = t < end(n) ? Math.min(1, (t - n.start) / ATTACK) : Math.max(0, 1 - (t - end(n)) / RELEASE)
      const p = lin * lin * (3 - 2 * lin) // smoothstep: no snap at either end
      if (p > (keys.get(n.pitch)?.[0] ?? 0)) keys.set(n.pitch, [p, n.velocity, handOf(n)])
    }
    return keys
  }
}
