import { TPQ } from './model'

/** One column of notes in a bar: where it sits in time and how far its ink reaches to the left and right of its x (heads, accidentals, dots, ledger lines). */
export interface Col { tick: number; left: number; right: number }
/** The room after a column (up to the next one or the barline): never less than `min`, a spring that wants `stretch` times the room of a quarter note. */
export interface Gap { min: number; stretch: number }

const PAD = 2          // px of air between two columns of ink
const END_PAD = 9      // px between the last column's ink and the barline
const LEAD_PAD = 8     // px between the clef/key/time signature (or the barline) and the first column's ink
const QUARTER = 34     // px a quarter note gets when nothing else decides (staff space 10)
const SLOPE = 1.5      // every halving of a note's length takes 1/1.5 of the room: sixteenths are tighter than quarters, not four times tighter
export const NATURAL = QUARTER

export const stretchOf = (ticks: number) => SLOPE ** Math.log2(ticks / TPQ)

/** The springs of a bar: one gap per column. A bar of rests only (no columns) is one gap as long as the bar. */
export function gapsOf(cols: Col[], barTicks: number): Gap[] {
  if (!cols.length) return [{ min: 40, stretch: stretchOf(barTicks) }]
  return cols.map((c, i) => {
    const next = cols[i + 1]
    return { min: next ? c.right + next.left + PAD : c.right + END_PAD, stretch: stretchOf((next?.tick ?? barTicks) - c.tick) }
  })
}

/** The space before a bar's first column. */
export const leadOf = (cols: Col[]) => (cols.length ? cols[0].left + LEAD_PAD : 0)

/** Width of a gap when the whole line pulls with `force` (px per unit of stretch): at NATURAL it is the natural width, above it the line is stretched, below it squeezed, never past `min`. */
export const gapWidth = (g: Gap, force: number) => Math.max(g.min, force * g.stretch)

/**
 * Find the force that makes the gaps of a whole line add up to `target` (the way a row of springs settles under one pull).
 * If even the minimums are wider than the target, the minimums win: touching is worse than a long line.
 */
export function forceFor(gaps: Gap[], target: number): number {
  const total = (f: number) => gaps.reduce((a, g) => a + gapWidth(g, f), 0)
  if (total(0) >= target) return 0
  let lo = 0, hi = NATURAL
  while (total(hi) < target) hi *= 2
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (total(mid) < target) lo = mid; else hi = mid }
  return hi
}
