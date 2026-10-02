import { Accidental, Articulation, Barline, Beam, Curve, Dot, Formatter, Fraction, GhostNote, GraceNote, GraceNoteGroup, Modifier, Ornament, Renderer, Stave, StaveConnector, StaveNote, StaveTie, Tuplet, Voice, Volta } from 'vexflow/bravura'
import { barTicks, contextAt, nominalTicks, notationOf, starts, type Art, type Ev, type Score } from './model'

/** One drawn event, for hit-testing and selection. */
export interface DrawnEv { id: number; m: number; staff: number; voice: number; at: number; ticks: number; x: number; rest: boolean }
export interface DrawnStaff { top: number; bottom: number; spacing: number; clef: 'treble' | 'bass' }
export interface DrawnMeasure { m: number; x: number; w: number; system: number; staves: DrawnStaff[]; evs: DrawnEv[] }
export interface Layout { width: number; height: number; measures: DrawnMeasure[]; systems: { y0: number; y1: number }[] }

const FIFTHS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
export const keyName = (fifths: number) => FIFTHS[fifths + 7]

const MARGIN = 20, STAFF_GAP = 105, SYSTEM_GAP = 60, STAFF_H = 80, TOP_SPACE = 40, TITLE_H = 70

const pitchKey = (p: { step: string; alter: number; octave: number }) =>
  `${p.step.toLowerCase()}${p.alter > 0 ? '#'.repeat(p.alter) : p.alter < 0 ? 'b'.repeat(-p.alter) : ''}/${p.octave}`

interface Built { notes: Map<number, StaveNote | GhostNote>; voices: Voice[]; beams: Beam[]; tuplets: Tuplet[]; order: { ev: Ev; voice: number; staff: number; at: number }[] }

