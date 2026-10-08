import { Accidental, Articulation, Barline, Beam, Curve, Dot, Formatter, Fraction, GhostNote, GraceNote, GraceNoteGroup, Modifier, Ornament, Renderer, Stave, StaveConnector, StaveNote, TickContext, StaveTie, Stroke, Tremolo, Tuplet, Voice, Volta } from 'vexflow/bravura'
import { NATURAL, forceFor, gapWidth, gapsOf, leadOf, type Col, type Gap } from './spacing'
import { CLEFS, barTicks, clefAt, contextAt, diatonic, midiOf, nominalTicks, notationOf, ottavaShifts, starts, type Art, type ClefName, type Ev, type Pitch, type Score } from './model'

/** One drawn event, for hit-testing and selection. */
export interface DrawnEv { id: number; m: number; staff: number; voice: number; at: number; ticks: number; x: number; rest: boolean; ys: number[]; left: number; right: number }
export interface DrawnStaff { top: number; bottom: number; spacing: number; clef: ClefName }
export interface DrawnMeasure { m: number; x: number; w: number; system: number; staves: DrawnStaff[]; evs: DrawnEv[]; notes?: [number, number] } // notes: where the notes may stand, after the clef / key / time
export interface Layout { width: number; height: number; measures: DrawnMeasure[]; systems: { y0: number; y1: number; pageBreakAfter?: boolean }[]; graces: { id: number; i: number; x: number; y: number }[] }

/** Which notes of a chord a tie joins to the next chord: [index here, index there] for every pitch both have (same sounding pitch). */
export const tiePairs = (a: Pitch[], b: Pitch[]): [number, number][] =>
  a.flatMap((p, i) => { const j = b.findIndex((q) => midiOf(q) === midiOf(p)); return j < 0 ? [] : [[i, j] as [number, number]] })

const FIFTHS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
export const keyName = (fifths: number) => FIFTHS[fifths + 7]

const L = { p: '\uE520', m: '\uE521', f: '\uE522', r: '\uE523', s: '\uE524', z: '\uE525' } // SMuFL dynamic letters
export const DYN_GLYPH: Record<string, string> = {
  pppp: L.p + L.p + L.p + L.p, ppp: L.p + L.p + L.p, pp: L.p + L.p, p: L.p, mp: L.m + L.p, mf: L.m + L.f, f: L.f, ff: L.f + L.f, fff: L.f + L.f + L.f, ffff: L.f + L.f + L.f + L.f,
  sf: L.s + L.f, sfz: L.s + L.f + L.z, fp: L.f + L.p, sfp: L.s + L.f + L.p, rfz: L.r + L.f + L.z,
}

const MARGIN = 20, STAFF_GAP = 105, SYSTEM_GAP = 60, STAFF_H = 80, TOP_SPACE = 40, TITLE_H = 100

const pitchKey = (p: { step: string; alter: number; octave: number }, shift = 0) =>
  `${p.step.toLowerCase()}${p.alter > 0 ? '#'.repeat(p.alter) : p.alter < 0 ? 'b'.repeat(-p.alter) : ''}/${p.octave + shift}`

/** Where a tick of a bar stands on the page (between the columns of notes, as far along as the time has gone). With `end` (the bar's length in ticks, and the page position the bar runs on to) the last note does not stop where it stands but moves on, so a bar moving along does not jump. */
export function xAtTick(dm: DrawnMeasure, at: number, end?: { at: number; x: number }): number {
  const cols = columnsOf(dm)
  if (end) cols.push(end)
  if (at <= cols[0].at) return cols[0].x
  for (let i = 1; i < cols.length; i++) if (at <= cols[i].at) { const a = cols[i - 1], b = cols[i]; return a.x + ((b.x - a.x) * (at - a.at)) / (b.at - a.at || 1) }
  return cols[cols.length - 1].x
}
/** The other way round: which tick of a bar is at page position x (snapped to an eighth of a beat, or to a note when one is near). */
export function tickAtX(dm: DrawnMeasure, x: number, barTicks: number): number {
  const cols = columnsOf(dm)
  let at = 0
  if (x >= cols[cols.length - 1].x) at = cols[cols.length - 1].at
  else for (let i = 1; i < cols.length; i++) if (x <= cols[i].x) { const a = cols[i - 1], b = cols[i]; at = a.at + ((b.at - a.at) * (x - a.x)) / (b.x - a.x || 1); break }
  const near = cols.find((c) => Math.abs(c.x - x) < 7)
  if (near) return near.at
  return Math.max(0, Math.min(barTicks - 1, Math.round(at / 120) * 120))
}
function columnsOf(dm: DrawnMeasure): { at: number; x: number }[] {
  const seen = new Map<number, number>()
  for (const e of dm.evs) if (!seen.has(e.at)) seen.set(e.at, e.x)
  const cols = [...seen.entries()].map(([at, x]) => ({ at, x })).sort((a, b) => a.at - b.at)
  if (!cols.length) cols.push({ at: 0, x: dm.x + 20 })
  return cols
}

/** How far a note reaches to the right (head, displaced head, dots) and to the left (accidentals, grace notes) of its own position. */
function reach(note: StaveNote | GhostNote): { left: number; right: number; grace: number } {
  if (!(note instanceof StaveNote)) return { left: 0, right: 0, grace: 0 }
  const mods = note.getModifiers()
  const graces = mods.filter((m): m is GraceNoteGroup => m instanceof GraceNoteGroup).reduce((w, g) => (g.preFormat(), w + g.getWidth() + 4), 0) // (4: VexFlow's gap between the group and its note)
  const accs = mods.filter((m) => m instanceof Accidental).length, dots = mods.filter((m) => m instanceof Dot).length
  const displaced = note.noteHeads.some((h) => h.isDisplaced())
  // ledger lines run past the head on both sides, and two neighbours with ledger lines would fuse into one long line
  const ledger = note.getKeyProps().some((k) => k.line < 1 || k.line > 5) ? 4 : 0
  return { grace: graces, left: accs * 9 + ledger, right: 11 + (displaced ? 11 : 0) + (dots ? 5 + 5 * dots : 0) + ledger }
}

/** All the ink of a note to its left and right, grace notes included. */
const ink = (note: StaveNote | GhostNote) => { const r = reach(note); return { left: r.left + r.grace, right: r.right } }

/** The only thing in the bar for its voice and no other voice has music: a whole-bar rest stays centred. */
const wholeBarSolo = (vs: Ev[][], ev: Ev) => vs.every((o) => o.every((e) => e === ev || !e.pitches.length)) && vs[0]?.length === 1

interface Built { notes: Map<number, StaveNote | GhostNote>; graces: Map<number, GraceNote[]>; voices: Voice[]; beams: Beam[]; tuplets: Tuplet[]; order: { ev: Ev; voice: number; staff: number; at: number }[] }

