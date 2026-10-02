import type { Note } from '../models'
import type { Measure, Score } from './omr'

/**
 * Order in which measures are played.
 *  - `|: … :|` runs twice; endings (voltas) pick the bars for pass 1, pass 2…
 *  - D.C. / D.S. jump to the start / the segno once; after the jump repeats are not taken again,
 *    the last ending is played, "al Fine" stops at Fine and "al Coda" leaps from "to Coda" to the Coda.
 *  With `repeats` off the piece is played straight through (last endings only, no jumps).
 */
export function playOrder(ms: Measure[], repeats = true): number[] {
  const order: number[] = []
  const lastEnding = Math.max(0, ...ms.flatMap((m) => m.volta ?? []))
  const segno = ms.findIndex((m) => m.segno), coda = ms.findIndex((m) => m.coda)
  const done = new Set<number>()
  let i = 0, start = 0, pass = 1, active = repeats, jumped = false, al: 'end' | 'fine' | 'coda' = 'end'
  for (let guard = 0; i < ms.length && guard < 20 * ms.length + 20; guard++) {
    const m = ms[i]
    if (active && m.startRepeat && start !== i) { start = i; pass = 1 }
    const want = active ? pass : lastEnding
    if (m.volta?.length && !m.volta.includes(want)) { i++; continue } // not this ending's turn
    order.push(i)
    if (jumped && al === 'fine' && m.fine) break
    if (jumped && al === 'coda' && m.toCoda && coda >= 0) { i = coda; continue }
    if (active && m.endRepeat && !done.has(i)) { done.add(i); pass++; i = start; continue }
    if (active && m.jump && !jumped) {
      const target = m.jump.kind === 'dc' ? 0 : segno
      if (target >= 0) { jumped = true; active = false; al = m.jump.al; i = target; continue }
    }
    i++
  }
  return order
}

export interface Timed { pitch: number; start: number; duration: number; staff: number; velocity?: number } // quarter notes from the start

/** Score -> notes in quarter-note time: repeats expanded, tied notes merged. */
export function unroll(score: Score, repeats = true): Timed[] {
  const out: (Timed & { tieNext?: boolean })[] = []
  let at = 0
  for (const mi of playOrder(score.measures, repeats)) {
    const m = score.measures[mi]
    for (const n of m.notes) out.push({ pitch: n.pitch, staff: n.staff, start: at + n.start, duration: n.duration, tieNext: n.tieNext, velocity: n.velocity })
    at += m.length
  }
  out.sort((a, b) => a.start - b.start)
  const gone = new Set<number>()
  for (let i = 0; i < out.length; i++) {
    let n = out[i]
    while (n.tieNext) {
      const end = n.start + n.duration
      const j = out.findIndex((o, k) => !gone.has(k) && k > i && o.pitch === n.pitch && o.staff === n.staff && Math.abs(o.start - end) < 1e-6)
      if (j < 0) break
      n.duration += out[j].duration
      n.tieNext = out[j].tieNext
      gone.add(j)
    }
  }
  return out.filter((_, k) => !gone.has(k)).map(({ pitch, start, duration, staff, velocity }) => ({ pitch, start, duration, staff, velocity }))
}

/** Where the tempo changes, in the order the bars are played: `ratio` is the speed relative to the first bar. Empty when it never changes. */
export function tempoRatios(score: Score, repeats = true): { at: number; ratio: number }[] {
  const base = score.measures[0]?.tempo
  if (!base) return []
  const out: { at: number; ratio: number }[] = []
  let at = 0, last = 1
  for (const mi of playOrder(score.measures, repeats)) {
    const m = score.measures[mi]
    const ratio = (m.tempo ?? base) / base
    if (Math.abs(ratio - last) > 1e-9) { out.push({ at, ratio }); last = ratio }
    at += m.length
  }
  return out
}

/** `bpm` = quarter notes per minute (at the start; `changes` speed it up or down from there). */
export function toNotes(timed: Timed[], bpm: number, velocity = 85, changes: { at: number; ratio: number }[] = []): Note[] {
  const k = 60 / bpm
  const secs = (q: number) => { // quarter notes -> seconds, walking through the tempo changes
    let t = 0, from = 0, ratio = 1
    for (const c of changes) { if (c.at >= q) break; t += (c.at - from) * k / ratio; from = c.at; ratio = c.ratio }
    return t + (q - from) * k / ratio
  }
  return timed.map((n) => ({ pitch: n.pitch, start: secs(n.start), duration: secs(n.start + n.duration) - secs(n.start), velocity: n.velocity ?? velocity, hand: (n.staff >= 1 ? 1 : 0) as 0 | 1 })) // upper staff = right hand
}
