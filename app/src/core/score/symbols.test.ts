import { describe, expect, it } from 'vitest'
import { readScore } from './omr'
import type { Glyph, PagePrims, Seg } from './primitives'
import { tempoRatios, toNotes, unroll } from './playback'

// A one-staff page drawn the way MuseScore 4 (Leland, SMuFL) draws it: glyph origins on the note's line, stems as strokes, flags as glyphs.
const SP = 5, BOTTOM = 700, SIZE = 4 * SP, HEAD_W = 1.18 * SP
const yOf = (step: number) => BOTTOM + (step * SP) / 2                     // step 0 = bottom line, 1 = first space …
type N = { step: number; dur: 'w' | 'h' | 'q' | 'e'; acc?: number; art?: number; dyn?: number[]; tup?: number; rest?: boolean; x?: number; orn?: number; trem?: number; arp?: boolean; chord?: number[]; pct?: boolean; accDx?: number; pre?: { key?: [number, number][]; time?: [number, number] }; multi?: number }
interface Opts { clef?: number; clefLine?: number; time?: [number, number]; marks?: { bar: number; bpm: number }[]; ottava?: { code: number; from: number; to: number; below?: boolean } }

function page(bars: N[][], o: Opts = {}): PagePrims {
  const glyphs: Glyph[] = [], segs: Seg[] = []
  const g = (code: number, x: number, y: number, w = HEAD_W, size = SIZE) => glyphs.push({ font: 'leland', code, x, y, size, w })
  const x0 = 40, x1 = 40 + 120 * bars.length + 60
  for (let k = 0; k < 5; k++) segs.push({ x1: x0, y1: BOTTOM + k * SP, x2: x1, y2: BOTTOM + k * SP, w: 0.5 })
  const bx = [x0]; bars.forEach((_, i) => bx.push(x0 + 60 + 120 * (i + 1)))
  bx.forEach((x) => segs.push({ x1: x, y1: BOTTOM, x2: x, y2: BOTTOM + 4 * SP, w: 0.8 }))
  g(o.clef ?? 0xe050, x0 + 4, BOTTOM + (o.clefLine ?? 1) * SP, 2.6 * SP)
  const [b, u] = o.time ?? [4, 4]
  g(0xe080 + b, x0 + 30, BOTTOM + 3 * SP, SP * 1.6); g(0xe080 + u, x0 + 30, BOTTOM + 1 * SP, SP * 1.6)
  bars.forEach((notes, bi) => {
    let x = bx[bi] + (bi === 0 ? 50 : 14)
    const first = x
    const pre = notes[0]?.pre
    if (notes[0]?.multi) { // a multi-measure rest: thick bar in the middle of the staff, the count above the staff
      g(0xe4ee, bx[bi] + 30, yOf(4), 60)
      String(notes[0].multi).split('').forEach((d, i) => g(0xe080 + +d, bx[bi] + 55 + i * 8, BOTTOM + 7 * SP, 8))
      return
    }
    if (pre) { // key signature and / or time signature right after the barline
      ;(pre.key ?? []).forEach(([code, step], k) => g(code, bx[bi] + 6 + k * 6, yOf(step), 6))
      const kx = bx[bi] + 6 + (pre.key?.length ?? 0) * 6 + 6
      if (pre.time) { g(0xe080 + pre.time[0], kx, BOTTOM + 3 * SP, 8); g(0xe080 + pre.time[1], kx, BOTTOM + 1 * SP, 8) }
      x = kx + (pre.time ? 14 : 0) + 8
    }
    notes.forEach((n, k) => {
      const nx = n.x ?? x
      if (n.pct) { g(0xe500, nx, yOf(4), 8); x += 28; return }
      if (n.rest) { g(0xe4e5, nx, yOf(4)); x += 28; return }
      const y = yOf(n.step)
      if (n.acc) g(n.acc, nx - (n.accDx ?? 8), y, 7)
      g(n.dur === 'w' ? 0xe0a2 : n.dur === 'h' ? 0xe0a3 : 0xe0a4, nx, y)
      for (const st of n.chord ?? []) g(0xe0a4, nx, yOf(st))
      if (n.orn) g(n.orn, nx + HEAD_W / 2 - 3, BOTTOM + 7 * SP, 6)
      if (n.trem) g(0xe220 + n.trem - 1, nx + HEAD_W - 3, y + 2 * SP, 6)
      if (n.arp) for (let k2 = 0; k2 < 3; k2++) g(0xe63c, nx - 6, yOf(Math.min(n.step, ...(n.chord ?? [])) + k2 * 2), 4)
      if (n.dur !== 'w') {
        const up = n.step < 4, sx = up ? nx + HEAD_W - 0.3 : nx + 0.3, tip = up ? y + 3.5 * SP : y - 3.5 * SP
        segs.push({ x1: sx, y1: y, x2: sx, y2: tip, w: 0.55 })
        if (n.dur === 'e') g(up ? 0xe240 : 0xe241, sx, tip, SP * 1.2)
      }
      if (n.art) g(n.art, nx + HEAD_W / 2 - 2, n.step < 4 ? y - 2.5 * SP : y + 2.5 * SP, 4)
      if (n.dyn) { let dx = nx; for (const c of n.dyn) { g(c, dx, BOTTOM - 4 * SP, 5); dx += 5 } }
      if (n.tup && !notes[k - 1]?.tup) g(0xe880 + n.tup, nx + ((n.tup - 1) * 20) / 2, BOTTOM + 8 * SP, 4)
      x += n.dur === 'w' ? 80 : n.dur === 'h' ? 56 : n.dur === 'q' ? 28 : n.tup ? 20 : 20
    })
    void first
  })
  if (o.ottava) { // label above (or below) the staff, then a dashed line made of short strokes
    const ox = bx[o.ottava.from] + 14, oy = o.ottava.below ? BOTTOM - 4 * SP : BOTTOM + 8 * SP
    g(o.ottava.code, ox, oy, 12)
    for (let x = ox + 14; x < bx[o.ottava.to + 1] - 10; x += 6) segs.push({ x1: x, y1: oy, x2: x + 3, y2: oy, w: 0.6 })
  }
  for (const m of o.marks ?? []) { // ♩ = bpm above the staff, at the start of bar m.bar
    const x = bx[m.bar] + (m.bar === 0 ? 50 : 14)
    g(0xeca5, x, BOTTOM + 10 * SP, 5)
    String(m.bpm).split('').forEach((d, i) => g(0x30 + +d, x + 20 + i * 5, BOTTOM + 10 * SP, 5))
  }
  return { width: 612, height: 792, glyphs, segs, polys: [], curves: [] }
}
const play = (p: PagePrims, bpm = 60) => { const s = readScore([p]); return { s, notes: toNotes(unroll(s), bpm, 85, tempoRatios(s)).sort((a, b) => a.start - b.start) } }
const Q = (step: number, extra: Partial<N> = {}): N => ({ step, dur: 'q', ...extra })