function build(score: Score, mi: number, staves: Stave[], selected: Set<number>, shifts: Map<number, number> = new Map(), grace?: GraceRef): Built {
  const { time, key } = contextAt(score, mi)
  const m = score.measures[mi]
  const bar = barTicks(time)
  const out: Built = { notes: new Map(), graces: new Map(), voices: [], beams: [], tuplets: [], order: [] }
  const groups = time.unit === 8 && time.beats % 3 === 0 ? new Fraction(3, 8) : new Fraction(1, 4)

  m.staves.forEach((vs, si) => {
    const cd = CLEFS[clefAt(score, mi, si)], clef = cd.vf
    const multi = vs.length > 1
    // As in MuseScore, a note's stem goes up (voice 1) or down (the others) only when another voice has a note sounding at the same time;
    // a note alone at its moment (another voice resting, or a stray note elsewhere in the bar, common in a misread scan) points its stem as a single voice would.
    const vStarts = vs.map(starts)
    const together = (vi: number, at: number, len: number) => vs.some((o, ov) => ov !== vi && o.some((e, k) => e.pitches.length > 0 && vStarts[ov][k] < at + len && vStarts[ov][k] + e.ticks > at))
    const staffVoices: Voice[] = []
    vs.forEach((events, vi) => {
      const tickables: (StaveNote | GhostNote)[] = []
      const ts = vStarts[vi], dir = vi === 0 ? 1 : -1
      const held = new Set<StaveNote>() // notes whose stem direction is fixed by a voice sounding with them
      events.forEach((ev, ei) => {
        const nt = notationOf(nominalTicks(ev)) ?? { name: 'q', dots: 0 }
        const rest = ev.pitches.length === 0
        if (rest && ev.hidden) { // keeps the time, draws nothing
          const g = new GhostNote({ duration: nt.name, dots: nt.dots })
          g.setStave(staves[si])
          out.notes.set(ev.id, g)
          out.order.push({ ev, voice: vi, staff: si, at: ts[ei] })
          tickables.push(g)
          return
        }
        const wholeBar = rest && ev.ticks === bar && vs.length === 1
        let restKey = clef === 'treble' ? (vi ? 'g/4' : 'b/4') : clef === 'bass' ? (vi ? 'f/2' : 'd/3') : vi ? 'a/3' : 'c/4'
        const sh = cd.shift + (shifts.get(ev.id) ?? 0)
        if (rest && multi) { const r0 = vi === 0 ? cd.bottom + 6 : cd.bottom + 2; restKey = `${'cdefgab'[r0 % 7]}/${Math.floor(r0 / 7)}` } // two voices resting together: the upper one's rest high, the other's low
        if (rest && multi && !wholeBarSolo(vs, ev)) { // with several voices a rest sits clear of the other voices' notes: the upper voice's above them, the others' below
          const others = vs.flatMap((o, ov) => (ov === vi ? [] : o.map((e, k) => ({ e, at: starts(o)[k] })))).filter(({ e, at }) => e.pitches.length && at < ts[ei] + ev.ticks && at + e.ticks > ts[ei])
          const ds = others.flatMap(({ e }) => e.pitches.map((p) => diatonic(p) + 7 * (cd.shift + (shifts.get(e.id) ?? 0))))
          if (ds.length) {
            const d = vi === 0 ? Math.max(...ds) + 3 : Math.min(...ds) - 3
            const r = Math.max(cd.bottom - 4, Math.min(cd.bottom + 12, d))
            restKey = `${'cdefgab'[((r % 7) + 7) % 7]}/${Math.floor(r / 7)}`
          }
        }
        const n = new StaveNote({
          clef,
          keys: rest ? [wholeBar ? (clef === 'treble' ? 'd/5' : clef === 'bass' ? 'f/3' : 'c/4') : restKey] : ev.pitches.map((p) => pitchKey(p, sh)),
          duration: wholeBar ? 'wr' : nt.name + (rest ? 'r' : ''),
          dots: wholeBar ? 0 : nt.dots,
          alignCenter: wholeBar,
          ...(!rest && together(vi, ts[ei], ev.ticks) ? { stemDirection: dir } : { autoStem: true }),
        })
        if (!rest && together(vi, ts[ei], ev.ticks)) held.add(n)
        n.setStave(staves[si])
        if (ev.flip && !rest) n.setStemDirection(n.getStemDirection() === 1 ? -1 : 1)
        if (nt.dots && !wholeBar) Dot.buildAndAttach([n], { all: true })
        if (ev.art?.length && !rest) {
          const CODE: Record<Art, string> = { staccato: 'a.', accent: 'a>', tenuto: 'a-', marcato: 'a^', fermata: 'a@a', staccatissimo: 'av', upbow: 'a|', downbow: 'am' }
          for (const a of ev.art) {
            const art = new Articulation(CODE[a])
            if (a === 'marcato' || a === 'fermata' || a === 'upbow' || a === 'downbow') art.setPosition(Modifier.Position.ABOVE)
            else art.setPosition(n.getStemDirection() === 1 ? Modifier.Position.BELOW : Modifier.Position.ABOVE) // on the notehead side
            n.addModifier(art, 0)
          }
        }
        if (ev.orn && !rest) n.addModifier(new Ornament({ mordent: 'mordent', inverted: 'mordent_inverted', trill: 'tr', turn: 'turn' }[ev.orn]), 0)
        if (ev.arp && ev.pitches.length > 1) n.addModifier(new Stroke(ev.arp === 'up' ? Stroke.Type.ROLL_UP : ev.arp === 'down' ? Stroke.Type.ROLL_DOWN : Stroke.Type.ARPEGGIO_DIRECTIONLESS), 0)
        if (ev.trem && !rest) n.addModifier(new Tremolo(ev.trem), 0)
        if (ev.graces?.length && !rest) {
          const gns = ev.graces.map((g) => new GraceNote({ keys: [pitchKey(g, sh)], duration: '8', clef, slash: ev.graceKind === 'acc' }))
          if (grace?.id === ev.id) gns[grace.i]?.setStyle({ fillStyle: '#1d6fff', strokeStyle: '#1d6fff' })
          n.addModifier(new GraceNoteGroup(gns, true), 0)
          out.graces.set(ev.id, gns)
        }
        if (selected.has(ev.id)) n.setStyle({ fillStyle: '#1d6fff', strokeStyle: '#1d6fff' })
        out.notes.set(ev.id, n)
        out.order.push({ ev, voice: vi, staff: si, at: ts[ei] })
        tickables.push(n)
      })
      const tupGroups = new Map<number, StaveNote[]>()
      events.forEach((ev) => { if (ev.tup) { const n = out.notes.get(ev.id); if (n instanceof StaveNote) tupGroups.set(ev.tup.group, [...(tupGroups.get(ev.tup.group) ?? []), n]) } })
      tupGroups.forEach((notes, g) => {
        const t = events.find((e) => e.tup?.group === g)!.tup!
        out.tuplets.push(new Tuplet(notes, { numNotes: t.n, notesOccupied: t.m, ratioed: false, bracketed: true, location: Tuplet.LOCATION_TOP }))
      })
      const v = new Voice({ numBeats: bar / 960, beatValue: 4 }).setMode(Voice.Mode.SOFT).addTickables(tickables)
      staffVoices.push(v)
      const notes = tickables.filter((t): t is StaveNote => t instanceof StaveNote), sounding = notes.filter((n) => !n.isRest())
      if (sounding.length && sounding.every((n) => held.has(n))) out.beams.push(...Beam.generateBeams(notes, { groups: [groups], stemDirection: dir, maintainStemDirections: true })) // all with another voice: up / down by voice
      else { // free notes: each beam group finds its own direction; a group holding a note that sounds with another voice takes that voice's side
        const flips = events.some((e) => e.flip)
        const beams = Beam.generateBeams(notes, { groups: [groups], maintainStemDirections: flips }).map((bm) => {
          const ns = bm.getNotes() as StaveNote[]
          if (!ns.some((n) => held.has(n))) return bm
          ns.forEach((n) => n.setStemDirection(dir))
          return new Beam(ns)
        })
        const beamed = new Set(beams.flatMap((bm) => bm.getNotes()))
        held.forEach((n) => { if (!beamed.has(n)) n.setStemDirection(dir) }) // (generateBeams sets every note's direction, beamed or not: put back those another voice decides)
        out.beams.push(...beams)
      }
      out.tuplets.forEach((tp) => tp.setTupletLocation(Tuplet.LOCATION_TOP)) // beams move the number to their side; keep it above the staff, clear of dynamics
    })
    Accidental.applyAccidentals(staffVoices, keyName(key))
    out.voices.push(...staffVoices)
  })
  return out
}

