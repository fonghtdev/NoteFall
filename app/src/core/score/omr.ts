// Reads engraved (vector) sheet music: PagePrims -> measures of notes.
// Deterministic geometry, not machine learning: noteheads/clefs/accidentals are music-font glyphs, staves/stems/bars are lines.
// Glyph codes follow the Sonata/Maestro layout; codes marked "unverified" are absent from the sample PDF and rely on the bar-length check.
import type { Glyph, PagePrims, Poly, Seg } from './primitives'
import { readNavigation, type BarGeom } from './navigation'
import { realizeVoice } from './realize'

// ---- glyph vocabulary -------------------------------------------------------------------------------------
const TREBLE = 0xf026, BASS = 0xf03f
const NOTE_FILLED = 0xf0cf, NOTE_HOLLOW = 0xf0fa, SLUR = 0xf0d1
const ACC: Record<number, number> = { 0xf023: 1, 0xf06e: 0, 0xf062: -1 } // sharp, natural, flat
const DOT = 0xf0aa
const REST: Record<number, number> = { 0xf0ce: 1, 0xf0ee: 2, 0xf0b7: 4, 0xf0e4: 0.5, 0xf0c5: 0.25 } // quarter (verified); half/whole/8th/16th unverified
const FLAG: Record<number, number> = { 0xf06a: 1 }
const ORNAMENT: Record<number, 'mordent' | 'inverted'> = { 0xf04d: 'mordent', 0xf06d: 'inverted' } // zigzag with / without a vertical stroke
const IGNORED = new Set([0xf055, 0xf075]) // fermatas: shown, not played
const CLEF_BASE: Record<number, number> = { [TREBLE]: 4 * 7 + 2, [BASS]: 2 * 7 + 4 } // diatonic index of the bottom line: E4, G2
const SEMI = [0, 2, 4, 5, 7, 9, 11] // C D E F G A B

export interface ScoreNote { pitch: number; start: number; duration: number; staff: number; tieNext?: boolean; velocity?: number } // start/duration in quarter notes, relative to the measure; staff 0 = upper
/** One written event, as the editor wants it (no ornament expansion, rests kept). */
export interface Written { hidden?: boolean; ticks: number; pitches: { step: string; alter: number; octave: number }[]; tie?: boolean; orn?: 'mordent' | 'inverted'; graces?: { step: string; alter: number; octave: number }[] }
export interface Measure {
  index: number          // 1-based, in reading order
  length: number        // quarter notes the time signature promises
  notes: ScoreNote[]
  startRepeat: boolean
  endRepeat: boolean
  suspect?: string       // set when the rhythm does not add up to `length`
  tempo?: number         // quarter notes per minute in force at this bar (composer scores; absent = the score's single tempo)
  written?: { staff: number; voices: Written[][] }[] // notation view of the same bar, for editing
  // navigation (set by the composer / MusicXML, not read from PDFs yet)
  volta?: number[]       // this bar is inside an ending bracket for these passes (1st, 2nd ending…)
  segno?: boolean        // the bar where a D.S. jumps to
  coda?: boolean         // the bar a "to Coda" jump lands on
  toCoda?: boolean       // after a D.C./D.S. al Coda, playing this bar continues at the Coda
  fine?: boolean         // after a D.C./D.S. al Fine, playing this bar ends the piece
  jump?: { kind: 'dc' | 'ds'; al: 'end' | 'fine' | 'coda' } // at the end of this bar go back to the start / the segno
}
export interface Score { measures: Measure[]; beatsPerBar: number; beatUnit: number; warnings: string[]; title?: string; keyFifths?: number; clefs?: ('treble' | 'bass')[] }

type VSeg = Seg & { lo: number; hi: number }
interface Staff { bottom: number; sp: number; top: number; x0: number; x1: number }
interface Head {
  g: Glyph; staff: number; step: number; hollow: boolean; grace: boolean
  stem?: VSeg; dir?: 'up' | 'down'; dots: number; acc?: number; pitch?: number; tie?: boolean; d?: number; orn?: 'mordent' | 'inverted'
}
interface Event { x: number; heads: Head[]; rest?: Glyph; dur: number; dir?: 'up' | 'down'; grace: boolean; y: number }

