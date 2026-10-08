// Reads engraved (vector) sheet music: PagePrims -> measures of notes.
// Deterministic geometry, not machine learning: noteheads/clefs/accidentals are music-font glyphs, staves/stems/bars are lines.
// Glyph codes follow the Sonata/Maestro layout; codes marked "unverified" are absent from the sample PDF and rely on the bar-length check.
import type { Glyph, PagePrims, Poly, Seg } from './primitives'
import { clickStep } from '../beats'
import { readNavigation, type BarGeom } from './navigation'
import { DYN_BY_TEXT, L_P, L_Z, dynText } from './dynamics'
import { fromSmufl, isSmufl } from './smufl'
import { realizeVoice } from './realize'

// ---- glyph vocabulary -------------------------------------------------------------------------------------
const TREBLE = 0xf026, BASS = 0xf03f
const NOTE_FILLED = 0xf0cf, NOTE_HOLLOW = 0xf0fa, SLUR = 0xf0d1
const ACC: Record<number, number> = { 0xf023: 1, 0xf06e: 0, 0xf062: -1, 0xf100: 2, 0xf101: -2 } // sharp, natural, flat, double sharp, double flat
const DOT = 0xf0aa
const REST: Record<number, number> = { 0xf0ce: 1, 0xf0ee: 2, 0xf0b7: 4, 0xf0e4: 0.5, 0xf0c5: 0.25 } // quarter (verified); half/whole/8th/16th unverified
const FLAG: Record<number, number> = { 0xf06a: 1 }
const ORNAMENT: Record<number, 'mordent' | 'inverted' | 'trill' | 'turn'> = { 0xf04d: 'mordent', 0xf06d: 'inverted', 0xf140: 'trill', 0xf141: 'turn' } // zigzag with / without a vertical stroke
const IGNORED = new Set([0xf055, 0xf075]) // fermatas: shown, not played
const C_CLEF = 0xf106 // alto or tenor: told apart by which line the clef sits on
const CLEF_BASE: Record<number, number> = { [TREBLE]: 4 * 7 + 2, [BASS]: 2 * 7 + 4, 0xf102: 3 * 7 + 2, 0xf103: 5 * 7 + 2, 0xf104: 1 * 7 + 4, 0xf105: 3 * 7 + 4 } // diatonic index of the bottom line: E4, G2, (8vb / 8va variants)
const ARTIC: Record<number, string> = { 0xf120: 'staccato', 0xf121: 'accent', 0xf122: 'tenuto', 0xf123: 'marcato', 0xf124: 'staccatissimo' }
const TUPLET_DIGIT = (c: number) => (c >= 0xf112 && c <= 0xf119 ? c - 0xf110 : 0)
const TUPLET_OF: Record<number, number> = { 2: 3, 3: 2, 4: 3, 5: 4, 6: 4, 7: 4, 9: 8 } // n notes in the time of m
const SEMI = [0, 2, 4, 5, 7, 9, 11] // C D E F G A B

export interface ScoreNote { pitch: number; start: number; duration: number; staff: number; tieNext?: boolean; velocity?: number; hold?: number } // start/duration in quarter notes, relative to the measure; staff 0 = upper; hold: how long it sounds when the pedal keeps it on (longer than duration)
/** One written event, as the editor wants it (no ornament expansion, rests kept). */
export interface Written { hidden?: boolean; art?: string[]; vel?: number; tup?: { n: number; m: number; group: number }; ticks: number; pitches: { step: string; alter: number; octave: number }[]; tie?: boolean; orn?: 'mordent' | 'inverted' | 'trill' | 'turn'; arp?: 'up' | 'down' | 'plain'; trem?: 1 | 2 | 3; graces?: { step: string; alter: number; octave: number }[] }
export interface Measure {
  index: number          // 1-based, in reading order
  length: number        // quarter notes the time signature promises
  notes: ScoreNote[]
  startRepeat: boolean
  endRepeat: boolean
  suspect?: string       // set when the rhythm does not add up to `length`
  tempo?: number         // quarter notes per minute in force at the start of this bar (absent = the score's single tempo)
  tempoChanges?: { at: number; bpm: number }[] // changes inside the bar, `at` in quarter notes from the barline
  beat?: number          // quarter notes per metronome click in this bar (1 in 4/4, 1.5 in 6/8 …)
  written?: { staff: number; hand?: number; voices: Written[][] }[] // notation view of the same bar, for editing
  // navigation (set by the composer / MusicXML, not read from PDFs yet)
  volta?: number[]       // this bar is inside an ending bracket for these passes (1st, 2nd ending…)
  segno?: boolean        // the bar where a D.S. jumps to
  coda?: boolean         // the bar a "to Coda" jump lands on
  toCoda?: boolean       // after a D.C./D.S. al Coda, playing this bar continues at the Coda
  fine?: boolean         // after a D.C./D.S. al Fine, playing this bar ends the piece
  jump?: { kind: 'dc' | 'ds'; al: 'end' | 'fine' | 'coda' } // at the end of this bar go back to the start / the segno
}
export interface Score { measures: Measure[]; beatsPerBar: number; beatUnit: number; warnings: string[]; title?: string; keyFifths?: number; tempo?: number; clefs?: ('treble' | 'bass')[] }

type VSeg = Seg & { lo: number; hi: number }
interface Staff { bottom: number; sp: number; top: number; x0: number; x1: number }
interface Head {
  g: Glyph; staff: number; step: number; hollow: boolean; grace: boolean
  stem?: VSeg; dir?: 'up' | 'down'; dots: number; acc?: number; pitch?: number; tie?: boolean; d?: number; orn?: 'mordent' | 'inverted' | 'trill' | 'turn'; art?: string[]; trem?: 1 | 2 | 3
}
interface Event { x: number; heads: Head[]; rest?: Glyph; dur: number; dir?: 'up' | 'down'; grace: boolean; y: number; scaled?: boolean; tup?: { n: number; m: number; group: number } }

const isMusic = (g: Glyph) => g.code >= 0xf000 && g.code <= 0xf1ff