export const voltaLabel = (nums: number[]) => {
  const n = [...nums].sort((a, b) => a - b)
  return n.length >= 3 && n[n.length - 1] - n[0] === n.length - 1 ? `${n[0]}.–${n[n.length - 1]}.` : n.map((x) => `${x}.`).join(', ')
}

/** Ending bracket piece for bar `mi`: where the group starts and ends, and whether it is closed (ends in a repeat sign). */
function voltaType(score: Score, mi: number): number | undefined {
  const v = score.measures[mi].volta
  if (!v?.length) return undefined
  const same = (k: number) => JSON.stringify(score.measures[k]?.volta) === JSON.stringify(v)
  const first = !same(mi - 1), last = !same(mi + 1)
  const closed = !!score.measures[mi].endRepeat
  if (first && last) return closed ? Volta.type.BEGIN_END : Volta.type.BEGIN
  if (first) return Volta.type.BEGIN
  if (last) return closed ? Volta.type.END : Volta.type.MID
  return Volta.type.MID
}

const modifierStave = (score: Score, mi: number, first: boolean, x: number, y: number, w: number, si: number): Stave => {
  const ctx = contextAt(score, mi), m = score.measures[mi]
  const st = new Stave(x, y, w)
  const cd = CLEFS[clefAt(score, mi, si)]
  if (first) st.addClef(cd.vf, 'default', cd.ann)
  else if (m.clefs?.[si]) st.addClef(cd.vf, 'small', cd.ann) // a clef change in the middle of a line
  if (first || m.key !== undefined || (mi === 0)) st.addKeySignature(keyName(ctx.key))
  if (mi === 0 || m.time) st.addTimeSignature(ctx.time.symbol === 'common' ? 'C' : ctx.time.symbol === 'cut' ? 'C|' : `${ctx.time.beats}/${ctx.time.unit}`)
  return st
}

/** What a bar asks of the page: room for its clef / key / time, and its columns of notes with the springs between them. */
interface BarSpec { mods: number; lead: number; cols: Col[]; gaps: Gap[] }
const specCache = new Map<string, BarSpec>()
const fontsReady = () => typeof document === 'undefined' || !document.fonts || document.fonts.status === 'loaded'
function barSpec(score: Score, mi: number, first: boolean): BarSpec {
  // the same bar in the same surroundings always asks the same: remember it (editing one bar then costs one bar, not sixty)
  const ctx = contextAt(score, mi)
  const key = JSON.stringify([score.measures[mi], score.clefs.map((_, si) => clefAt(score, mi, si)), ctx.key, ctx.time, first])
  const hit = specCache.get(key)
  if (hit) return hit
  const t0 = performance.now()
  const staves = score.clefs.map((_, si) => modifierStave(score, mi, first, 0, 0, 400, si))
  const mods = Math.max(...staves.map((s) => s.getNoteStartX() - s.getX()))
  const bar = barTicks(ctx.time), b = build(score, mi, staves, new Set())
  const at = new Map<number, Col>()
  for (const o of b.order) {
    if (!o.ev.pitches.length && o.ev.ticks >= bar) continue // a rest for the whole bar sits in the middle, whatever the columns do
    const r = reach(b.notes.get(o.ev.id)!), c = at.get(o.at) ?? { tick: o.at, left: 0, right: 0 }
    c.left = Math.max(c.left, r.left); c.right = Math.max(c.right, r.right); if (r.grace) c.grace = Math.max(c.grace ?? 0, r.grace); at.set(o.at, c)
  }
  const cols = [...at.values()].sort((p, q) => p.tick - q.tick)
  const k = score.measures[mi].stretch ?? 1 // the user's wider / narrower bar
  const spec = { mods, lead: leadOf(cols), cols, gaps: gapsOf(cols, bar).map((g) => ({ ...g, stretch: g.stretch * k })) }
  if (specCache.size > 3000) specCache.clear()
  if (fontsReady()) specCache.set(key, spec) // measured with a stand-in font (Bravura still loading) a grace-note group comes out twice as wide: never remember that
  renderStats.widthMs += performance.now() - t0
  return spec
}
/** Width of a bar when its springs rest at their natural length. */
const naturalWidth = (sp: BarSpec) => sp.mods + sp.lead + sp.gaps.reduce((a, g) => a + gapWidth(g, NATURAL), 0)

/** A mark picked up for moving: a text / dynamic on a note, the tempo or the rehearsal mark of a bar. */
/** A mark that can be picked and dragged; `start`: the beginning of a pedal / ottava line, dragged on its own (without it: the line's end). */
export type MarkRef = { kind: 'ev'; field: 'dyn' | 'staffText' | 'expr' | 'chord' | 'lyric' | 'hairpin' | 'pedal' | 'ottava'; id: number; start?: boolean } | { kind: 'tempo' | 'rehearsal'; bar: number }
/** One grace note: the event it belongs to and its place among that event's grace notes. */
export interface GraceRef { id: number; i: number }
export interface RenderOptions { width: number; selected?: Set<number>; selectedMark?: MarkRef; selectedGrace?: GraceRef }

/** Draw the whole score into `host` (an SVG) and return where things ended up. */
/** How long the last render took, for tuning. */
export const renderStats = { totalMs: 0, widthMs: 0 }