const isMusic = (g: Glyph) => g.code >= 0xf000 && g.code <= 0xf0ff

// ---- staves --------------------------------------------------------------------------------------------------
function findStaves(p: PagePrims): Staff[] {
  const ys: { y: number; x0: number; x1: number }[] = []
  for (const s of p.segs) {
    if (Math.abs(s.y1 - s.y2) < 0.01 && Math.abs(s.x2 - s.x1) > 100 && !ys.some((l) => Math.abs(l.y - s.y1) < 0.05 && Math.abs(l.x0 - Math.min(s.x1, s.x2)) < 1)) {
      ys.push({ y: s.y1, x0: Math.min(s.x1, s.x2), x1: Math.max(s.x1, s.x2) })
    }
  }
  ys.sort((a, b) => b.y - a.y)
  const staves: Staff[] = []
  for (let i = 0; i + 4 < ys.length;) {
    const run = ys.slice(i, i + 5), gap = run[0].y - run[1].y
    if (gap > 2 && run.every((l, k) => k === 0 || Math.abs(run[k - 1].y - l.y - gap) < gap * 0.08)) {
      staves.push({ top: run[0].y, bottom: run[4].y, sp: (run[0].y - run[4].y) / 4, x0: Math.min(...run.map((l) => l.x0)), x1: Math.max(...run.map((l) => l.x1)) })
      i += 5
    } else i++
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
export function readScore(pages: PagePrims[]): Score {
  const warnings: string[] = []
  const measures: Measure[] = []
  let beats = 4, unit = 4
  const unknown = new Map<number, number>()
  const navPages: { p: PagePrims; geoms: BarGeom[]; start: number }[] = []
  let keyFifths: number | undefined
  let firstClefs: ('treble' | 'bass')[] | undefined
  let timeSigSeen = false
  let pendingStartRepeat = false

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
        [NOTE_FILLED, NOTE_HOLLOW, SLUR, DOT].includes(g.code) || (g.code >= 0xf030 && g.code <= 0xf039)
      if (!known) unknown.set(g.code, (unknown.get(g.code) ?? 0) + 1)
    }
    const heads: Head[] = []
    const clefs: { g: Glyph; staff: number }[] = []
    const rests: { g: Glyph; staff: number; dur: number }[] = []
    for (const g of music) {
      const si = staffOf(staves, g.y)
      if (si < 0) continue
      if (g.code === NOTE_FILLED || g.code === NOTE_HOLLOW) {
        const st = staves[si], raw = (g.y - st.bottom) / (st.sp / 2)
        const grace = g.size < 0.8 * 4 * st.sp // cue-size notehead
        heads.push({ g, staff: si, step: Math.round(raw), hollow: g.code === NOTE_HOLLOW, grace, dots: 0 })
        if (!grace && Math.abs(raw - Math.round(raw)) > 0.2) warnings.push(`p${pi + 1}: notehead off the staff grid at x=${g.x.toFixed(0)}`)
      } else if (g.code in CLEF_BASE) clefs.push({ g, staff: si })
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

      // key signature per staff: accidentals before the first head that are not attached to one
      const keyAlter = new Map<number, Map<number, number>>() // staff -> diatonic letter -> alteration
      for (const si of sys) {
        const first = Math.min(...heads.filter((h) => h.staff === si).map((h) => h.g.x), Infinity)
        const m = new Map<number, number>()
        for (const a of accs) {
          if (attachedAcc.has(a) || staffOf(staves, a.y) !== si || a.x >= first || a.x < staves[si].x0) continue
          const clef = clefAt(si, a.x)
          if (!clef) continue
          const d = CLEF_BASE[clef.g.code] + Math.round((a.y - staves[si].bottom) / (staves[si].sp / 2))
          m.set(((d % 7) + 7) % 7, ACC[a.code])
        }
        keyAlter.set(si, m)
      }
      if (keyFifths === undefined) {
        const top = keyAlter.get(sys[0])!
        keyFifths = [...top.values()].reduce((a, v) => a + Math.sign(v), 0)
        firstClefs = sys.map((si) => (clefAt(si, 1e9)?.g.code === BASS ? 'bass' : 'treble'))
      }

      // time signature digits (before the first head of the system)
      const tsGlyphs = music.filter((g) => g.code >= 0xf030 && g.code <= 0xf039 && sys.includes(staffOf(staves, g.y)))
      if (tsGlyphs.length) {
        const st = staves[sys[0]], mid = (st.top + st.bottom) / 2
        const num = (arr: Glyph[]) => +arr.sort((a, b) => a.x - b.x).map((g) => g.code - 0xf030).join('')
        const top = tsGlyphs.filter((g) => staffOf(staves, g.y) === sys[0] && g.y > mid), bot = tsGlyphs.filter((g) => staffOf(staves, g.y) === sys[0] && g.y <= mid)
        if (top.length && bot.length) { beats = num(top); unit = num(bot); timeSigSeen = true }
      }
      const barLen = (beats * 4) / unit

      for (let bi = 0; bi + 1 < bars.length; bi++) {
        const left = bars[bi], right = bars[bi + 1]
        const x0 = left.hi, x1 = right.lo
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
          for (const r of rs) events.push({ x: r.g.x, heads: [], rest: r.g, dur: r.dur, grace: false, y: r.g.y })
          events.sort((a, b) => a.x - b.x)

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
          const clef = clefAt(si, x0 + 2) ?? clefAt(si, 1e9)
          const base = clef ? CLEF_BASE[clef.g.code] : CLEF_BASE[TREBLE]
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
              h.d = (cl ? CLEF_BASE[cl.g.code] : base) + h.step
              if (h.acc !== undefined) measureAcc.set(h.d, h.acc)
            }
            const spell = (h: Head) => ({ step: 'CDEFGAB'[mod7(h.d!)], alter: alterAt(h.d!), octave: Math.floor(h.d! / 7) })
            // grace notes waiting before this event
            const graces: Written['pitches'] = []
            for (const ge of graceStack) {
              for (const h of ge.heads) {
                const cl = clefAt(si, h.g.x) ?? clef
                h.d = (cl ? CLEF_BASE[cl.g.code] : base) + h.step
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
              graces: graces.length ? graces : undefined,
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
            writtenOut.push({ staff: si - sys[0], voices: voicesOut })
          }
          const filled = sums.filter((x) => x > 0)
          const ok = filled.length > 1
            ? filled.every((x) => x <= barLen + 1e-6) && Math.abs(Math.max(...filled) - barLen) < 1e-6
            : Math.abs(sums[0] - barLen) < 1e-6
          if (!ok) suspect = (suspect ? suspect + '; ' : '') + `staff ${si + 1}: rhythm adds up to ${filled.map((x) => +x.toFixed(3)).join('+')} of ${barLen} beats`
        }
        if (!hasContent) {
          if (startRepeat) pendingStartRepeat = true
          continue
        }
        const fifthsOf = (si: number) => [...(keyAlter.get(si)?.values() ?? [])].reduce((a, v) => a + Math.sign(v), 0)
        const measureNotes: ScoreNote[] = writtenOut.flatMap((w) => w.voices.flatMap((vv) => realizeVoice(vv, fifthsOf(sys[w.staff]), w.staff)))
        navEntry.geoms.push({ x0, x1, top: staves[sys[0]].top, bottom: staves[sys[sys.length - 1]].bottom, sp: staves[sys[0]].sp })
        measures.push({ index: measures.length + 1, length: barLen, notes: measureNotes.sort((a, b) => a.start - b.start || a.pitch - b.pitch), startRepeat: startRepeat || pendingStartRepeat, endRepeat, suspect, written: writtenOut })
        pendingStartRepeat = false
      }
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
  if (!timeSigSeen) warnings.push('no time signature found: assuming 4/4')
  for (const [code, n] of unknown) warnings.push(`unrecognised music symbol U+${code.toString(16).toUpperCase()} (${n}×): ignored`)
  return { measures, beatsPerBar: beats, beatUnit: unit, warnings, keyFifths, clefs: firstClefs }
}