// ---- staves --------------------------------------------------------------------------------------------------
export function findStaves(p: PagePrims): Staff[] {
  // Some exporters (MuseScore 4) draw a staff line as one piece per bar: join the pieces that lie on the same height and touch
  const rows = p.segs.filter((s) => Math.abs(s.y1 - s.y2) < 0.01 && Math.abs(s.x2 - s.x1) > 5).map((s) => ({ y: s.y1, x0: Math.min(s.x1, s.x2), x1: Math.max(s.x1, s.x2) })).sort((a, b) => a.y - b.y || a.x0 - b.x0)
  const ys: { y: number; x0: number; x1: number }[] = []
  for (const r of rows) {
    const last = ys[ys.length - 1]
    if (last && Math.abs(last.y - r.y) < 0.05 && r.x0 <= last.x1 + 1.5) { last.x0 = Math.min(last.x0, r.x0); last.x1 = Math.max(last.x1, r.x1) }
    else ys.push({ ...r })
  }
  for (let i = ys.length - 1; i >= 0; i--) if (ys[i].x1 - ys[i].x0 <= 100) ys.splice(i, 1)
  ys.sort((a, b) => b.y - a.y)
  // five lines an equal gap apart; another long line may lie between them (a slur or a beam drawn as a stroke), so the lines are picked out, not taken in a row
  const staves: Staff[] = []
  const used = new Set<number>()
  const near = (y: number, tol: number, from: number) => { for (let k = from; k < ys.length; k++) if (!used.has(k) && Math.abs(ys[k].y - y) < tol) return k; return -1 }
  for (let i = 0; i < ys.length; i++) {
    if (used.has(i)) continue
    for (let j = i + 1; j < ys.length; j++) {
      const gap = ys[i].y - ys[j].y
      if (gap > 30) break
      if (gap <= 2 || used.has(j)) continue
      const rest = [2, 3, 4].map((n) => near(ys[i].y - n * gap, gap * 0.08, j + 1))
      if (rest.some((k) => k < 0)) continue
      const run = [i, j, ...rest].map((k) => ys[k])
      run.forEach((_, n) => used.add([i, j, ...rest][n]))
      staves.push({ top: run[0].y, bottom: run[4].y, sp: (run[0].y - run[4].y) / 4, x0: Math.min(...run.map((l) => l.x0)), x1: Math.max(...run.map((l) => l.x1)) })
      break
    }
  }
  return staves
}

const staffOf = (staves: Staff[], y: number) => {
  let best = -1, d = Infinity
  staves.forEach((s, i) => { const dd = y > s.top ? y - s.top : y < s.bottom ? s.bottom - y : 0; if (dd < d) { d = dd; best = i } })
  return best
}

// ---- beams -------------------------------------------------------------------------------------------------
/** Vertical extent of a filled polygon along x (null if x is outside it). */
function polyYAt(p: Poly, x: number): [number, number] | null {
  const ys: number[] = []
  for (let i = 0; i + 1 < p.pts.length; i++) {
    const [ax, ay] = p.pts[i], [bx, by] = p.pts[i + 1]
    if (ax === bx) continue
    if (x >= Math.min(ax, bx) - 0.3 && x <= Math.max(ax, bx) + 0.3) ys.push(ay + ((Math.min(Math.max(x, Math.min(ax, bx)), Math.max(ax, bx)) - ax) / (bx - ax)) * (by - ay))
  }
  return ys.length >= 2 ? [Math.min(...ys), Math.max(...ys)] : null
}
/** A beam is a thin filled quadrilateral much wider than it is tall. */
const isBeam = (p: Poly) => {
  const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1])
  const w = Math.max(...xs) - Math.min(...xs)
  return p.pts.length <= 6 && w > 3 && w < 400 && Math.max(...ys) - Math.min(...ys) < 0.45 * w + 6
}