describe('symbols a MuseScore 4 page can carry', () => {
  const fourQ = (extra: Partial<N> = {}) => [Q(0, extra), Q(2), Q(4), Q(6)]

  it('reads a plain bar (control for the others)', () => {
    const { s, notes } = play(page([fourQ()]))
    expect(s.measures[0].suspect).toBeUndefined()
    expect(notes.map((n) => n.pitch)).toEqual([64, 67, 71, 74])           // E4 G4 B4 D5
  })

  it('double sharp and double flat', () => {
    const { notes } = play(page([[Q(0, { acc: 0xe263 }), Q(2, { acc: 0xe264 }), Q(4), Q(6)]]))
    expect(notes[0].pitch).toBe(66)    // E## = F#4
    expect(notes[1].pitch).toBe(65)    // Gbb = F4
  })

  it('alto, tenor and octave clefs put the same note on different pitches', () => {
    const bottom = (clef: number, line = 1) => play(page([fourQ()], { clef, clefLine: line })).notes[0].pitch
    expect(bottom(0xe050)).toBe(64)          // treble: E4
    expect(bottom(0xe05c, 2)).toBe(53)       // alto: F3
    expect(bottom(0xe05c, 3)).toBe(50)       // tenor: D3
    expect(bottom(0xe052)).toBe(52)          // treble 8vb: E3
    expect(bottom(0xe053)).toBe(76)          // treble 8va: E5
    expect(bottom(0xe064, 3)).toBe(31)       // bass 8vb: G1
  })

  it('dynamics set the loudness from there on, also across bars', () => {
    const { notes } = play(page([[Q(0, { dyn: [0xe522] }), Q(2), Q(4, { dyn: [0xe520] }), Q(6)], [Q(0), Q(2), Q(4, { dyn: [0xe521, 0xe522] }), Q(6)]]))
    expect(notes.map((n) => n.velocity)).toEqual([96, 96, 49, 49, 49, 49, 80, 80])   // f … p … (bar 2) … mf
  })

  it('staccato shortens the note, accent makes it louder, tenuto leaves it', () => {
    const { notes } = play(page([[Q(0, { art: 0xe4a2 }), Q(2, { art: 0xe4a0 }), Q(4, { art: 0xe4a4 }), Q(6)]]))
    expect(notes[0].duration).toBeCloseTo(0.5, 5)
    expect(notes[1].velocity).toBeGreaterThan(85)
    expect(notes[2].duration).toBeCloseTo(1, 5); expect(notes[3].velocity).toBe(85)
  })

  it('a triplet digit makes three eighths fit one beat', () => {
    const bar: N[] = [Q(0), { step: 2, dur: 'e', tup: 3 }, { step: 3, dur: 'e', tup: 3 }, { step: 4, dur: 'e', tup: 3 }, { step: 6, dur: 'h' }]
    const { s, notes } = play(page([bar]))
    expect(s.measures[0].suspect).toBeUndefined()
    expect(notes).toHaveLength(5)
    expect(notes[1].duration).toBeCloseTo(1 / 3, 5)
    expect(notes[4].start).toBeCloseTo(2, 5)
  })

  it('tempo markings change the speed from their bar on', () => {
    const { notes, s } = play(page([fourQ(), fourQ(), fourQ()], { marks: [{ bar: 0, bpm: 60 }, { bar: 2, bpm: 120 }] }), 60)
    expect(s.measures.map((m) => m.tempo)).toEqual([60, 60, 120])
    expect(notes[8].start).toBeCloseTo(8, 5)             // bars 1-2 at 60: eight seconds
    expect(notes[9].start - notes[8].start).toBeCloseTo(0.5, 5) // then twice as fast
  })
})

