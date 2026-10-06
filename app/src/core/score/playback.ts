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
    for (const c of m.tempoChanges ?? []) { const r = c.bpm / base; if (Math.abs(r - last) > 1e-9) { out.push({ at: at + c.at, ratio: r }); last = r } } // a change in the middle of the bar
    at += m.length
  }
  return out
}

/** Quarter notes -> seconds, walking through the tempo changes. */
export function secondsAt(q: number, bpm: number, changes: { at: number; ratio: number }[] = []): number {
  const k = 60 / bpm
  let t = 0, from = 0, ratio = 1
  for (const c of changes) { if (c.at >= q) break; t += ((c.at - from) * k) / ratio; from = c.at; ratio = c.ratio }
  return t + ((q - from) * k) / ratio
}

/** Seconds -> quarter notes: the other way round of `secondsAt`. */
export function quartersAt(t: number, bpm: number, changes: { at: number; ratio: number }[] = []): number {
  const k = 60 / bpm
  let from = 0, ratio = 1, rest = t
  for (const c of changes) { const span = ((c.at - from) * k) / ratio; if (rest < span) break; rest -= span; from = c.at; ratio = c.ratio }
  return from + (rest * ratio) / k
}

/** The bars in the order they are played (repeats and jumps included), each with where it starts, in quarter notes of the played piece. */
export function playedBars(score: Score, repeats = true): { bar: number; q0: number; length: number }[] {
  let at = 0
  return playOrder(score.measures, repeats).map((bar) => { const b = { bar, q0: at, length: score.measures[bar].length }; at += b.length; return b })
}

/** Which bar, and how many quarter notes into it, the played piece is at `q` quarter notes from its start (undefined after the end); `next` is the bar that follows in the played order. */
export function locate(bars: { bar: number; q0: number; length: number }[], q: number): { bar: number; quarter: number; next?: number } | undefined {
  let lo = 0, hi = bars.length
  while (lo < hi) { const m = (lo + hi) >> 1; bars[m].q0 + bars[m].length <= q ? (lo = m + 1) : (hi = m) }
  const b = bars[lo]
  return b && q >= b.q0 ? { bar: b.bar, quarter: q - b.q0, next: bars[lo + 1]?.bar } : undefined
}

/** Metronome clicks for a whole piece in played order (repeats and jumps included), in seconds. The first click of every bar is the accent. */
export function scoreClicks(score: Score, repeats: boolean, bpm: number, changes: { at: number; ratio: number }[] = []): { t: number; accent: boolean }[] {
  const out: { t: number; accent: boolean }[] = []
  let at = 0
  for (const mi of playOrder(score.measures, repeats)) {
    const m = score.measures[mi], step = m.beat ?? 1
    for (let q = 0, k = 0; q < m.length - 1e-9; q += step, k++) out.push({ t: secondsAt(at + q, bpm, changes), accent: k === 0 })
    at += m.length
  }
  return out
}

/** `bpm` = quarter notes per minute (at the start; `changes` speed it up or down from there). */
export function toNotes(timed: Timed[], bpm: number, velocity = 85, changes: { at: number; ratio: number }[] = []): Note[] {
  const secs = (q: number) => secondsAt(q, bpm, changes)
  return timed.map((n) => ({ pitch: n.pitch, start: secs(n.start), duration: secs(n.start + n.duration) - secs(n.start), velocity: n.velocity ?? velocity, hand: (n.staff >= 1 ? 1 : 0) as 0 | 1 })) // upper staff = right hand
}