// ---- main ------------------------------------------------------------------------------------------------
export function readScore(rawPages: PagePrims[]): Score {
  const pages = rawPages.map((p) => (isSmufl(p) ? fromSmufl(p) : p)) // MuseScore 4 / Dorico / LilyPond style fonts
  const warnings: string[] = []
  const measures: Measure[] = []
  let beats = 4, unit = 4
  const unknown = new Map<number, number>()
  const navPages: { p: PagePrims; geoms: BarGeom[]; start: number }[] = []
  let keyFifths: number | undefined
  let firstClefs: ('treble' | 'bass')[] | undefined
  let timeSigSeen = false
  let beats0 = 4, unit0 = 4
  let pendingStartRepeat = false
  let tupletId = 0
  let level: number | undefined // loudness in force (from the last dynamic marking), carried from system to system

  for (const [pi, p] of pages.entries()) {
    const staves = findStaves(p)
    if (!staves.length) continue
    const navEntry = { p, geoms: [] as BarGeom[], start: measures.length }
    navPages.push(navEntry)
    // systems: staves joined by a vertical line spanning the gap between them (the grand-staff barline)
    const joined = (a: Staff, b: Staff) => p.segs.some((s) => Math.abs(s.x1 - s.x2) < 0.01 && Math.min(s.y1, s.y2) <= b.top + 0.5 && Math.max(s.y1, s.y2) >= a.bottom - 0.5 && s.x1 >= a.x0 - 1 && s.x1 <= a.x1 + 1 && Math.abs(Math.max(s.y1, s.y2) - Math.min(s.y1, s.y2)) < 40 * a.sp)
    const systems: number[][] = []
    staves.forEach((s, i) => {
      const prev = systems[systems.length - 1]
      if (prev && joined(staves[prev[prev.length - 1]], s)) prev.push(i)
      else systems.push([i])
    })

    // ---- glyphs -> heads, rests, clefs, accidentals, dots
    const music = p.glyphs.filter(isMusic)
    for (const g of music) {
      const known = g.code in ACC || g.code in CLEF_BASE || g.code in REST || g.code in FLAG || g.code in ORNAMENT || IGNORED.has(g.code) ||
        [NOTE_FILLED, NOTE_HOLLOW, SLUR, DOT, C_CLEF].includes(g.code) || (g.code >= 0xf030 && g.code <= 0xf039) || g.code in ARTIC || (g.code >= 0xf110 && g.code <= 0xf119) || (g.code >= L_P && g.code <= L_Z) || (g.code >= 0xf150 && g.code <= 0xf152) || (g.code >= 0xf160 && g.code <= 0xf162) || g.code === 0xf170
      if (!known) unknown.set(g.code, (unknown.get(g.code) ?? 0) + 1)
    }
    const heads: Head[] = []
    const clefs: { g: Glyph; staff: number; base: number }[] = []
    const rests: { g: Glyph; staff: number; dur: number; dots?: number }[] = []
    for (const g of music) {
      const si = staffOf(staves, g.y)
      if (si < 0) continue
      if (g.code === NOTE_FILLED || g.code === NOTE_HOLLOW) {
        const st = staves[si], raw = (g.y - st.bottom) / (st.sp / 2)
        const grace = g.size < 0.8 * 4 * st.sp // cue-size notehead
        heads.push({ g, staff: si, step: Math.round(raw), hollow: g.code === NOTE_HOLLOW, grace, dots: 0 })
        if (!grace && Math.abs(raw - Math.round(raw)) > 0.2) warnings.push(`p${pi + 1}: notehead off the staff grid at x=${g.x.toFixed(0)}`)
      } else if (g.code in CLEF_BASE) clefs.push({ g, staff: si, base: CLEF_BASE[g.code] })
      else if (g.code === C_CLEF) clefs.push({ g, staff: si, base: 28 - 2 * Math.round((g.y - staves[si].bottom) / staves[si].sp) }) // C4 sits on the line the clef marks: bottom line = C4 minus two steps per line
      else if (g.code in REST) rests.push({ g, staff: si, dur: REST[g.code] })
    }
    // a rest displaced by a second voice can sit almost equally far from two staves: then the nearest note in its column decides
    const gapTo = (st: Staff, y: number) => (y > st.top ? y - st.top : y < st.bottom ? st.bottom - y : 0)
    for (const r of rests) {
      const d = staves.map((st) => gapTo(st, r.g.y)).sort((x, y) => x - y)
      if (d.length < 2 || d[1] > 1.35 * d[0]) continue // clearly one staff
      const near = heads.filter((h) => Math.abs(h.g.x - r.g.x) < 1.1 * h.g.w && Math.abs(h.g.y - r.g.y) < 10 * staves[h.staff].sp)
      if (near.length) r.staff = near.reduce((a, b) => (Math.abs(b.g.y - r.g.y) < Math.abs(a.g.y - r.g.y) ? b : a)).staff
    }
    const clefAt = (staff: number, x: number) =>
      clefs.filter((c) => c.staff === staff && c.g.x <= x + 1).sort((a, b) => b.g.x - a.g.x)[0]

    // ---- stems
    const vert = p.segs.filter((s) => Math.abs(s.x1 - s.x2) < 0.01).map((s) => ({ ...s, lo: Math.min(s.y1, s.y2), hi: Math.max(s.y1, s.y2) }))
    const stemOf = new Map<VSeg, Head[]>()
    const usedAsStem = new Set<VSeg>()
    for (const h of heads) {
      const sp = staves[h.staff].sp
      for (const s of vert) {
        if (s.hi - s.lo < 2 * sp || s.hi - s.lo > 9 * sp) continue
        if (s.x1 < h.g.x - 0.8 || s.x1 > h.g.x + h.g.w + 0.8) continue
        if (h.g.y < s.lo - 0.35 * sp || h.g.y > s.hi + 0.35 * sp) continue
        // a stem starts at the notehead centre: one of its ends must be near this head or another head of the chord
        h.stem = s
        const arr = stemOf.get(s) ?? []; arr.push(h); stemOf.set(s, arr); usedAsStem.add(s)
        break
      }
    }
    for (const [s, hs] of stemOf) {
      const lowest = Math.min(...hs.map((h) => h.g.y)), highest = Math.max(...hs.map((h) => h.g.y))
      const dir = s.hi - highest > lowest - s.lo ? 'up' : 'down'
      hs.forEach((h) => (h.dir = dir))
    }

    // ---- barlines: vertical lines spanning a whole staff that are not stems
    const barXs = (si: number[]) => {
      const xs: { x: number; w: number }[] = []
      for (const s of vert) {
        if (usedAsStem.has(s)) continue
        const covers = si.some((i) => s.lo <= staves[i].bottom + 0.4 && s.hi >= staves[i].top - 0.4)
        if (covers) xs.push({ x: s.x1, w: s.w })
      }
      for (const q of p.polys) { // thick bars are sometimes filled rectangles
        const xsq = q.pts.map((t) => t[0]), ysq = q.pts.map((t) => t[1])
        if (q.pts.length <= 6 && Math.max(...xsq) - Math.min(...xsq) < 5 && si.some((i) => Math.min(...ysq) <= staves[i].bottom + 0.4 && Math.max(...ysq) >= staves[i].top - 0.4)) xs.push({ x: (Math.min(...xsq) + Math.max(...xsq)) / 2, w: Math.max(...xsq) - Math.min(...xsq) })
      }
      xs.sort((a, b) => a.x - b.x)
      const clusters: { lo: number; hi: number }[] = []
      for (const b of xs) {
        const c = clusters[clusters.length - 1]
        if (c && b.x - c.hi < 6) c.hi = b.x
        else clusters.push({ lo: b.x, hi: b.x })
      }
      return clusters
    }

    // ---- accidentals and dots attached to heads
    const accs = music.filter((g) => g.code in ACC)
    const dots = music.filter((g) => g.code === DOT)
    const attachedAcc = new Set<Glyph>(), attachedDot = new Set<Glyph>()
    for (const h of heads) {
      const sp = staves[h.staff].sp, st = staves[h.staff]
      for (const a of accs) {
        if (staffOf(staves, a.y) !== h.staff) continue
        const gap = h.g.x - (a.x + a.w)
        if (gap > -0.3 && gap < 0.75 * sp && Math.abs(a.y - h.g.y) < 0.6 * (st.sp / 2) * 2) { h.acc = ACC[a.code]; attachedAcc.add(a); break }
      }
      let best: Glyph | undefined, bd = Infinity
      for (const d of dots) {
        if (staffOf(staves, d.y) !== h.staff) continue
        const dx = d.x - (h.g.x + h.g.w)
        if (dx > -0.5 && dx < 1.7 * sp && Math.abs(d.y - h.g.y) < 0.8 * sp && dx < bd) { best = d; bd = dx }
      }
      if (best) { h.dots = 1; attachedDot.add(best) }
    }
    // a dot right after a rest lengthens it too (a dotted quarter rest is a beat and a half); the dot sits somewhere in the rest's height
    for (const r of rests) {
      const sp = staves[r.staff].sp
      const near = (d: Glyph) => !attachedDot.has(d) && staffOf(staves, d.y) === r.staff && d.x - (r.g.x + r.g.w) > -0.5 && d.x - (r.g.x + r.g.w) < 2 * sp && Math.abs(d.y - r.g.y) < 1.6 * sp
      const first = dots.filter(near).sort((a, b) => a.x - b.x)[0]
      if (!first) continue
      attachedDot.add(first); r.dots = 1
      const second = dots.find((d) => !attachedDot.has(d) && Math.abs(d.y - first.y) < 0.2 && d.x - first.x > 1 && d.x - first.x < 1.2 * sp)
      if (second) { attachedDot.add(second); r.dots = 2 }
    }
    // articulation marks (staccato, accent, tenuto, marcato) belong to the note whose column and height they sit by
    for (const a of music) {
      const kind = ARTIC[a.code]
      if (!kind) continue
      let best: Head | undefined, bd = Infinity
      for (const h of heads) {
        const sp = staves[h.staff].sp, cx = h.g.x + h.g.w / 2, ax = a.x + a.w / 2
        if (Math.abs(cx - ax) > 0.9 * h.g.w) continue
        const dy = Math.abs(a.y - h.g.y)
        if (dy > 4.5 * sp || dy >= bd) continue
        best = h; bd = dy
      }
      if (best) best.art = [...new Set([...(best.art ?? []), kind])]
    }
    // tremolo strokes cross the stem of a note: one, two or three of them
    for (const t of music) {
      if (t.code < 0xf150 || t.code > 0xf152) continue
      let best: Head | undefined, bd = Infinity
      for (const h of heads) {
        const sp = staves[h.staff].sp, dx = Math.abs(t.x + t.w / 2 - (h.stem ? h.stem.x1 : h.g.x + h.g.w / 2)), dy = Math.abs(t.y - h.g.y)
        if (dx < 1.2 * h.g.w && dy < 6 * sp && dy < bd) { best = h; bd = dy }
      }
      if (best) best.trem = (t.code - 0xf150 + 1) as 1 | 2 | 3
    }
    // second dot (double-dotted): another dot just right of an attached one
    for (const h of heads) {
      if (!h.dots) continue
      const sp = staves[h.staff].sp
      const first = dots.find((d) => attachedDot.has(d) && Math.abs(d.y - h.g.y) < 0.8 * sp && d.x > h.g.x + h.g.w - 0.5 && d.x < h.g.x + h.g.w + 1.7 * sp)
      const second = first && dots.find((d) => !attachedDot.has(d) && Math.abs(d.y - first.y) < 0.2 && d.x - first.x > 1 && d.x - first.x < 1.2 * sp)
      if (second) { h.dots = 2; attachedDot.add(second) }
    }

    // ---- ties: a curve (font glyph or path) running from one notehead to the next head of the same pitch on the same staff
    const curveBoxes = [
      ...music.filter((g) => g.code === SLUR).map((g) => ({ x0: g.x, x1: g.x + g.w, y: g.y })),
      ...p.curves.filter((c) => c.x1 - c.x0 > 6 && c.x1 - c.x0 < 150 && c.y1 - c.y0 < 14).map((c) => ({ x0: c.x0, x1: c.x1, y: (c.y0 + c.y1) / 2 })),
    ]
    for (const cv of curveBoxes) {
      const si = staffOf(staves, cv.y)
      const onStaff = heads.filter((h) => h.staff === si && !h.grace)
      for (const h1 of onStaff) {
        const tol = 1.3 * h1.g.w
        if (Math.abs(cv.x0 - (h1.g.x + h1.g.w / 2)) > tol) continue
        const h2 = onStaff.filter((h) => h.step === h1.step && h.g.x > h1.g.x + h1.g.w && Math.abs(cv.x1 - (h.g.x + h.g.w / 2)) <= tol)[0]
        if (h2) h1.tie = true
      }
    }

    // ---- ornaments: a mordent sign sits centred above its notehead
    for (const o of music) {
      const kind = ORNAMENT[o.code]
      if (!kind) continue
      const si = staffOf(staves, o.y)
      const under = heads.filter((h) => h.staff === si && !h.grace && Math.abs(o.x + o.w / 2 - (h.g.x + h.g.w / 2)) < 0.4 * h.g.w)
      if (under.length) under.reduce((a, b) => (b.g.y > a.g.y ? b : a)).orn = kind
      else warnings.push(`p${pi + 1}: ornament at x=${o.x.toFixed(0)} has no note under it`)
    }

    // ---- per system: measures
    for (const sys of systems) {
      const bars = barXs(sys)
      if (bars.length < 2) { warnings.push(`p${pi + 1}: system without barlines skipped`); continue }

      const mod7k = (d: number) => ((d % 7) + 7) % 7
      /** x of the first note or rest of one staff inside [xa, xb): where the bar's own music starts. */
      const firstEventX = (si: number, xa: number, xb: number) => {
        let m = Infinity
        for (const h of heads) if (h.staff === si && h.g.x >= xa && h.g.x < xb) m = Math.min(m, h.g.x)
        for (const r of rests) if (r.staff === si && r.g.x >= xa && r.g.x < xb) m = Math.min(m, r.g.x)
        return m === Infinity ? xb : m
      }
      /**
       * The key signature standing in front of a bar: accidentals that belong to no note, between the barline and the bar's first note.
       * At the start of a line it is the whole signature; in the middle of a line it changes the one before (naturals cancel).
       */
      const readKey = (si: number, xa: number, xb: number, base: Map<number, number> | undefined) => {
        const fresh = accs.filter((a) => !attachedAcc.has(a) && staffOf(staves, a.y) === si && a.x >= xa && a.x < xb).sort((p, q) => p.x - q.x)
        if (!fresh.length) return base ?? new Map<number, number>()
        if (base && fresh[0].x - xa > 3.5 * staves[si].sp) return base // not hugging the barline: an accidental of a chord, not a new key signature
        // a real key signature is a run of one kind of sign in the standard order (F C G D A E B for sharps, B E A D G C F for flats)
        const ORDER = { sharp: [3, 0, 4, 1, 5, 2, 6], flat: [6, 2, 5, 1, 4, 0, 3] } // letter indices (C=0 … B=6) in order; letters computed below
        const letters = fresh.map((a) => { const c = clefAt(si, a.x); return c ? mod7k(c.base + Math.round((a.y - staves[si].bottom) / (staves[si].sp / 2))) : -1 })
        const kinds = new Set(fresh.map((a) => Math.sign(ACC[a.code])))
        const prefix = (ord: number[]) => letters.every((l, i) => l === ord[i])
        const looksLikeKey = kinds.size === 1 && (kinds.has(1) ? prefix(ORDER.sharp) : kinds.has(-1) ? prefix(ORDER.flat) : prefix(ORDER.sharp) || prefix(ORDER.flat) || (base !== undefined && letters.every((l) => base.has(l))))
        if (base && !looksLikeKey) return base
        const out = new Map(base ?? [])
        for (const a of fresh) {
          const clef = clefAt(si, a.x)
          if (!clef) continue
          const letter = mod7k(clef.base + Math.round((a.y - staves[si].bottom) / (staves[si].sp / 2)))
          if (!base) out.set(letter, ACC[a.code])
          else if (ACC[a.code] === 0) out.delete(letter)
          else out.set(letter, ACC[a.code])
        }
        return out
      }
      /** A time signature in front of a bar: digits inside the staff (a multi-measure-rest count sits above it), or the C / cut-time sign. */
      const readTime = (xa: number, xb: number): { beats: number; unit: number } | undefined => {
        const st = staves[sys[0]], mid = (st.top + st.bottom) / 2
        const inside = music.filter((g) => g.x >= xa && g.x < xb && g.y >= st.bottom - 0.5 * st.sp && g.y <= st.top + 0.5 * st.sp)
        const sym = inside.find((g) => g.code === 0xf190 || g.code === 0xf191)
        if (sym) return sym.code === 0xf190 ? { beats: 4, unit: 4 } : { beats: 2, unit: 2 }
        const digits = inside.filter((g) => g.code >= 0xf030 && g.code <= 0xf039)
        const num = (arr: Glyph[]) => +arr.sort((p, q) => p.x - q.x).map((g) => g.code - 0xf030).join('')
        const top = digits.filter((g) => g.y > mid), bot = digits.filter((g) => g.y <= mid)
        return top.length && bot.length ? { beats: num(top), unit: num(bot) } : undefined
      }

      // key signature per staff, from the first bar of the line (changes inside the line are read bar by bar below)
      const keyAlter = new Map<number, Map<number, number>>() // staff -> diatonic letter -> alteration
      for (const si of sys) keyAlter.set(si, readKey(si, staves[si].x0, firstEventX(si, bars[0].hi, bars[1].lo), undefined))
      if (keyFifths === undefined) {
        const top = keyAlter.get(sys[0])!
        keyFifths = [...top.values()].reduce((a, v) => a + Math.sign(v), 0)
        firstClefs = sys.map((si) => { const c = clefAt(si, 1e9); return c && (c.g.code === BASS || c.g.code === 0xf104 || c.g.code === 0xf105) ? 'bass' : 'treble' })
      }

      // time signature at the start of the line (a change inside the line is read bar by bar below)
      const ts0 = readTime(staves[sys[0]].x0, Math.min(...sys.map((si) => firstEventX(si, bars[0].hi, bars[1].lo))))
      if (ts0) { beats = ts0.beats; unit = ts0.unit; if (!timeSigSeen) { beats0 = beats; unit0 = unit } timeSigSeen = true }
      let barLen = (beats * 4) / unit
      // with more than two staves each one still plays as a "hand": bass-like clefs (bass, tenor, 8vb) are the left hand
      const handOf = (si: number) => (sys.length <= 2 ? sys.indexOf(si) : (clefAt(si, 1e9)?.base ?? 30) <= 22 ? 1 : 0)
      // dynamic markings of this system: letters p m f r s z lying on one line, close together, make one marking
      const dynMarks: { x: number; vel: number }[] = []
      {
        const top = staves[sys[0]].top, bottom = staves[sys[sys.length - 1]].bottom, sp0 = staves[sys[0]].sp
        const letters = music.filter((g) => g.code >= L_P && g.code <= L_Z && g.y < top + 4 * sp0 && g.y > bottom - 8 * sp0 && g.x >= staves[sys[0]].x0 && g.x <= staves[sys[0]].x1).sort((a, b) => a.x - b.x)
        const used = new Set<Glyph>()
        for (const l0 of letters) {
          if (used.has(l0)) continue
          const run = [l0]; used.add(l0)
          for (const g of letters) { const last = run[run.length - 1]; if (!used.has(g) && Math.abs(g.y - l0.y) < 0.6 && g.x - (last.x + last.w) > -1 && g.x - (last.x + last.w) < 0.6 * sp0) { run.push(g); used.add(g) } }
          const vel = DYN_BY_TEXT[dynText(run.map((g) => g.code))]
          if (vel) dynMarks.push({ x: l0.x, vel })
        }
      }
      const velAt = (x: number, from: number | undefined) => { let v = from; for (const d of dynMarks) if (d.x <= x + 0.7 * staves[sys[0]].sp) v = d.vel; return v }
      const levelBefore = level
      // ottava: a label ("8va", "8vb", "15ma", "15mb") with a dashed line after it; the notes under the line are written one or two octaves off
      const ottavas: { si: number; x0: number; x1: number; shift: number }[] = []
      for (const lab of p.glyphs.filter((g) => g.code >= 0xe510 && g.code <= 0xe51b)) {
        const si = sys.find((i) => lab.y > staves[i].top + 0.5 * staves[i].sp ? lab.y < staves[i].top + 9 * staves[i].sp : lab.y < staves[i].bottom - 0.5 * staves[i].sp && lab.y > staves[i].bottom - 9 * staves[i].sp) // above the staff, or below it
        if (si === undefined) continue
        const sp = staves[si].sp, above = lab.y > (staves[si].top + staves[si].bottom) / 2
        const rowSegs = p.segs.filter((q) => Math.abs(q.y1 - q.y2) < 0.5 && Math.abs(q.y1 - lab.y) < 2.5 * sp && Math.min(q.x1, q.x2) >= lab.x - 1).sort((a, b) => Math.min(a.x1, a.x2) - Math.min(b.x1, b.x2))
        let end = lab.x + lab.w
        for (const q of rowSegs) { if (Math.min(q.x1, q.x2) - end > 2.5 * sp) break; end = Math.max(end, q.x1, q.x2) }
        if (end > lab.x + lab.w) ottavas.push({ si, x0: lab.x, x1: end + 0.5 * sp, shift: (lab.code >= 0xe514 ? 14 : 7) * (above ? 1 : -1) }) // above: sounds higher than written
      }
      const ottavaAt = (si: number, x: number) => ottavas.find((o) => o.si === si && x >= o.x0 && x <= o.x1)?.shift ?? 0

      for (let bi = 0; bi + 1 < bars.length; bi++) {
        const left = bars[bi], right = bars[bi + 1]
        const x0 = left.hi, x1 = right.lo
        if (bi > 0) { // a key or time signature that changes in the middle of the line stands right after the barline
          for (const si of sys) keyAlter.set(si, readKey(si, x0, firstEventX(si, x0, x1), keyAlter.get(si)))
          const tn = readTime(x0, Math.min(...sys.map((si) => firstEventX(si, x0, x1))))
          if (tn && (tn.beats !== beats || tn.unit !== unit)) { beats = tn.beats; unit = tn.unit; barLen = (beats * 4) / unit }
        }
        // repeat dots: a vertical pair of dots (spaces 2 and 3) right next to a barline cluster
        const repeatDots = (cx: number, side: 'l' | 'r') => dots.some((d) => {
          const st = staves[sys[0]], dxs = side === 'l' ? cx - d.x : d.x - cx
          if (dxs < -1 || dxs > 14 || sys.every((i) => staffOf(staves, d.y) !== i)) return false
          const partner = dots.find((e) => e !== d && Math.abs(e.x - d.x) < 0.5 && Math.abs(e.y - d.y) > st.sp * 0.8 && Math.abs(e.y - d.y) < st.sp * 1.2)
          return !!partner && !attachedDot.has(d)
        })
        const endRepeat = repeatDots(right.lo, 'l')
        const startRepeat = repeatDots(left.hi, 'r')
        for (const d of dots) if (!attachedDot.has(d) && (repeatDots(right.lo, 'l') || repeatDots(left.hi, 'r'))) attachedDot.add(d)

        const writtenOut: NonNullable<Measure['written']> = []
        let suspect: string | undefined
        let hasContent = false
        for (const si of sys) {
          const inM = (x: number) => x > x0 + 0.5 && x < x1 - 0.5
          const hs = heads.filter((h) => h.staff === si && inM(h.g.x))
          const rs = rests.filter((r) => r.staff === si && inM(r.g.x))
          // a "repeat the previous bar" sign: this staff plays what the bar before it played
          if (!hs.length && measures.length && music.some((g) => g.code === 0xf170 && inM(g.x) && staffOf(staves, g.y) === si)) {
            const prev = measures[measures.length - 1].written?.find((w) => w.staff === si - sys[0])
            if (prev) { writtenOut.push({ staff: si - sys[0], hand: handOf(si), voices: structuredClone(prev.voices) }); hasContent = true; continue }
          }
          if (!hs.length && !rs.length) continue
          hasContent = true
          const st = staves[si], sp = st.sp

          // events: chords (heads sharing a stem) and rests
          const events: Event[] = []
          const done = new Set<Head>()
          for (const h of hs) {
            if (done.has(h)) continue
            const chord = h.stem ? hs.filter((o) => o.stem === h.stem) : [h]
            chord.forEach((o) => done.add(o))
            const s = h.stem
            let beamsN = 0
            if (s && !h.grace) {
              const tip = h.dir === 'up' ? s.hi : s.lo
              for (const q of p.polys) {
                if (!isBeam(q)) continue
                const yr = polyYAt(q, s.x1)
                if (!yr) continue
                const c = (yr[0] + yr[1]) / 2
                const inward = h.dir === 'up' ? c <= tip + 0.3 : c >= tip - 0.3
                if (inward && Math.abs(c - tip) < 2.3 * sp) beamsN++
              }
              if (!beamsN) for (const f of music) if (f.code in FLAG && Math.abs(f.x - s.x1) < 3 && Math.abs(f.y - tip) < 3 * sp) beamsN += FLAG[f.code]
            }
            const hollow = h.hollow
            let dur = hollow ? (s ? 2 : 4) : s ? 1 / 2 ** beamsN : 1
            const dots = Math.max(...chord.map((o) => o.dots))
            dur *= 2 - 0.5 ** dots
            events.push({ x: Math.min(...chord.map((o) => o.g.x)), heads: chord, dur, dir: h.dir, grace: h.grace, y: h.g.y })
          }
          // a whole rest standing alone in a bar means "the whole bar", whatever the time signature (3/8, 6/8, 2/4 …)
          for (const r of rs) events.push({ x: r.g.x, heads: [], rest: r.g, dur: r.dur === 4 && rs.length === 1 && !hs.length ? barLen : r.dur * (2 - 0.5 ** (r.dots ?? 0)), grace: false, y: r.g.y })
          events.sort((a, b) => a.x - b.x)
          // tuplets: a digit (3, 5, 6 …) over / under a group of notes: n notes in the time of m, so each lasts m/n of what its beams say
          for (const dg of music) {
            const n = TUPLET_DIGIT(dg.code), m = TUPLET_OF[n]
            if (!m || dg.x < x0 || dg.x > x1 || Math.abs(dg.y - (st.top + st.bottom) / 2) > 9 * sp) continue
            if (sys.some((o) => o !== si && Math.abs(dg.y - (staves[o].top + staves[o].bottom) / 2) < Math.abs(dg.y - (st.top + st.bottom) / 2))) continue // belongs to the other staff
            const cands = events.filter((e) => !e.grace && !e.scaled)
            if (cands.length < n) continue
            const near = cands.reduce((a, b) => (Math.abs(b.x - dg.x) < Math.abs(a.x - dg.x) ? b : a))
            const singleVoice = cands.every((e, i) => i === 0 || e.x - cands[i - 1].x > 0.8 * (st.sp * 1.18)) // no two events share a column
            const same = singleVoice ? cands : cands.filter((e) => e.dir === near.dir || !e.heads.length) // with two voices, follow the stem direction of the nearest note
            let best = -1, bd = Infinity
            for (let k = 0; k + n <= same.length; k++) {
              const w = same.slice(k, k + n), c = (w[0].x + w[n - 1].x) / 2
              if (Math.abs(c - dg.x) < bd) { bd = Math.abs(c - dg.x); best = k }
            }
            if (best < 0 || bd > 3 * sp) continue
            const group = ++tupletId
            for (const e of same.slice(best, best + n)) { e.dur = (e.dur * m) / n; e.scaled = true; e.tup = { n, m, group } }
          }

          // voices: one unless two different events share an x column (e.g. a rest above a half note).
          // Then: a note goes by stem direction, a rest takes the other voice, and a lone event continues the voice that is free first.
          const main = events.filter((e) => !e.grace)
          const colTol = 1.1 * (hs[0]?.g.w ?? 8.3)
          const columns: Event[][] = []
          for (const e of main) {
            const c = columns[columns.length - 1]
            if (c && e.x - c[0].x < colTol) c.push(e)
            else columns.push([e])
          }
          const multi = columns.some((c) => c.length > 1)
          const voiceAt = new Map<Event, number>()
          if (multi) {
            const cur = [0, 0]
            for (const c of columns) {
              if (c.length === 1) {
                const e = c[0]
                voiceAt.set(e, cur[0] === cur[1] ? (e.heads.length && e.dir === 'down' ? 1 : 0) : cur[0] < cur[1] ? 0 : 1)
              } else {
                const noted = c.filter((e) => e.heads.length)
                const resting = c.filter((e) => !e.heads.length)
                noted.sort((p, q) => (p.dir === 'down' ? 1 : 0) - (q.dir === 'down' ? 1 : 0)) // up-stems first
                noted.forEach((e, i) => voiceAt.set(e, noted.length === 1 ? (e.dir === 'down' ? 1 : 0) : Math.min(i, 1)))
                const taken = new Set(noted.map((e) => voiceAt.get(e)))
                resting.forEach((e) => voiceAt.set(e, taken.has(0) && !taken.has(1) ? 1 : !taken.has(0) ? 0 : (e.y > (st.top + st.bottom) / 2 ? 0 : 1)))
              }
              for (const e of c) cur[voiceAt.get(e)!] += e.dur
            }
          }
          const voiceOf = (e: Event) => voiceAt.get(e) ?? 0
          const cursor = [0, 0]
          const arpOf = (e: Event, sp: number): 'up' | 'down' | 'plain' | undefined => { // a wiggle just left of a chord, spanning it (arrow tells the direction)
            if (e.heads.length < 2) return undefined
            const lo = Math.min(...e.heads.map((h) => h.g.y)), hi = Math.max(...e.heads.map((h) => h.g.y)), left = Math.min(...e.heads.map((h) => h.g.x))
            const near = (g: Glyph) => g.x < left + 0.5 * sp && g.x > left - 3.5 * sp && g.y > lo - 1.5 * sp && g.y < hi + 2.5 * sp
            if (!music.some((g) => g.code === 0xf160 && near(g))) return undefined
            return music.some((g) => g.code === 0xf162 && near(g)) ? 'down' : music.some((g) => g.code === 0xf161 && near(g)) ? 'up' : 'plain'
          }
          const clef = clefAt(si, x0 + 2) ?? clefAt(si, 1e9)
          const base = clef ? clef.base : CLEF_BASE[TREBLE]
          const measureAcc = new Map<number, number>() // diatonic index -> alteration, until the barline
          const mod7 = (d: number) => ((d % 7) + 7) % 7
          let graceStack: Event[] = []
          const sums = [0, 0]
          const written: Written[][] = [[], []]
          const alterAt = (d: number) => measureAcc.get(d) ?? keyAlter.get(si)?.get(mod7(d)) ?? 0
          for (const e of events) {
            const v = voiceOf(e)
            if (e.grace) { graceStack.push(e); continue }
            // pitches (accidentals earlier in the bar carry on)
            for (const h of e.heads) {
              const cl = clefAt(si, h.g.x) ?? clef
              h.d = (cl ? cl.base : base) + h.step + ottavaAt(si, h.g.x)
              if (h.acc !== undefined) measureAcc.set(h.d, h.acc)
            }
            const spell = (h: Head) => ({ step: 'CDEFGAB'[mod7(h.d!)], alter: alterAt(h.d!), octave: Math.floor(h.d! / 7) })
            // grace notes waiting before this event
            const graces: Written['pitches'] = []
            for (const ge of graceStack) {
              for (const h of ge.heads) {
                const cl = clefAt(si, h.g.x) ?? clef
                h.d = (cl ? cl.base : base) + h.step + ottavaAt(si, h.g.x)
                if (h.acc !== undefined) measureAcc.set(h.d, h.acc)
                graces.push(spell(h))
              }
            }
            graceStack = []
            const rank = (p: { step: string; octave: number }) => p.octave * 7 + 'CDEFGAB'.indexOf(p.step)
            written[v].push({
              ticks: Math.round(e.dur * 960),
              pitches: e.heads.map(spell).sort((p, q) => rank(p) - rank(q)),
              tie: e.heads.some((h) => h.tie) || undefined,
              orn: e.heads.find((h) => h.orn)?.orn,
              trem: e.heads.find((h) => h.trem)?.trem,
              arp: arpOf(e, st.sp),
              graces: graces.length ? graces : undefined,
              art: [...new Set(e.heads.flatMap((h) => h.art ?? []))].length ? [...new Set(e.heads.flatMap((h) => h.art ?? []))] : undefined,
              vel: velAt(e.x, levelBefore),
              tup: e.tup,
            })
            cursor[v] += e.dur
            sums[v] += e.dur
          }
          const voicesOut = written.filter((w) => w.length)
          if (voicesOut.length) {
            for (const w of voicesOut) { // a voice that stops early (hidden rest): pad with silence at the end
              const sum = w.reduce((a, x) => a + x.ticks, 0), need = Math.round(barLen * 960) - sum
              if (need > 0) w.push({ ticks: need, pitches: [], hidden: true }) // printed scores leave these rests out
            }
            writtenOut.push({ staff: si - sys[0], hand: handOf(si), voices: voicesOut })
          }
          const filled = sums.filter((x) => x > 0)
          const ok = filled.length > 1
            ? filled.every((x) => x <= barLen + 1e-6) && Math.abs(Math.max(...filled) - barLen) < 1e-6
            : Math.abs(sums[0] - barLen) < 1e-6
          if (!ok) suspect = (suspect ? suspect + '; ' : '') + `staff ${si + 1}: rhythm adds up to ${filled.map((x) => +x.toFixed(3)).join('+')} of ${barLen} beats`
        }
        if (!hasContent) {
          // a multi-measure rest: a thick bar with the number of bars above the staff
          const st0 = staves[sys[0]]
          if (music.some((g) => g.code === 0xf180 && g.x > x0 && g.x < x1 && sys.includes(staffOf(staves, g.y)))) {
            const digits = p.glyphs.filter((g) => ((g.code >= 0xf030 && g.code <= 0xf039) || (g.code >= 0x30 && g.code <= 0x39)) && g.x > x0 && g.x < x1 && g.y > st0.top + 0.8 * st0.sp && g.y < st0.top + 8 * st0.sp).sort((a, b) => a.x - b.x)
            const n = Math.min(500, Math.max(1, digits.length ? +digits.map((g) => (g.code >= 0xf030 ? g.code - 0xf030 : g.code - 0x30)).join('') : 1))
            for (let k = 0; k < n; k++) {
              navEntry.geoms.push({ x0, x1, top: staves[sys[0]].top, bottom: staves[sys[sys.length - 1]].bottom, sp: staves[sys[0]].sp })
              measures.push({ index: measures.length + 1, length: barLen, beat: clickStep(beats, unit), notes: [], startRepeat: k === 0 && (startRepeat || pendingStartRepeat), endRepeat: k === n - 1 && endRepeat, written: [] })
            }
            pendingStartRepeat = false
            continue
          }
          if (startRepeat) pendingStartRepeat = true
          continue
        }
        const fifthsOf = (si: number) => [...(keyAlter.get(si)?.values() ?? [])].reduce((a, v) => a + Math.sign(v), 0)
        const measureNotes: ScoreNote[] = writtenOut.flatMap((w) => w.voices.flatMap((vv) => realizeVoice(vv, fifthsOf(sys[w.staff]), w.hand ?? w.staff)))
        navEntry.geoms.push({ x0, x1, top: staves[sys[0]].top, bottom: staves[sys[sys.length - 1]].bottom, sp: staves[sys[0]].sp })
        measures.push({ index: measures.length + 1, length: barLen, beat: clickStep(beats, unit), notes: measureNotes.sort((a, b) => a.start - b.start || a.pitch - b.pitch), startRepeat: startRepeat || pendingStartRepeat, endRepeat, suspect, written: writtenOut })
        pendingStartRepeat = false
      }
      if (dynMarks.length) level = dynMarks[dynMarks.length - 1].vel
    }
  }

  for (const { p, geoms, start } of navPages) {
    readNavigation(p, geoms).forEach((n, k) => {
      const m = measures[start + k]
      if (m && n.volta) m.volta = n.volta
      if (m && n.fine) m.fine = true
      if (m && n.toCoda) m.toCoda = true
      if (m && n.jump) m.jump = n.jump
    })
  }
  // tempo markings (♩ = 93, also a dotted quarter): each one holds from its bar on, until the next
  const marks: { bar: number; bpm: number }[] = []
  for (const { p, geoms, start } of navPages) {
    for (const t of tempoMarks(p)) {
      const k = geoms.findIndex((g) => t.x >= g.x0 - 2 && t.x < g.x1 && t.y >= g.top - 1 && t.y <= g.top + 14 * g.sp)
      if (k >= 0 && measures[start + k]) marks.push({ bar: start + k, bpm: t.bpm })
    }
  }
  if (marks.length) {
    marks.sort((a, b) => a.bar - b.bar)
    let cur = marks[0].bpm
    measures.forEach((m, i) => { const mk = marks.find((q) => q.bar === i); if (mk) cur = mk.bpm; m.tempo = i === 0 && !mk ? marks[0].bpm : cur })
  }
  if (!timeSigSeen) warnings.push('no time signature found: assuming 4/4')
  for (const [code, n] of unknown) warnings.push(`unrecognised music symbol U+${code.toString(16).toUpperCase()} (${n}×): ignored`)
  return { measures, beatsPerBar: beats0, beatUnit: unit0, warnings, keyFifths, clefs: firstClefs, tempo: readTempo(rawPages[0]) }
}