function build(score: Score, mi: number, staves: Stave[], selected: Set<number>): Built {
  const { time, key } = contextAt(score, mi)
  const m = score.measures[mi]
  const bar = barTicks(time)
  const out: Built = { notes: new Map(), voices: [], beams: [], tuplets: [], order: [] }
  const groups = time.unit === 8 && time.beats % 3 === 0 ? new Fraction(3, 8) : new Fraction(1, 4)

  m.staves.forEach((vs, si) => {
    const clef = score.clefs[si]
    const multi = vs.length > 1
    const staffVoices: Voice[] = []
    vs.forEach((events, vi) => {
      const tickables: (StaveNote | GhostNote)[] = []
      const ts = starts(events)
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
        const restKey = clef === 'treble' ? (vi ? 'g/4' : 'b/4') : vi ? 'f/2' : 'd/3'
        const n = new StaveNote({
          clef,
          keys: rest ? [wholeBar ? (clef === 'treble' ? 'd/5' : 'f/3') : restKey] : ev.pitches.map(pitchKey),
          duration: wholeBar ? 'wr' : nt.name + (rest ? 'r' : ''),
          dots: wholeBar ? 0 : nt.dots,
          alignCenter: wholeBar,
          ...(multi ? { stemDirection: vi === 0 ? 1 : -1 } : { autoStem: true }),
        })
        n.setStave(staves[si])
        if (nt.dots && !wholeBar) Dot.buildAndAttach([n], { all: true })
        if (ev.art?.length && !rest) {
          const CODE: Record<Art, string> = { staccato: 'a.', accent: 'a>', tenuto: 'a-', marcato: 'a^', fermata: 'a@a' }
          for (const a of ev.art) {
            const art = new Articulation(CODE[a])
            if (a === 'marcato' || a === 'fermata') art.setPosition(Modifier.Position.ABOVE)
            else art.setPosition(n.getStemDirection() === 1 ? Modifier.Position.BELOW : Modifier.Position.ABOVE) // on the notehead side
            n.addModifier(art, 0)
          }
        }
        if (ev.orn && !rest) n.addModifier(new Ornament(ev.orn === 'mordent' ? 'mordent' : 'mordent_inverted'), 0)
        if (ev.graces?.length && !rest) {
          const gns = ev.graces.map((g) => new GraceNote({ keys: [pitchKey(g)], duration: '8', clef, slash: false }))
          n.addModifier(new GraceNoteGroup(gns, true), 0)
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
      out.beams.push(...Beam.generateBeams(tickables.filter((t): t is StaveNote => t instanceof StaveNote), { groups: [groups], stemDirection: multi ? (vi === 0 ? 1 : -1) : undefined, maintainStemDirections: multi }))
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
  if (first) st.addClef(score.clefs[si])
  if (first || m.key !== undefined || (mi === 0)) st.addKeySignature(keyName(ctx.key))
  if (mi === 0 || m.time) st.addTimeSignature(`${ctx.time.beats}/${ctx.time.unit}`)
  return st
}

/** Width a bar needs: formatted content plus whatever clef/key/time it carries. */
function minWidth(score: Score, mi: number, first: boolean): number {
  const staves = score.clefs.map((_, si) => modifierStave(score, mi, first, 0, 0, 400, si))
  const b = build(score, mi, staves, new Set())
  const f = new Formatter()
  const byStaff = score.clefs.map((_, si) => b.voices.filter((v) => b.order.find((o) => b.notes.get(o.ev.id) === v.getTickables()[0])?.staff === si))
  byStaff.forEach((vs) => vs.length && f.joinVoices(vs))
  const content = f.preCalculateMinTotalWidth(b.voices)
  const mods = Math.max(...staves.map((s) => s.getNoteStartX() - s.getX()))
  return Math.max(70, content + 28) + mods
}

export interface RenderOptions { width: number; selected?: Set<number> }

/** Draw the whole score into `host` (an SVG) and return where things ended up. */
export function renderScore(host: HTMLElement, score: Score, opts: RenderOptions): Layout {
  host.innerHTML = ''
  const selected = opts.selected ?? new Set<number>()
  const usable = opts.width - 2 * MARGIN
  const n = score.measures.length

  // 1. system breaks: greedy fill on minimum widths
  const first = (mi: number, startOfSystem: boolean) => startOfSystem
  const systems: { from: number; to: number; mins: number[] }[] = []
  let cur: number[] = [], sum = 0, from = 0
  for (let mi = 0; mi < n; mi++) {
    const w = minWidth(score, mi, cur.length === 0)
    if (cur.length && sum + w > usable) { systems.push({ from, to: mi - 1, mins: cur }); cur = []; sum = 0; from = mi }
    cur.push(cur.length === 0 ? w : minWidth(score, mi, false))
    sum += cur[cur.length - 1]
  }
  if (cur.length) systems.push({ from, to: n - 1, mins: cur })
  void first

  // 2. draw
  const height = TITLE_H + systems.length * (STAFF_GAP + STAFF_H + TOP_SPACE + SYSTEM_GAP) + MARGIN
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
  text(`♩ = ${score.tempo}`, MARGIN, 58, 14, 'start')

  const layout: Layout = { width: opts.width, height, measures: [], systems: [] }
  const noteOf = new Map<number, { note: StaveNote | GhostNote; system: number }>()
  const where = new Map<number, { m: number; voice: number; index: number }>()

  systems.forEach((sys, sIdx) => {
    const y0 = TITLE_H + sIdx * (STAFF_GAP + STAFF_H + TOP_SPACE + SYSTEM_GAP)
    const last = sIdx === systems.length - 1
    layout.systems.push({ y0: y0 + 5, y1: y0 + STAFF_GAP + TOP_SPACE + STAFF_H + 40 }) // room for ledger lines above/below
    const total = sys.mins.reduce((a, b) => a + b, 0)
    const stretch = last ? Math.min(1.25, usable / total) : usable / total
    let x = MARGIN
    const rowStaves: Stave[][] = []
    sys.mins.forEach((min, k) => {
      const mi = sys.from + k
      const w = min * stretch
      const staves = score.clefs.map((_, si) => modifierStave(score, mi, k === 0, x, y0 + si * STAFF_GAP, w, si))
      const m = score.measures[mi]
      const vt = voltaType(score, mi)
      staves.forEach((st, si) => {
        if (vt !== undefined && si === 0) {
          const firstOfGroup = JSON.stringify(score.measures[mi - 1]?.volta) !== JSON.stringify(m.volta)
          st.setVoltaType(vt, firstOfGroup || k === 0 ? voltaLabel(m.volta!) : '', 24)
        }
        if (m.startRepeat) st.setBegBarType(Barline.type.REPEAT_BEGIN)
        if (m.endRepeat) st.setEndBarType(Barline.type.REPEAT_END)
        else if (mi === n - 1) st.setEndBarType(Barline.type.END)
        st.setContext(ctx).draw()
      })
      rowStaves.push(staves)

      const b = build(score, mi, staves, selected)
      const f = new Formatter()
      score.clefs.forEach((_, si) => {
        const vs = b.voices.filter((v) => b.order.find((o) => b.notes.get(o.ev.id) === v.getTickables()[0])?.staff === si)
        if (vs.length) f.joinVoices(vs)
      })
      const noteArea = Math.min(...staves.map((s) => s.getNoteEndX())) - Math.max(...staves.map((s) => s.getNoteStartX())) - 12
      f.format(b.voices, Math.max(40, noteArea))
      b.voices.forEach((v) => {
        const first = v.getTickables()[0]
        const o = b.order.find((q) => b.notes.get(q.ev.id) === first)!
        v.draw(ctx, staves[o.staff])
      })
      b.beams.forEach((bm) => bm.setContext(ctx).draw())
      b.tuplets.forEach((tp) => tp.setContext(ctx).draw())

      const dm: DrawnMeasure = {
        m: mi, x, w, system: sIdx,
        staves: staves.map((s, si) => ({ top: s.getYForLine(0), bottom: s.getYForLine(4), spacing: s.getSpacingBetweenLines(), clef: score.clefs[si] })),
        evs: [],
      }
      b.order.forEach((o) => {
        const note = b.notes.get(o.ev.id)!
        dm.evs.push({ id: o.ev.id, m: mi, staff: o.staff, voice: o.voice, at: o.at, ticks: o.ev.ticks, x: note.getAbsoluteX(), rest: o.ev.pitches.length === 0 })
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
    rowStaves.forEach((sts) => new StaveConnector(sts[0], sts[sts.length - 1]).setType('singleRight').setContext(ctx).draw())
  })

  // 3. ties (a tie may run into the next bar, or even the next system)
  score.measures.forEach((m, mi) => m.staves.forEach((vs, si) => vs.forEach((events, vi) => events.forEach((ev, ei) => {
    if (!ev.tie || !ev.pitches.length) return
    const next = events[ei + 1] ?? score.measures[mi + 1]?.staves[si]?.[vi]?.[0]
    const a = noteOf.get(ev.id)
    if (!a) return
    const idx = ev.pitches.map((_, i) => i)
    const b = next && next.pitches.length ? noteOf.get(next.id) : undefined
    if (b && b.system === a.system) new StaveTie({ firstNote: a.note, lastNote: b.note, firstIndexes: idx, lastIndexes: idx }).setContext(ctx).draw()
    else {
      new StaveTie({ firstNote: a.note, lastNote: null, firstIndexes: idx, lastIndexes: idx }).setContext(ctx).draw()
      if (b) new StaveTie({ firstNote: null, lastNote: b.note, firstIndexes: idx, lastIndexes: idx }).setContext(ctx).draw()
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

  // 4. dynamics under the staff, hairpins and slurs (may span bars)
  const DYN_GLYPH: Record<string, string> = { ppp: '\uE52A', pp: '\uE52B', p: '\uE520', mp: '\uE52C', mf: '\uE52D', f: '\uE522', ff: '\uE52F', fff: '\uE530' }
  score.measures.forEach((m, mi) => m.staves.forEach((vs, si) => vs.forEach((events, vi) => events.forEach((ev, ei) => {
    const a = noteOf.get(ev.id)
    if (!a) return
    if (ev.dyn) {
      const st = layout.measures[mi].staves[si]
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      t.textContent = DYN_GLYPH[ev.dyn]
      t.setAttribute('x', String(a.note.getAbsoluteX() - 4)); t.setAttribute('y', String(st.bottom + 38))
      t.setAttribute('font-family', 'Bravura, serif'); t.setAttribute('font-size', '30')
      svg.appendChild(t)
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
        svg.appendChild(p)
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
    void ei; void vi
  }))))

  return layout
}