describe('more symbols', () => {
  const fourQ = (extra: Partial<N> = {}) => [Q(0, extra), Q(2), Q(4), Q(6)]
  it('8va lines: written an octave low, sound an octave high; only under the line', () => {
    const p = page([fourQ(), fourQ()], { ottava: { code: 0xe511, from: 0, to: 0 } })
    const { notes } = play(p)
    expect(notes.slice(0, 4).map((n) => n.pitch)).toEqual([76, 79, 83, 86])   // under the line: +12
    expect(notes.slice(4).map((n) => n.pitch)).toEqual([64, 67, 71, 74])      // after it: as written
  })
  it('8vb below the staff and 15ma', () => {
    expect(play(page([fourQ()], { ottava: { code: 0xe512, from: 0, to: 0, below: true } })).notes[0].pitch).toBe(52)
    expect(play(page([fourQ()], { ottava: { code: 0xe515, from: 0, to: 0 } })).notes[0].pitch).toBe(88)
  })
  it('trill and turn signs over a note', () => {
    const { notes } = play(page([[{ step: 0, dur: 'h', orn: 0xe566 }, { step: 2, dur: 'h', orn: 0xe567 }]]))
    expect(notes.length).toBeGreaterThan(6)
    expect(notes[0].pitch).toBe(64); expect(notes[1].pitch).toBe(65)          // E4 F4 E4 F4 …
    const turn = notes.filter((n) => n.start >= 2 - 1e-9).map((n) => n.pitch)
    expect(turn.slice(0, 4)).toEqual([69, 67, 65, 67])                         // above (A4), G4, below (F4), G4
  })
  it('a tremolo stroke repeats the note', () => {
    const { notes } = play(page([[{ step: 0, dur: 'h', trem: 2 }, { step: 2, dur: 'h' }]]))
    expect(notes.filter((n) => n.pitch === 64)).toHaveLength(8)              // a half note of sixteenths
  })
  it('an arpeggio wiggle rolls the chord', () => {
    const { notes } = play(page([[{ step: 0, dur: 'h', chord: [2, 4], arp: true }, { step: 4, dur: 'h' }]]))
    const chord = notes.filter((n) => n.start < 2).sort((a, b) => a.pitch - b.pitch)
    expect(chord).toHaveLength(3)
    expect(chord[0].start).toBeLessThan(chord[1].start); expect(chord[1].start).toBeLessThan(chord[2].start)
  })
  it('"repeat the previous bar" plays the bar again', () => {
    const { notes, s } = play(page([fourQ(), [{ step: 0, dur: 'q', pct: true }, { step: 0, dur: 'q', rest: true }]]))
    expect(s.measures).toHaveLength(2)
    expect(notes.slice(4).map((n) => n.pitch)).toEqual([64, 67, 71, 74])
  })
})