export function renderScore(host: HTMLElement, score: Score, opts: RenderOptions): Layout {
  const t0 = performance.now(); renderStats.widthMs = 0
  const layout = drawScore(host, score, opts)
  renderStats.totalMs = performance.now() - t0
  return layout
}

function drawScore(host: HTMLElement, score: Score, opts: RenderOptions): Layout {
  host.innerHTML = ''
  const selected = opts.selected ?? new Set<number>()
  const isSel = (m: MarkRef) => { const q = opts.selectedMark; return !!q && q.kind === m.kind && ((q.kind === 'ev' && m.kind === 'ev') ? q.id === m.id && q.field === m.field : (q as { bar?: number }).bar === (m as { bar?: number }).bar) }
  const usable = opts.width - 2 * MARGIN
  const n = score.measures.length

  // 1. system breaks: greedy fill on the natural widths (the bar that opens a line carries clef, key and time, so it is measured with them)
  const systems: { from: number; to: number; specs: BarSpec[] }[] = []
  let cur: BarSpec[] = [], sum = 0, from = 0
  for (let mi = 0; mi < n; mi++) {
    let sp = barSpec(score, mi, cur.length === 0)
    if (cur.length && sum + naturalWidth(sp) > usable) {
      // the line is full: break here, unless the bar before is to stay with this one: then the break moves back past every bar tied to its successor
      let cut = cur.length
      while (cut > 1 && score.measures[from + cut - 1].keep) cut--
      const moved = cur.splice(cut)
      systems.push({ from, to: from + cut - 1, specs: cur })
      from += cut; cur = []; sum = 0
      moved.forEach((_, k) => { const m = barSpec(score, from + k, k === 0); cur.push(m); sum += naturalWidth(m) })
      sp = barSpec(score, mi, cur.length === 0)
    }
    cur.push(sp)
    sum += naturalWidth(sp)
    if (score.measures[mi].break && mi < n - 1) { systems.push({ from, to: mi, specs: cur }); cur = []; sum = 0; from = mi + 1 } // the user asked for a new line here
  }
  if (cur.length) systems.push({ from, to: n - 1, specs: cur })

  // 2. draw
  const gapOf = (sys: { from: number; to: number }) => STAFF_GAP + (score.clefs.length > 1 ? score.measures.slice(sys.from, sys.to + 1).find((m) => m.staffGap !== undefined)?.staffGap ?? 0 : 0) // the user may have pulled this line's staves apart or together
  const sysH = (sys: { from: number; to: number }) => gapOf(sys) + STAFF_H + TOP_SPACE + SYSTEM_GAP, PAGE_GAP = 70, SECTION_GAP = 30
  const sysY: number[] = [] // top of each system; a page break leaves a visible gap (and starts a new sheet in the PDF)
  { let y = TITLE_H; systems.forEach((sys, i) => { sysY.push(y); y += sysH(sys) + (i < systems.length - 1 ? ({ page: PAGE_GAP, section: SECTION_GAP, system: 0 }[score.measures[sys.to].break ?? 'system'] ?? 0) : 0) }) }
  const height = sysY.length ? sysY[sysY.length - 1] + sysH(systems[systems.length - 1]) + MARGIN : TITLE_H + MARGIN
  const shifts = ottavaShifts(score)
  const r = new Renderer(host as HTMLDivElement, Renderer.Backends.SVG)
  r.resize(opts.width, height)
  const ctx = r.getContext()
  const svg = host.querySelector('svg')!
  svg.setAttribute('viewBox', `0 0 ${opts.width} ${height}`)
  svg.removeAttribute('width'); svg.removeAttribute('height')
  svg.style.width = '100%'; svg.style.height = 'auto'

  const text = (t: string, x: number, y: number, size: number, anchor: string, weight = 'normal') => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    e.textContent = t
    e.setAttribute('x', String(x)); e.setAttribute('y', String(y)); e.setAttribute('font-size', String(size))
    e.setAttribute('text-anchor', anchor); e.setAttribute('font-family', 'Georgia, serif'); e.setAttribute('font-weight', weight)
    svg.appendChild(e)
  }
  text(score.title, opts.width / 2, 36, 26, 'middle', 'bold')
  if (score.composer) text(score.composer, opts.width - MARGIN, 58, 14, 'end')

  const layout: Layout = { width: opts.width, height, measures: [], systems: [], graces: [] }
  const noteOf = new Map<number, { note: StaveNote | GhostNote; system: number }>()
  const where = new Map<number, { m: number; voice: number; index: number }>()

  systems.forEach((sys, sIdx) => {
    const y0 = sysY[sIdx]
    layout.systems.push({ y0: y0 + 5, y1: y0 + gapOf(sys) + TOP_SPACE + STAFF_H + 40, pageBreakAfter: score.measures[sys.to].break === 'page' }) // room for ledger lines above/below
    // one force pulls the springs of the whole line, so equal notes get equal room across bars; every line, the last one and one ended by a break
    // included, reaches the right margin, so all lines are the same length (the user's choice, where MuseScore leaves a short one ragged)
    const target = usable
    const fixed = sys.specs.reduce((a, sp) => a + sp.mods + sp.lead, 0)
    const force = forceFor(sys.specs.flatMap((sp) => sp.gaps), target - fixed)
    let x = MARGIN
    const rowStaves: Stave[][] = []
    sys.specs.forEach((spec, k) => {
      const mi = sys.from + k
      const w = spec.mods + spec.lead + spec.gaps.reduce((a, g) => a + gapWidth(g, force), 0)
      const staves = score.clefs.map((_, si) => modifierStave(score, mi, k === 0, x, y0 + si * gapOf(sys), w, si))
      const m = score.measures[mi]
      const vt = voltaType(score, mi)
      staves.forEach((st, si) => {
        if (vt !== undefined && si === 0) {
          const firstOfGroup = JSON.stringify(score.measures[mi - 1]?.volta) !== JSON.stringify(m.volta)
          st.setVoltaType(vt, firstOfGroup || k === 0 ? voltaLabel(m.volta!) : '', 24)
        }
        if (m.startRepeat) st.setBegBarType(Barline.type.REPEAT_BEGIN)
        if (m.endRepeat) st.setEndBarType(Barline.type.REPEAT_END)
        else if (m.barline === 'double') st.setEndBarType(Barline.type.DOUBLE)
        else if (m.barline === 'final') st.setEndBarType(Barline.type.END)
        else if (m.barline === 'none' || m.barline === 'dashed' || m.barline === 'dotted') st.setEndBarType(Barline.type.NONE)
        else if (m.break === 'section') st.setEndBarType(Barline.type.DOUBLE)
        else if (mi === n - 1) st.setEndBarType(Barline.type.END)
        st.setContext(ctx).draw()
      })
      rowStaves.push(staves)

      const b = build(score, mi, staves, selected, shifts, opts.selectedGrace)
      const f = new Formatter()
      score.clefs.forEach((_, si) => {
        const vs = b.voices.filter((v) => b.order.find((o) => b.notes.get(o.ev.id) === v.getTickables()[0])?.staff === si)
        if (vs.length) f.joinVoices(vs)
      })
      const noteArea = Math.min(...staves.map((s) => s.getNoteEndX())) - Math.max(...staves.map((s) => s.getNoteStartX())) - 12
      f.format(b.voices, Math.max(40, noteArea))
      // VexFlow has placed the notes; put every column where the springs of the line say (VexFlow's own spacing only decides who shares a column)
      const x0 = Math.max(...staves.map((s) => s.getNoteStartX()))
      const colX = new Map<number, number>()
      { let acc = spec.lead; spec.cols.forEach((c, i) => { colX.set(c.tick, x0 + acc); acc += gapWidth(spec.gaps[i], force) }) }
      const moves = new Map<TickContext, number>()
      const bar = barTicks(contextAt(score, mi).time)
      for (const o of b.order) {
        if (!o.ev.pitches.length && o.ev.ticks >= bar) continue // a rest for the whole bar is centred by VexFlow: its x says nothing about the column
        const note = b.notes.get(o.ev.id)!, tc = note.getTickContext(), want = colX.get(o.at)
        if (want !== undefined && !moves.has(tc)) moves.set(tc, want - (note.getAbsoluteX() - tc.getX()))
      }
      moves.forEach((tx, tc) => tc.setX(tx))
      b.voices.forEach((v) => {
        const first = v.getTickables()[0]
        const o = b.order.find((q) => b.notes.get(q.ev.id) === first)!
        v.draw(ctx, staves[o.staff])
      })
      b.notes.forEach((note, id) => { const g = (note as unknown as { getSVGElement?: () => SVGElement | undefined }).getSVGElement?.(); g?.setAttribute('data-ev', String(id)) }) // lets the page fade a note while it is being dragged
      b.graces.forEach((gns, id) => gns.forEach((gn, i) => { // a pointer near a grace note picks that grace note
        const g = gn.getSVGElement(); g?.setAttribute('data-grace', `${id}:${i}`); g?.setAttribute('style', 'cursor:pointer')
        layout.graces.push({ id, i, x: gn.getAbsoluteX(), y: gn.getYs()[0] }) // where its head is, so a pointer near it picks it (the head itself is a few px wide)
      }))
      b.beams.forEach((bm) => { try { bm.setContext(ctx).draw() } catch (e) { console.warn(`beam skipped in bar ${mi + 1}:`, (e as Error).message) } }) // a beam VexFlow cannot draw (odd rhythms read from a scan) is left out, not the whole page
      b.tuplets.forEach((tp) => tp.setContext(ctx).draw())

      const dm: DrawnMeasure = {
        m: mi, x, w, system: sIdx, notes: [x0, Math.min(...staves.map((s) => s.getNoteEndX()))],
        staves: staves.map((s, si) => ({ top: s.getYForLine(0), bottom: s.getYForLine(4), spacing: s.getSpacingBetweenLines(), clef: clefAt(score, mi, si) })),
        evs: [],
      }
      b.order.forEach((o) => {
        const note = b.notes.get(o.ev.id)!
        dm.evs.push({ id: o.ev.id, m: mi, staff: o.staff, voice: o.voice, at: o.at, ticks: o.ev.ticks, x: note.getAbsoluteX(), rest: o.ev.pitches.length === 0, ys: note instanceof StaveNote ? note.getYs() : [], ...ink(note) })
        noteOf.set(o.ev.id, { note, system: sIdx })
        where.set(o.ev.id, { m: mi, voice: o.voice, index: 0 })
      })
      layout.measures.push(dm)
      x += w
    })

    // brace + connecting lines on the left, and across the staves at every barline
    const left = rowStaves[0]
    new StaveConnector(left[0], left[left.length - 1]).setType('brace').setContext(ctx).draw()
    new StaveConnector(left[0], left[left.length - 1]).setType('singleLeft').setContext(ctx).draw()
    rowStaves.forEach((sts, k) => {
      const m = score.measures[sys.from + k]
      const kind = m.endRepeat ? 'single' : m.barline ?? (sys.from + k === n - 1 ? 'final' : 'single')
      if (kind === 'none' || kind === 'dashed' || kind === 'dotted') {
        if (kind === 'none') return
        const x = layout.measures.find((q) => q.m === sys.from + k)!, xr = x.x + x.w
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        p.setAttribute('d', `M${xr} ${sts[0].getYForLine(0)}V${sts[sts.length - 1].getYForLine(4)}`)
        p.setAttribute('stroke', '#000'); p.setAttribute('stroke-width', '1.3'); p.setAttribute('stroke-dasharray', kind === 'dashed' ? '5 4' : '1.5 3.5')
        svg.appendChild(p)
        return
      }
      new StaveConnector(sts[0], sts[sts.length - 1]).setType(kind === 'double' ? 'thinDouble' : kind === 'final' && !m.endRepeat ? 'boldDoubleRight' : 'singleRight').setContext(ctx).draw()
    })
  })

  // 3. ties (a tie may run into the next bar, or even the next system)
  score.measures.forEach((m, mi) => m.staves.forEach((vs, si) => vs.forEach((events, vi) => events.forEach((ev, ei) => {
    if (!ev.tie || !ev.pitches.length) return
    const next = events[ei + 1] ?? score.measures[mi + 1]?.staves[si]?.[vi]?.[0]
    const a = noteOf.get(ev.id)
    if (!a) return
    const pairs = tiePairs(ev.pitches, next?.pitches ?? []) // a tie joins the same pitch on both sides: chords of other sizes or orders tie only what they share
    const first = pairs.map(([i]) => i), last = pairs.map(([, j]) => j)
    const b = pairs.length ? noteOf.get(next!.id) : undefined
    if (!pairs.length) return
    if (b && b.system === a.system) new StaveTie({ firstNote: a.note, lastNote: b.note, firstIndexes: first, lastIndexes: last }).setContext(ctx).draw()
    else {
      new StaveTie({ firstNote: a.note, lastNote: null, firstIndexes: first, lastIndexes: first }).setContext(ctx).draw()
      if (b) new StaveTie({ firstNote: null, lastNote: b.note, firstIndexes: last, lastIndexes: last }).setContext(ctx).draw()
    }
  }))))

  // 4a. navigation: segno / coda at the start of a bar, D.C. / Fine / To Coda at its end
  layout.measures.forEach((dm) => {
    const m = score.measures[dm.m]
    const top = dm.staves[0].top - (m.volta ? 40 : 18)
    const text = (t: string, x: number, y: number, anchor: string, glyph = false) => {
      const e = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      e.textContent = t
      e.setAttribute('x', String(x)); e.setAttribute('y', String(y)); e.setAttribute('text-anchor', anchor)
      e.setAttribute('font-family', glyph ? 'Bravura, serif' : 'Georgia, serif'); e.setAttribute('font-size', glyph ? '34' : '14')
      if (!glyph) { e.setAttribute('font-style', 'italic'); e.setAttribute('font-weight', 'bold') }
      svg.appendChild(e)
    }
    const startX = (dm.evs[0]?.x ?? dm.x + 30) - 16
    if (m.segno) text('\uE047', startX, top, 'start', true)
    if (m.coda) text('\uE048', m.segno ? startX + 34 : startX, top, 'start', true)
    const right: string[] = []
    if (m.fine) right.push('Fine')
    if (m.toCoda) right.push('To Coda')
    if (m.jump) right.push(`${m.jump.kind === 'dc' ? 'D.C.' : 'D.S.'}${m.jump.al === 'fine' ? ' al Fine' : m.jump.al === 'coda' ? ' al Coda' : ''}`)
    right.forEach((t, i) => text(t, dm.x + dm.w - 6, top - i * 17, 'end'))
  })

  // Anything text-like that is placed next to the notes steps aside from what is already there (notes with their ledger lines and stems, and the texts placed before it),
  // upward for marks above the staff, downward for marks below it: MuseScore calls this autoplace.
  const taken: { x0: number; x1: number; y0: number; y1: number }[] = []
  // (measured from the heads, stem and reach of each note: the boxes the browser reports for music-font glyphs are the font's em, several times taller than the ink)
  noteOf.forEach(({ note }) => {
    if (!(note instanceof StaveNote) || !note.getKeyProps().length || note.isRest()) return
    const ys = note.getYs(), x = note.getAbsoluteX(), r = ink(note)
    let y0 = Math.min(...ys) - 6, y1 = Math.max(...ys) + 6 // head, ledger lines, an articulation dot beside it
    if (note.hasStem()) { const e = note.getStemExtents(); y0 = Math.min(y0, e.topY - 3); y1 = Math.max(y1, e.baseY + 3) }
    taken.push({ x0: x - r.left, x1: x + r.right, y0, y1 })
  })
  const MAX_UP = 64 // px a mark may be pushed up: past that a small overlap is the lesser evil
  const maxDown = (si: number) => (si < score.clefs.length - 1 ? 60 : 110) // below the upper staff the other staff starts; below the last one there is the whole gap to the next line
  /** `ink` is the glyph's real extent above / below its baseline, for music-font glyphs whose box (the font's em) is several times taller than what is drawn. */
  /** Put `el` clear of what is taken; a `fixed` offset is where the user dragged it to, and is kept as it is. */
  const avoid = (el: SVGGraphicsElement, dir: 1 | -1, si: number, ink?: [number, number], fixed?: number) => {
    const bb = el.getBBox()
    const b = ink ? { x: bb.x, width: bb.width, y: +el.getAttribute('y')! - ink[0], height: ink[0] + ink[1] } : bb
    let dy = fixed ?? 0
    for (let k = 0; fixed === undefined && k < 12; k++) {
      const hit = taken.find((o) => o.x0 < b.x + b.width + 1 && o.x1 > b.x - 1 && o.y0 < b.y + dy + b.height && o.y1 > b.y + dy)
      if (!hit) break
      dy = dir > 0 ? hit.y1 + 1 - b.y : hit.y0 - 1 - (b.y + b.height)
    }
    if (fixed === undefined && (dir > 0 ? dy > maxDown(si) : dy < -MAX_UP)) dy = 0
    if (dy) el.setAttribute('transform', `translate(0 ${dy})`)
    taken.push({ x0: b.x, x1: b.x + b.width, y0: b.y + dy, y1: b.y + b.height + dy })
  }

  // 4. dynamics under the staff, hairpins and slurs (may span bars)
  score.measures.forEach((m, mi) => m.staves.forEach((vs, si) => vs.forEach((events) => events.forEach((ev) => {
    const a = noteOf.get(ev.id)
    if (!a) return
    if (ev.dyn) {
      const st = layout.measures[mi].staves[si]
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      t.textContent = DYN_GLYPH[ev.dyn]
      t.setAttribute('x', String(a.note.getAbsoluteX() - 4)); t.setAttribute('y', String(st.bottom + 38))
      t.setAttribute('font-family', 'Bravura, serif'); t.setAttribute('font-size', '30')
      const dm_: MarkRef = { kind: 'ev', field: 'dyn', id: ev.id }
      t.setAttribute('data-mark', JSON.stringify(dm_)); t.setAttribute('style', 'cursor:grab'); t.setAttribute('pointer-events', 'all'); t.setAttribute('stroke', 'transparent'); t.setAttribute('stroke-width', '8')
      if (isSel(dm_)) t.setAttribute('fill', '#1d6fff')
      svg.appendChild(t)
      avoid(t, 1, si, [18, 14], ev.off?.dyn)
    }
    if (ev.hairpin) {
      const b = noteOf.get(ev.hairpin.end)
      if (b) {
        const st = layout.measures[mi].staves[si]
        const sysEnd = Math.max(...layout.measures.filter((q) => q.system === a.system).map((q) => q.x + q.w))
        const x1 = a.note.getAbsoluteX() + 8
        const x2 = b.system === a.system ? b.note.getAbsoluteX() - 2 : sysEnd - 8 // across a system break: stops at the end of the line
        const yc = st.bottom + 30, h = 5
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        p.setAttribute('d', ev.hairpin.type === 'cresc' ? `M${x2} ${yc - h}L${x1} ${yc}L${x2} ${yc + h}` : `M${x1} ${yc - h}L${x2} ${yc}L${x1} ${yc + h}`)
        p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#000'); p.setAttribute('stroke-width', '1.3')
        const dy = ev.off?.hairpin ?? 0, ref: MarkRef = { kind: 'ev', field: 'hairpin', id: ev.id }
        if (dy) p.setAttribute('transform', `translate(0 ${dy})`)
        if (isSel(ref)) p.setAttribute('stroke', '#1d6fff')
        svg.appendChild(p)
        const grab = p.cloneNode() as SVGPathElement // a wedge is too thin to hit: an invisible, wider copy takes the pointer
        grab.setAttribute('stroke', 'transparent'); grab.setAttribute('stroke-width', '10'); grab.setAttribute('pointer-events', 'all'); grab.setAttribute('style', 'cursor:grab')
        grab.setAttribute('data-mark', JSON.stringify(ref))
        svg.appendChild(grab)
      }
    }
    if (ev.slur !== undefined) {
      const b = noteOf.get(ev.slur)
      if (b && b.system === a.system) new Curve(a.note, b.note, { openingDirection: 'auto' }).setContext(ctx).draw()
      else if (b) { // across a system break: a tail at the end of this line and a head on the next
        new Curve(a.note, undefined, { openingDirection: 'auto' }).setContext(ctx).draw()
        new Curve(undefined, b.note, { openingDirection: 'auto' }).setContext(ctx).draw()
      }
    }
  }))))

  // 5. the rest of the palette: texts, tempo, rehearsal marks, ottava, pedal, glissando, breath marks
  const NS = 'http://www.w3.org/2000/svg'
  const put = (t: string, x: number, y: number, o: { size?: number; italic?: boolean; bold?: boolean; font?: string; anchor?: string; mark?: MarkRef; side?: 1 | -1; staff?: number; fixed?: number } = {}) => {
    const e = document.createElementNS(NS, 'text')
    e.textContent = t
    e.setAttribute('x', String(x)); e.setAttribute('y', String(y)); e.setAttribute('text-anchor', o.anchor ?? 'start')
    e.setAttribute('font-family', o.font ?? 'Georgia, serif'); e.setAttribute('font-size', String(o.size ?? 13))
    if (o.italic) e.setAttribute('font-style', 'italic')
    if (o.bold) e.setAttribute('font-weight', 'bold')
    if (o.mark) { // a mark you can pick up: click to select, drag to another note or bar
      e.setAttribute('data-mark', JSON.stringify(o.mark)); e.setAttribute('style', 'cursor:grab'); e.setAttribute('pointer-events', 'all'); e.setAttribute('stroke', 'transparent'); e.setAttribute('stroke-width', '8') // 'all': a click on the text's box counts even though nothing visible is painted there
      if (isSel(o.mark)) e.setAttribute('fill', '#1d6fff')
    }
    svg.appendChild(e)
    if (o.side) avoid(e, o.side, o.staff ?? 0, undefined, o.fixed)
    return e
  }
  /** A drawn line (a pedal line); with a mark it can be picked and dragged like the text marks. */
  /**
   * What a selected pedal / ottava line holds, shown the MuseScore way: a pale band over the notes it covers (from their staff to the line)
   * and a dashed guide from each end of the line to the note it is anchored to. Screen only (data-ui), never printed.
   */
  const cover = (ps: { a: StaveNote; b: StaveNote; system: number }[], si: number, yOf: (system: number) => number) => ps.forEach((p, k) => {
    const st = layout.measures.find((d) => d.system === p.system)!.staves[si], y = yOf(p.system) // (each line of music has its staves at its own height)
    const xa = p.a.getAbsoluteX() - 6, xb = p.b.getNoteHeadEndX() + 6, top = Math.min(st.top, y) - 6, bottom = Math.max(st.bottom, y) + 6
    const band = document.createElementNS(NS, 'rect')
    for (const [k_, v] of [['x', xa], ['y', top], ['width', xb - xa], ['height', bottom - top], ['rx', 4], ['fill', 'rgba(29,111,255,0.08)'], ['stroke', 'none'], ['pointer-events', 'none'], ['data-ui', '']] as const) band.setAttribute(k_, String(v)) // (stroke none: the page's svg would lend it a black outline)
    svg.insertBefore(band, svg.firstChild) // behind the notes
    const guide = (x: number, n: StaveNote) => { // from the line to the note head on its side
      const ys = n.getYs(), ny = y < Math.min(...ys) ? Math.min(...ys) - 5 : Math.max(...ys) + 5
      const g = document.createElementNS(NS, 'path')
      for (const [k_, v] of [['d', `M${x} ${y}L${x} ${ny}`], ['stroke', '#1d6fff'], ['stroke-width', '1'], ['stroke-dasharray', '2 3'], ['opacity', '0.75'], ['pointer-events', 'none'], ['data-ui', '']] as const) g.setAttribute(k_, v)
      svg.appendChild(g)
    }
    if (k === 0) guide(xa + 6, p.a)
    if (k === ps.length - 1) guide(xb - 6, p.b)
  })
  const line = (d: string, mark?: MarkRef, dashed = false) => {
    const e = document.createElementNS(NS, 'path')
    e.setAttribute('d', d); e.setAttribute('fill', 'none'); e.setAttribute('stroke', mark && isSel(mark) ? '#1d6fff' : '#000'); e.setAttribute('stroke-width', '1.3')
    if (dashed) e.setAttribute('stroke-dasharray', '5 4')
    if (mark) { e.setAttribute('data-mark', JSON.stringify(mark)); e.setAttribute('style', 'cursor:grab'); e.setAttribute('pointer-events', 'stroke') }
    svg.appendChild(e)
    if (mark) { const hit = e.cloneNode() as SVGPathElement; hit.setAttribute('stroke', 'transparent'); hit.setAttribute('stroke-width', '10'); svg.appendChild(hit) } // a wider band to catch the pointer
  }
  layout.measures.forEach((dm) => {
    const m = score.measures[dm.m], top = dm.staves[0].top
    const x0 = (dm.evs[0]?.x ?? dm.x + 30) - 10
    if (dm.m === 0 || m.tempo || m.tempoText) {
      const bpm = dm.m === 0 && !m.tempoAt ? score.tempo : m.tempo
      const tx = (m.tempoAt ? xAtTick(dm, m.tempoAt) - 10 : x0) + (m.tempoDx ?? 0) // a mark in the middle of the bar stands at its tick, between the notes if need be
      put(`${m.tempoText ? m.tempoText + (bpm ? '  ' : '') : ''}${bpm ? `♩ = ${bpm}` : ''}`, tx, top - 60 + (m.tempoDy ?? 0), { size: 14, bold: true, mark: { kind: 'tempo', bar: dm.m } })
      if (dm.m === 0 && m.tempoAt) put(`♩ = ${score.tempo}`, x0, top - 60, { size: 14, bold: true })
    }
    if (m.rehearsal) {
      const e = put(m.rehearsal, x0 + 8, top - 78, { size: 15, bold: true, font: 'Arial, sans-serif', mark: { kind: 'rehearsal', bar: dm.m } })
      const w = 14 + 9 * m.rehearsal.length
      const r = document.createElementNS(NS, 'rect')
      r.setAttribute('x', String(x0)); r.setAttribute('y', String(top - 94)); r.setAttribute('width', String(w)); r.setAttribute('height', '22')
      r.setAttribute('fill', 'none'); r.setAttribute('stroke', '#000'); r.setAttribute('stroke-width', '1.4')
      svg.insertBefore(r, e)
    }
  })
  // events of every staff+voice in order, to follow marks that run from one note to a later one (and across a line break)
  const chains = new Map<string, { ev: Ev; m: number }[]>()
  score.measures.forEach((m, mi) => m.staves.forEach((vs, si) => vs.forEach((evs, vi) => {
    const k = `${si}:${vi}`, c = chains.get(k) ?? []
    evs.forEach((ev) => c.push({ ev, m: mi }))
    chains.set(k, c)
  })))
  /** First and last drawn note of chain[i..j] on every line it touches. */
  const pieces = (chain: { ev: Ev }[], i: number, j: number) => {
    const out: { a: StaveNote; b: StaveNote; system: number }[] = []
    for (let k = i; k <= j; k++) {
      const n = noteOf.get(chain[k].ev.id)
      if (!n || !(n.note instanceof StaveNote)) continue
      const last = out[out.length - 1]
      if (last && last.system === n.system) last.b = n.note
      else out.push({ a: n.note, b: n.note, system: n.system })
    }
    return out
  }
  chains.forEach((chain, key) => {
    const si = +key.split(':')[0]
    chain.forEach(({ ev, m }, i) => {
      const n = noteOf.get(ev.id)
      if (!n) return
      const st = layout.measures[m].staves[si], x = n.note.getAbsoluteX()
      if (ev.chord) put(ev.chord, x - 2, st.top - 34, { size: 14, bold: true, font: 'Arial, sans-serif', side: -1, staff: si, fixed: ev.off?.chord, mark: { kind: 'ev', field: 'chord', id: ev.id } })
      if (ev.staffText) put(ev.staffText, x - 2, st.top - 34, { size: 13, bold: true, italic: true, side: -1, staff: si, fixed: ev.off?.staffText, mark: { kind: 'ev', field: 'staffText', id: ev.id } })
      if (ev.expr) put(ev.expr, x - 2, st.bottom + 54, { size: 14, bold: true, italic: true, side: 1, staff: si, fixed: ev.off?.expr, mark: { kind: 'ev', field: 'expr', id: ev.id } })
      if (ev.lyric) put(ev.lyric, x + 5, st.bottom + 26, { size: 13, anchor: 'middle', side: 1, staff: si, fixed: ev.off?.lyric, mark: { kind: 'ev', field: 'lyric', id: ev.id } })
      if (ev.breath) put(ev.breath === 'breath' ? '\uE4CE' : '\uE4D1', x + 20, st.top - 2, { size: 30, font: 'Bravura, serif' })
      if (ev.ottava) { // 8va / 15ma above the staff, 8vb / 15mb below: the sign, a dashed line and a hook at the end, which can be dragged to another note
        const j = chain.findIndex((q) => q.ev.id === ev.ottava!.end), ps = j >= i ? pieces(chain, i, j) : []
        const up = ev.ottava.n > 0, glyph = { 8: '\uE511', 15: '\uE515', [-8]: '\uE51C', [-15]: '\uE51D' }[ev.ottava.n]
        const mark: MarkRef = { kind: 'ev', field: 'ottava', id: ev.id }
        if (isSel(mark)) cover(ps, si, (sys) => { const st = layout.measures.find((d) => d.system === sys)!.staves[si]; return up ? st.top - 26 : st.bottom + 34 })
        ps.forEach((p, k) => {
          const first = k === 0, last = k === ps.length - 1
          const st = layout.measures.find((d) => d.system === p.system)!.staves[si], y = up ? st.top - 26 : st.bottom + 34
          const x0 = p.a.getAbsoluteX() - 4, x1 = p.b.getNoteHeadEndX() + 6
          if (first) put(glyph, x0, y + (up ? 6 : 0), { size: 24, font: 'Bravura, serif', mark: { ...mark, start: true } }) // the sign drags the beginning
          const from = first ? x0 + (Math.abs(ev.ottava!.n) === 15 ? 38 : 30) : x0
          if (x1 > from) line(`M${from} ${y}L${x1} ${y}${last ? `L${x1} ${y + (up ? 9 : -9)}` : ''}`, last ? mark : undefined, true)
          else if (last) line(`M${x1} ${y}L${x1} ${y + (up ? 9 : -9)}`, mark) // one short note: the hook alone
        })
      }
      if (ev.pedal) { // under the lowest staff of the line, whichever staff the notes are on; the end (✱ or hook) can be dragged to let the pedal go elsewhere
        const j = chain.findIndex((q) => q.ev.id === ev.pedal!.end), ps = j >= i ? pieces(chain, i, j) : []
        const below = (system: number) => Math.max(...layout.measures.filter((d) => d.system === system).map((d) => d.staves[d.staves.length - 1].bottom)) + 38
        const style = ev.pedal.style ?? 'star', mark: MarkRef = { kind: 'ev', field: 'pedal', id: ev.id }
        if (isSel(mark)) cover(ps, si, (sys) => below(sys) - 6)
        ps.forEach((p, k) => {
          const first = k === 0, last = k === ps.length - 1, y = below(p.system)
          const x0 = p.a.getAbsoluteX() - 4, x1 = p.b.getNoteHeadEndX() + 6
          const begin: MarkRef = { ...mark, start: true } // its beginning (Ped. or the first hook) drags on its own
          if (style === 'star') {
            if (first) put('\uE650', x0, y, { size: 30, font: 'Bravura, serif', mark: begin })
            if (last) put('\uE655', first ? Math.max(x1 - 2, x0 + 40) : x1 - 2, y, { size: 30, font: 'Bravura, serif', mark }) // (on one short note the ✱ still clears the Ped.)
            return
          }
          const ped = style === 'line' && first, from = ped ? x0 + 34 : x0, top = y - 12 // a line piece per line of music; Ped. or a hook where the pedal goes down, a hook where it comes up
          if (ped) put('\uE650', x0, y, { size: 30, font: 'Bravura, serif', mark: begin })
          else if (first) line(`M${from} ${top}L${from} ${y}`, begin)
          let d = `M${from} ${y}L${x1} ${y}`
          if (last) d += style === 'angled' ? `L${x1 + 7} ${top}` : `L${x1} ${top}`
          line(d, last ? mark : undefined)
        })
      }
      if (ev.gliss) {
        const nx = chain[i + 1], b = nx && noteOf.get(nx.ev.id)
        if (b && b.system === n.system && n.note instanceof StaveNote && b.note instanceof StaveNote && nx.ev.pitches.length) {
          const x1 = n.note.getNoteHeadEndX() + 3, y1 = Math.min(...n.note.getYs()), x2 = b.note.getNoteHeadBeginX() - 3, y2 = Math.min(...b.note.getYs())
          const p = document.createElementNS(NS, 'path')
          let d = `M${x1} ${y1}`
          if (ev.gliss === 'straight') d += `L${x2} ${y2}`
          else { // wavy: a sine laid along the line
            const len = Math.hypot(x2 - x1, y2 - y1), steps = Math.max(8, Math.round(len / 2)), nx_ = (y2 - y1) / len, ny = -(x2 - x1) / len
            for (let q = 1; q <= steps; q++) { const t = q / steps, w = Math.sin((t * len) / 4.2) * 2.4; d += `L${x1 + (x2 - x1) * t + nx_ * w} ${y1 + (y2 - y1) * t + ny * w}` }
            put('gliss.', (x1 + x2) / 2 - 8, Math.min(y1, y2) - 16, { size: 11, italic: true })
          }
          p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#000'); p.setAttribute('stroke-width', '1.2')
          svg.appendChild(p)
        }
      }
    })
  })

  return layout
}
