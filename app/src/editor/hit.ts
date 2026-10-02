import { CLEFS } from './model'
import type { DrawnEv, DrawnMeasure, Layout } from './render'

export interface Hit {
  m: number
  staff: number
  diatonic: number     // C0 = 0, so middle C = 28
  ev?: DrawnEv         // the event whose column is nearest to the click, in the wanted voice
  at: number           // tick (within the bar) where that column starts
}


/** Which bar / staff / pitch / beat does a click on the score mean? `voice` picks which voice's columns to snap to. */
export function hitTest(layout: Layout, x: number, y: number, voice = 0): Hit | null {
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
  return { m: dm.m, staff, diatonic: c.bottom - 7 * c.shift + half, ev, at: ev?.at ?? 0 }
}

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'], FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F']
/** Alteration the key signature gives to a letter. */
export const keyAlter = (fifths: number, step: string) =>
  fifths > 0 ? (SHARP_ORDER.slice(0, fifths).includes(step) ? 1 : 0) : fifths < 0 ? (FLAT_ORDER.slice(0, -fifths).includes(step) ? -1 : 0) : 0