describe('what the composer gets from such a PDF', () => {
  it('tuplets, dynamics, articulations and tempo arrive as editable marks', async () => {
    const { scoreFromOmr } = await import('../../editor/importScore')
    const { validate } = await import('../../editor/model')
    const bar: N[] = [Q(0, { dyn: [0xe522], art: 0xe4a2 }), { step: 2, dur: 'e', tup: 3 }, { step: 3, dur: 'e', tup: 3 }, { step: 4, dur: 'e', tup: 3 }, { step: 6, dur: 'h' }]
    const { score } = scoreFromOmr(readScore([page([bar, bar], { marks: [{ bar: 0, bpm: 72 }, { bar: 1, bpm: 90 }] })]), 'x')
    expect(validate(score)).toEqual([])
    const evs = score.measures[0].staves[0][0]
    expect(evs[0].dyn).toBe('f'); expect(evs[0].art).toEqual(['staccato'])
    expect(evs.filter((e) => e.tup).map((e) => `${e.tup!.n}:${e.tup!.m}`)).toEqual(['3:2', '3:2', '3:2'])
    expect(new Set(evs.filter((e) => e.tup).map((e) => e.tup!.group)).size).toBe(1)
    expect(score.tempo).toBe(72); expect(score.measures[1].tempo).toBe(90); expect(score.measures[0].tempo).toBeUndefined()
  })
})