/** "♩ = 93" at the top of the first page (SMuFL metronome note, then digits on the same line). Only quarter-note marks are trusted. */
function readTempo(p?: PagePrims): number | undefined {
  if (!p) return undefined
  const note = p.glyphs.find((g) => g.code === 0xeca5 || g.code === 0xe1d5) // metNoteQuarterUp / noteQuarterUp
  if (!note) return undefined
  const digits = p.glyphs.filter((g) => g.code >= 0x30 && g.code <= 0x39 && Math.abs(g.y - note.y) < 4 && g.x > note.x && g.x < note.x + 90).sort((a, b) => a.x - b.x)
  const v = digits.length ? Number(digits.map((g) => String.fromCharCode(g.code)).join('')) : NaN
  return v >= 20 && v <= 400 ? v : undefined
}

/** Every "♩ = 93" / "♩. = 60" marking of a page, in quarter notes per minute. */
function tempoMarks(p: PagePrims): { x: number; y: number; bpm: number }[] {
  const out: { x: number; y: number; bpm: number }[] = []
  for (const note of p.glyphs.filter((g) => g.code === 0xeca5 || g.code === 0xe1d5)) {
    const dotted = p.glyphs.some((g) => g.code === 0xf0aa && Math.abs(g.x - (note.x + note.w)) < 0.6 * note.size && Math.abs(g.y - note.y) < 1.5 * note.size)
    const digits = p.glyphs.filter((g) => g.code >= 0x30 && g.code <= 0x39 && Math.abs(g.y - note.y) < 4 && g.x > note.x && g.x < note.x + 90).sort((a, b) => a.x - b.x)
    const v = digits.length ? Number(digits.map((g) => String.fromCharCode(g.code)).join('')) : NaN
    if (v >= 20 && v <= 400) out.push({ x: note.x, y: note.y, bpm: dotted ? v * 1.5 : v })
  }
  return out
}
