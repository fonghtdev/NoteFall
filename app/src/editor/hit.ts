import { CLEFS } from './model'
import type { DrawnEv, DrawnMeasure, Layout } from './render'

export interface Hit {
  m: number
  staff: number
  diatonic: number     // C0 = 0, so middle C = 28
  ev?: DrawnEv         // the event whose column is nearest to the click, in the wanted voice
  at: number           // tick (within the bar) where the note goes: that column's, or the beat under the pointer inside a rest
  x: number            // where on the page that is
}


/**
 * Which bar / staff / pitch / beat does a click on the score mean? `voice` picks which voice's columns to snap to.
 * With `snap` (the length being entered), a pointer inside a rest means the beat under it, on a grid of that length (MuseScore splits the rest there).
 */
export function hitTest(layout: Layout, x: number, y: number, voice = 0, snap = 0): Hit | null {
  let best: { dm: DrawnMeasure; dist: number } | null = null
  for (const dm of layout.measures) {
    if (x < dm.x || x > dm.x + dm.w) continue
    const top = dm.staves[0].top - 5 * dm.staves[0].spacing, bottom = dm.staves[dm.staves.length - 1].bottom + 5 * dm.staves[0].spacing
    if (y < top || y > bottom) continue
    const mid = (top + bottom) / 2
    if (!best || Math.abs(y - mid) < best.dist) best = { dm, dist: Math.abs(y - mid) }
  }
  if (!best) return null
  const dm = best.dm
  let staff = 0, d = Infinity
  dm.staves.forEach((s, i) => { const dd = Math.abs(y - (s.top + s.bottom) / 2); if (dd < d) { d = dd; staff = i } })
  const st = dm.staves[staff]
  const half = Math.round((st.bottom - y) / (st.spacing / 2))
  const col = dm.evs.filter((e) => e.staff === staff && e.voice === voice)
  const ev = col.reduce<DrawnEv | undefined>((a, b) => (!a || Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a), undefined)
  const c = CLEFS[st.clef] // `diatonic` is what sounds, whatever octave the clef writes it in
  return { m: dm.m, staff, diatonic: c.bottom - 7 * c.shift + half, ev, ...(snap ? inRest(dm, col, x, snap) : undefined) ?? { at: ev?.at ?? 0, x: ev?.x ?? x } }
}

/** The beat under `x` when it falls inside a rest of the voice (`col`, in time order), snapped down to a multiple of `snap` from the bar start. */
function inRest(dm: DrawnMeasure, col: DrawnEv[], x: number, snap: number): { ev: DrawnEv; at: number; x: number } | undefined {
  const [first, last] = dm.notes ?? [dm.x, dm.x + dm.w]
  const sorted = [...col].sort((a, b) => a.at - b.at)
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i], x0 = i === 0 ? first : r.x - 6, x1 = sorted[i + 1] ? sorted[i + 1].x - 6 : last // a rest's room: from its own column (the bar start for the first) to the next one
    if (x < x0 || x >= x1) continue
    if (!r.rest) return undefined
    const tick = r.at + ((x - x0) / (x1 - x0 || 1)) * r.ticks
    const at = Math.max(r.at, Math.min(r.at + r.ticks - 1, Math.floor(tick / snap) * snap))
    return { ev: r, at, x: at === r.at && i > 0 ? r.x : x0 + ((at - r.at) / r.ticks) * (x1 - x0) + 6 }
  }
}

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'], FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F']
/** Alteration the key signature gives to a letter. */
export const keyAlter = (fifths: number, step: string) =>
  fifths > 0 ? (SHARP_ORDER.slice(0, fifths).includes(step) ? 1 : 0) : fifths < 0 ? (FLAT_ORDER.slice(0, -fifths).includes(step) ? -1 : 0) : 0