describe('line and file structure', () => {
  const fourQ = () => [Q(0), Q(2), Q(4), Q(6)]
  it('a multi-measure rest stands for as many bars as its number says', () => {
    const { s, notes } = play(page([fourQ(), [{ step: 0, dur: 'w', multi: 3 }], fourQ()]))
    expect(s.measures).toHaveLength(5)
    expect(s.measures.every((m) => !m.suspect)).toBe(true)
    expect(notes[4].start).toBeCloseTo(16, 5)                  // the bars after the rest start four bars in
  })

  it('a key signature that changes in the middle of the line applies from that bar on (naturals cancel)', () => {
    const f4 = () => [Q(1), Q(1), Q(1), Q(1)]                  // F4 four times: natural in C major, sharp in G major
    const g = [[0xe262, 8]] as [number, number][]              // one sharp on the top line (F5)
    const bars = [f4(), f4(), f4(), f4()]
    bars[1][0].pre = { key: g }
    bars[3][0].pre = { key: [[0xe261, 8]] }                    // a natural cancels it again
    const { notes } = play(page(bars))
    expect(notes.filter((_, i) => i % 4 === 0).map((n) => n.pitch)).toEqual([65, 66, 66, 65])
  })

  it('an accidental of the first note, drawn far from it, is not mistaken for a key change', () => {
    const bar = [Q(2, { acc: 0xe262, accDx: 16 }), Q(1), Q(1), Q(1)]       // G# with its sign two spaces away: unattached, right after the barline
    const { notes } = play(page([fourQ(), bar]))
    expect(notes.slice(5).map((n) => n.pitch)).toEqual([65, 65, 65])       // the F's stay natural: one lone sharp is no key signature
  })

  it('a time signature that changes in the middle of the line sets the length of the bars after it', () => {
    const three = [Q(0), Q(2), Q(4)]
    three[0].pre = { time: [3, 4] }
    const { s, notes } = play(page([fourQ(), three, three.map((n) => ({ ...n, pre: undefined }))]))
    expect(s.measures.map((m) => m.length)).toEqual([4, 3, 3])
    expect(s.measures.every((m) => !m.suspect)).toBe(true)
    expect(s.beatsPerBar).toBe(4)                               // the piece starts in 4/4
    expect(notes[4].start).toBeCloseTo(4, 5); expect(notes[7].start).toBeCloseTo(7, 5)
  })

  it('three staves in a system: bass-like staves are the left hand, the others the right', () => {
    const shift = (p: PagePrims, dy: number): PagePrims => ({ ...p, glyphs: p.glyphs.map((g) => ({ ...g, y: g.y + dy })), segs: p.segs.map((q) => ({ ...q, y1: q.y1 + dy, y2: q.y2 + dy })) })
    const a = page([fourQ()]), b = shift(page([fourQ()]), -70), c = shift(page([fourQ()], { clef: 0xe062, clefLine: 3 }), -140)
    const join: Seg[] = [] // the barlines of the three staves are one line through all of them
    for (const q of a.segs.filter((q) => Math.abs(q.x1 - q.x2) < 0.01 && q.w > 0.7)) join.push({ x1: q.x1, x2: q.x1, y1: BOTTOM + 4 * SP, y2: BOTTOM - 140, w: q.w })
    const p: PagePrims = { ...a, glyphs: [...a.glyphs, ...b.glyphs, ...c.glyphs], segs: [...a.segs, ...b.segs, ...c.segs, ...join] }
    const { s, notes } = play(p)
    expect(s.measures).toHaveLength(1)
    expect(s.measures[0].suspect).toBeUndefined()
    expect(s.measures[0].written!.map((w) => w.hand)).toEqual([0, 0, 1])
    expect(notes.filter((n) => n.hand === 1).length).toBe(4); expect(notes.filter((n) => n.hand === 0).length).toBe(8)
  })

  it('the composer takes all staves: each hand gets the voices of its staves', async () => {
    const { scoreFromOmr } = await import('../../editor/importScore')
    const { validate } = await import('../../editor/model')
    const shift = (p: PagePrims, dy: number): PagePrims => ({ ...p, glyphs: p.glyphs.map((g) => ({ ...g, y: g.y + dy })), segs: p.segs.map((q) => ({ ...q, y1: q.y1 + dy, y2: q.y2 + dy })) })
    const a = page([fourQ()]), b = shift(page([fourQ()]), -70), c = shift(page([fourQ()], { clef: 0xe062, clefLine: 3 }), -140)
    const join: Seg[] = a.segs.filter((q) => Math.abs(q.x1 - q.x2) < 0.01 && q.w > 0.7).map((q) => ({ x1: q.x1, x2: q.x1, y1: BOTTOM + 4 * SP, y2: BOTTOM - 140, w: q.w }))
    const { score } = scoreFromOmr(readScore([{ ...a, glyphs: [...a.glyphs, ...b.glyphs, ...c.glyphs], segs: [...a.segs, ...b.segs, ...c.segs, ...join] }]), 'x')
    expect(validate(score)).toEqual([])
    expect(score.measures[0].staves[0]).toHaveLength(2)         // two treble staves = two voices of the right hand
    expect(score.measures[0].staves[1]).toHaveLength(1)
    expect(score.clefs).toEqual(['treble', 'bass'])
  })
})
