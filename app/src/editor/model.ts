// Notation-level score model: what a composer edits (note values, voices, ties), not what a player hears.

export const TPQ = 960 // ticks per quarter note: every value down to a 64th (60) and dotted ones is an integer
export type StepName = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'
export interface Pitch { step: StepName; alter: number; octave: number } // alter: -2 bb .. +2 x

/** `n` notes in the time of `m` (3:2 = triplet). Members share a group id and sit side by side. */
export interface Tup { n: number; m: number; group: number }
export type Dyn = 'pppp' | 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff' | 'ffff' | 'sf' | 'sfz' | 'fp' | 'sfp' | 'rfz'
export type Art = 'staccato' | 'accent' | 'tenuto' | 'marcato' | 'fermata' | 'staccatissimo' | 'upbow' | 'downbow'
export type Orn = 'mordent' | 'inverted' | 'trill' | 'turn'
export type SpanKind = 'slur' | 'cresc' | 'dim' | 'o8' | 'o-8' | 'o15' | 'o-15' | 'pedal' | 'pedal-line' | 'pedal-bracket' | 'pedal-angled'
/** How a sustain pedal is written (MuseScore's keyboard palette): Ped. … ✱, Ped. and a line, a bracket with straight hooks, or one whose end hook slants (a pedal change). */
export type PedalStyle = 'star' | 'line' | 'bracket' | 'angled'

export type ClefName = 'treble' | 'bass' | 'alto' | 'tenor' | 'treble8vb' | 'treble8va' | 'bass8vb' | 'bass8va'
/** `vf` and `ann` are what VexFlow draws; `bottom` is the diatonic index (C0 = 0) of the bottom line as written; `shift` is how many octaves higher than it sounds the staff is written. */
export const CLEFS: Record<ClefName, { label: string; vf: string; ann?: string; bottom: number; shift: number; glyph: string }> = {
  treble: { label: 'Sol', vf: 'treble', bottom: 30, shift: 0, glyph: '\uE050' },
  bass: { label: 'Fa', vf: 'bass', bottom: 18, shift: 0, glyph: '\uE062' },
  alto: { label: 'Do (alto)', vf: 'alto', bottom: 24, shift: 0, glyph: '\uE05C' },
  tenor: { label: 'Do (tenor)', vf: 'tenor', bottom: 22, shift: 0, glyph: '\uE05C' },
  treble8vb: { label: 'Sol 8 dưới', vf: 'treble', ann: '8vb', bottom: 30, shift: 1, glyph: '\uE052' },
  treble8va: { label: 'Sol 8 trên', vf: 'treble', ann: '8va', bottom: 30, shift: -1, glyph: '\uE053' },
  bass8vb: { label: 'Fa 8 dưới', vf: 'bass', ann: '8vb', bottom: 18, shift: 1, glyph: '\uE064' },
  bass8va: { label: 'Fa 8 trên', vf: 'bass', ann: '8va', bottom: 18, shift: -1, glyph: '\uE065' },
}

export type BarlineKind = 'single' | 'double' | 'final' | 'dashed' | 'dotted' | 'none'

/** A note, chord (several pitches) or rest (no pitches). */
export interface Ev {
  id: number
  ticks: number
  pitches: Pitch[]  // sorted low -> high; empty = rest
  tie?: boolean     // tied to the next event with the same pitches
  tup?: Tup         // part of a tuplet: `ticks` is the real length, the written value is ticks*n/m
  kept?: boolean    // a rest the user wrote (the rest key, or a rest made shorter): never merged into its neighbours, as in MuseScore
  dyn?: Dyn         // dynamic marking from this event on
  hairpin?: { type: 'cresc' | 'dim'; end: number } // wedge from this event to the event with id `end`
  off?: Partial<Record<MarkField, number>> // how far (px, + is down) the user dragged each mark from where it would stand by itself
  slur?: number     // slur from this event to the event with id `end`
  art?: Art[]       // articulations
  hidden?: boolean  // a rest that keeps the bar full but is not printed (as in printed scores)
  orn?: Orn         // ornament sign over the (top) note; mordents play as main / neighbour / main, trills and turns alternate quickly
  graces?: Pitch[]  // small notes before this one, played quickly just before the main note
  graceKind?: 'acc' | 'app'  // acciaccatura (slashed) or appoggiatura
  arp?: 'up' | 'down' | 'plain'  // a chord rolled from the bottom up / top down
  gliss?: 'straight' | 'wavy'    // a slide from this note to the next one of the voice
  trem?: 1 | 2 | 3               // tremolo strokes through the stem: repeated notes of 1/8, 1/16, 1/32
  flip?: boolean                 // stem drawn against the default direction
  ottava?: { n: 8 | -8 | 15 | -15; end: number } // 8va / 8vb / 15ma / 15mb from this event to the event `end`: written an octave (or two) off, sounds as stored
  pedal?: { end: number; style?: PedalStyle } // sustain pedal from this event to the event `end` (no style: Ped. … ✱); it holds the sound, the notes keep their length
  breath?: 'breath' | 'caesura'  // mark after the note (drawn, and exported)
  staffText?: string             // text above the staff at this note
  expr?: string                  // expression (italic) below the staff
  chord?: string                 // chord symbol above the staff
  lyric?: string                 // lyric syllable below the staff
}

export interface TimeSig { beats: number; unit: number; symbol?: 'common' | 'cut' }

export interface Measure {
  staves: Ev[][][]        // [staff][voice] -> events in order; every voice fills the bar exactly
  time?: TimeSig          // set when it changes here
  key?: number            // fifths (-7..7), set when it changes here
  tempo?: number          // quarter notes per minute, set when it changes here
  tempoDx?: number        // picture only: how far the (start-of-piece) tempo mark was dragged sideways / up-down from its usual place
  tempoDy?: number
  tempoAt?: number        // where in the bar the tempo mark stands, in ticks from the barline (absent = at the barline)
  tempoText?: string      // "Allegro", "rit." … printed above the bar (with the tempo, when there is one)
  rehearsal?: string      // rehearsal mark (A, B, 1…) in a box
  clefs?: (ClefName | undefined)[] // per staff, set when a clef changes here
  barline?: BarlineKind   // kind of the line closing this bar (repeat signs have their own flags)
  break?: 'system' | 'page' | 'section' // a new line (or page, or section: a new line with a gap and a double bar) starts after this bar
  keep?: boolean          // this bar stays on the same line as the next one
  stretch?: number        // widens (>1) or narrows (<1) this bar
  staffGap?: number       // on the first bar of a line: how much farther apart (px, - = closer) the line's two staves are drawn
  startRepeat?: boolean
  endRepeat?: boolean
  volta?: number[]        // inside an ending bracket for these passes (1st, 2nd ending…)
  segno?: boolean
  coda?: boolean
  toCoda?: boolean
  fine?: boolean
  jump?: { kind: 'dc' | 'ds'; al: 'end' | 'fine' | 'coda' }
}

export interface Score {
  title: string
  composer: string
  tempo: number
  time: TimeSig
  key: number
  clefs: ClefName[]  // one per staff, as at the start
  measures: Measure[]
  nextId: number
}

export const STEPS: StepName[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const SEMI: Record<StepName, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export const midiOf = (p: Pitch) => 12 * (p.octave + 1) + SEMI[p.step] + p.alter
/** Diatonic index: C0 = 0, D0 = 1 … used for staff positions and neighbour steps. */
export const diatonic = (p: Pitch) => p.octave * 7 + STEPS.indexOf(p.step)
export const fromDiatonic = (d: number, alter = 0): Pitch => ({ step: STEPS[((d % 7) + 7) % 7], alter, octave: Math.floor(d / 7) })

/** Spell a MIDI number: sharps in sharp keys, flats in flat keys. */
export function spell(midi: number, key = 0): Pitch {
  const sharps = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'] as StepName[]
  const flats = ['C', 'D', 'D', 'E', 'E', 'F', 'G', 'G', 'A', 'A', 'B', 'B'] as StepName[]
  const pc = ((midi % 12) + 12) % 12, black = [1, 3, 6, 8, 10].includes(pc)
  const step = (key >= 0 ? sharps : flats)[pc]
  return { step, alter: black ? (key >= 0 ? 1 : -1) : 0, octave: Math.floor(midi / 12) - 1 }
}

export const barTicks = (t: TimeSig) => (t.beats * 4 * TPQ) / t.unit

// ---- durations -------------------------------------------------------------------------------------------
export const VALUES = [
  { name: 'w', ticks: 4 * TPQ }, { name: 'h', ticks: 2 * TPQ }, { name: 'q', ticks: TPQ }, { name: '8', ticks: TPQ / 2 },
  { name: '16', ticks: TPQ / 4 }, { name: '32', ticks: TPQ / 8 }, { name: '64', ticks: TPQ / 16 },
]

/** Notation of a length: a value plus 0..2 dots, or null when it needs several tied notes. */
export function notationOf(ticks: number): { name: string; dots: number } | null {
  for (const v of VALUES) for (let dots = 0; dots <= 2; dots++) {
    if (Math.round(v.ticks * (2 - 0.5 ** dots)) === ticks) return { name: v.name, dots }
  }
  return null
}

/** The written value of an event: tuplet members are written at the value they imitate (a 3:2 eighth is 320 ticks long but written as an eighth, 480). */
export const nominalTicks = (e: { ticks: number; tup?: Tup }) => (e.tup ? Math.round((e.ticks * e.tup.n) / e.tup.m) : e.ticks)

/**
 * How a bar's rests are grouped, when it is not simple time: the tick where each group starts, and whether a group may be one dotted rest.
 * Compound time (6, 9 or 12 beats, any unit: 6/8, 6/4, 12/16) groups by three units; 5 beats by 3+2 and 7 by 2+2+3. A whole group of
 * eighths or shorter is one dotted rest (a dotted quarter in 6/8 or 5/8); 5/4 and 7/4 stay with plain rests. Simple time: undefined.
 */
export function restGroups(time: TimeSig): RestGroups | undefined {
  const u = (4 * TPQ) / time.unit, { beats } = time
  const sizes = beats % 3 === 0 && beats >= 6 ? Array<number>(beats / 3).fill(3) : beats === 5 ? [3, 2] : beats === 7 ? [2, 2, 3] : undefined
  if (!sizes) return undefined
  const starts = sizes.reduce<number[]>((acc, n) => [...acc, acc[acc.length - 1] + n * u], [0]).slice(0, -1)
  return { starts, dotted: beats % 3 === 0 || time.unit >= 8 }
}
export interface RestGroups { starts: number[]; dotted: boolean }

/**
 * Split `ticks` starting at `at` (within a bar) into writable lengths that respect the beat grid
 * (no half note across beat 2). Fewest pieces wins. Rests pass `dots: false` (engraving avoids dotted rests)
 * and `bar`, so a whole empty bar stays a single whole-measure rest; a whole rest is never used for less than the whole bar.
 * With `groups` (compound and odd times, see restGroups) a rest keeps to its group: inside a group it starts or ends with the group or sits
 * on its own grid from the group's start, a whole group may be one dotted rest, and a rest runs across groups only by whole groups.
 */
export function splitLength(at: number, ticks: number, opts: { dots?: boolean; bar?: number; groups?: RestGroups } = {}): number[] {
  const { dots = true, bar, groups } = opts
  if (bar !== undefined && at === 0 && ticks === bar) return [ticks]
  const U = TPQ / 16 // one 64th
  if (at % U || ticks % U) return [ticks] // finer than a 64th: leave as is
  const G = !dots && groups && bar !== undefined ? [...groups.starts, bar].map((t) => t / U) : undefined // group bounds, for rests
  const options: { len: number; unit: number; cost: number; dot: boolean }[] = []
  for (const v of VALUES) for (let d = 0; d <= (dots ? 2 : G && groups!.dotted ? 1 : 0); d++) {
    const len = (v.ticks * (2 - 0.5 ** d)) / U
    if (!Number.isInteger(len) || (!dots && !d && v.ticks === 4 * TPQ)) continue // (a whole rest only ever fills a whole bar, which is handled above)
    options.push({ len, unit: v.ticks / U, cost: 1 + 0.3 * d, dot: d > 0 }) // fewest pieces, then fewest dots
  }
  const fits = (pos: number, o: { len: number; unit: number; dot: boolean }) => {
    if (!G) return pos % o.unit === 0
    const i = G.findIndex((g, k) => g <= pos && pos < G[k + 1]), gs = G[i], ge = G[i + 1]
    if (pos + o.len <= ge) { // inside one group
      if (o.dot) return pos === gs && pos + o.len === ge                                        // a dotted rest is the whole group
      return (pos - gs) % o.unit === 0 || (groups!.dotted && (pos === gs || pos + o.len === ge)) // its own grid, or (eighth groups) up to an edge
    }
    return pos === gs && G.includes(pos + o.len) && pos % o.len === 0 // across groups: whole groups only, on its own grid (a dotted half on beat 1 or 3 of 12/8)
  }
  options.sort((x, y) => y.len - x.len)
  const end = (at + ticks) / U, memo = new Map<number, { n: number; len: number }>()
  const best = (pos: number): { n: number; len: number } => {
    if (pos === end) return { n: 0, len: 0 }
    const hit = memo.get(pos)
    if (hit) return hit
    let r = { n: Infinity, len: 0 }
    for (const o of options) {
      if (pos + o.len > end || !fits(pos, o)) continue
      const n = o.cost + best(pos + o.len).n
      if (n < r.n) r = { n, len: o.len }
    }
    memo.set(pos, r)
    return r
  }
  const out: number[] = []
  for (let pos = at / U; pos < end;) {
    const r = best(pos)
    if (!isFinite(r.n)) { out.push((end - pos) * U); break }
    out.push(r.len * U); pos += r.len
  }
  return out
}

// ---- construction ----------------------------------------------------------------------------------------
let _id = 1
export const newId = (s?: Score) => (s ? s.nextId++ : _id++)

function restsFor(s: Score, at: number, ticks: number, bar: number, groups?: RestGroups): Ev[] {
  return splitLength(at, ticks, { dots: false, bar, groups }).map((t) => ({ id: newId(s), ticks: t, pitches: [] }))
}

export function emptyScore(measures = 4, time: TimeSig = { beats: 4, unit: 4 }, key = 0): Score {
  const s: Score = { title: 'Không tên', composer: '', tempo: 100, time, key, clefs: ['treble', 'bass'], measures: [], nextId: 1 }
  for (let i = 0; i < measures; i++) s.measures.push(blankMeasure(s))
  return s
}

export function blankMeasure(s: Score, time = s.time): Measure {
  return { staves: s.clefs.map(() => [restsFor(s, 0, barTicks(time), barTicks(time))]) }
}

/** Time signature and key in force at measure `i` (they are inherited until changed). */
export function contextAt(s: Score, i: number): { time: TimeSig; key: number; tempo: number } {
  let time = s.time, key = s.key, tempo = s.tempo
  for (let k = 0; k <= i; k++) {
    const m = s.measures[k]
    if (m.time) time = m.time
    if (m.key !== undefined) key = m.key
    if (m.tempo && (k < i || !m.tempoAt)) tempo = m.tempo // a change in the middle of bar i only holds from its position on
  }
  return { time, key, tempo }
}

/** The clef of `staff` in force at measure `i`. */
export function clefAt(s: Score, i: number, staff: number): ClefName {
  let c = s.clefs[staff]
  for (let k = 0; k <= i; k++) c = s.measures[k]?.clefs?.[staff] ?? c
  return c
}

export const clone = <T,>(x: T): T => structuredClone(x)

// ---- editing ---------------------------------------------------------------------------------------------
export interface Loc { m: number; staff: number; voice: number }

/** Where each event of a voice starts. */
export const starts = (events: Ev[]) => { let t = 0; return events.map((e) => { const s = t; t += e.ticks; return s }) }

/** [start, end) of a tuplet group inside one voice. */
function groupSpan(events: Ev[], st: number[], group: number): [number, number] {
  let lo = Infinity, hi = -Infinity
  events.forEach((e, i) => { if (e.tup?.group === group) { lo = Math.min(lo, st[i]); hi = Math.max(hi, st[i] + e.ticks) } })
  return [lo, hi]
}

function voiceOf(s: Score, l: Loc): Ev[] {
  const m = s.measures[l.m]
  const vs = m.staves[l.staff]
  while (vs.length <= l.voice) vs.push(restsFor(s, 0, barTicks(contextAt(s, l.m).time), barTicks(contextAt(s, l.m).time))) // a new voice starts as a bar of rests
  return vs[l.voice]
}

/**
 * Write `content` over [at, at+ticks) of one voice: whatever was there is cut, trimmed or removed,
 * and any gap is filled with rests so the bar still adds up.
 */
function overwrite(s: Score, l: Loc, at: number, ticks: number, content: Ev[]) {
  const events = voiceOf(s, l)
  const time = contextAt(s, l.m).time, bar = barTicks(time), groups = restGroups(time)
  const filler = (from: number, len: number) => restsFor(s, from, len, bar, groups) // rests that fill what was cut (these may merge)
  // a tuplet is all or nothing: touching one member replaces the whole group (what the new content leaves free becomes rests)
  {
    const st = starts(events)
    let lo = at, hi = Math.min(bar, at + ticks)
    events.forEach((e, i) => { if (e.tup && st[i] < hi && st[i] + e.ticks > lo) { lo = Math.min(lo, groupSpan(events, st, e.tup.group)[0]); hi = Math.max(hi, groupSpan(events, st, e.tup.group)[1]) } })
    if (lo !== at || hi !== at + ticks) {
      const tail = hi - (lo + ticks)
      content = tail > 0 ? [...content, ...filler(lo + ticks, tail)] : content
      at = lo; ticks = Math.max(ticks, hi - lo)
    }
  }
  const end = Math.min(bar, at + ticks)
  const out: Ev[] = []
  let t = 0
  let placed = false
  const place = () => { if (!placed) { out.push(...content); placed = true } }
  for (const e of events) {
    const eEnd = t + e.ticks
    if (eEnd <= at) out.push(e)
    else if (t >= end) { place(); out.push(e) }
    else {
      if (t < at) out.push(...(e.pitches.length ? [{ ...e, ticks: at - t, tie: false }] : filler(t, at - t)))  // head of a cut note stays
      place()
      if (eEnd > end) out.push(...filler(end, eEnd - end)) // tail becomes rests
    }
    t = eEnd
  }
  place()
  // rebuild so lengths are consistent and rests are re-spelled on the beat grid
  const fixed: Ev[] = []
  let pos = 0
  for (const e of out) {
    if (!e.pitches.length && !e.tup) {
      splitLength(pos, e.ticks, { dots: false, bar, groups }).forEach((len, k) => { fixed.push({ ...e, id: k ? newId(s) : e.id, ticks: len }); pos += len })
    } else { fixed.push(e); pos += e.ticks }
  }
  // merge neighbouring rests into the value that spans them on the beat grid (two eighth rests that are really a quarter on the beat);
  // a rest the user wrote keeps its own value
  const merged: Ev[] = []
  pos = 0
  for (const e of fixed) {
    const prev = merged[merged.length - 1]
    if (!e.pitches.length && prev && !prev.pitches.length && !e.tup && !prev.tup && !e.kept && !prev.kept) {
      const startPrev = pos - prev.ticks, ok = splitLength(startPrev, prev.ticks + e.ticks, { dots: false, bar, groups })
      if (ok.length === 1) { prev.ticks += e.ticks; pos += e.ticks; continue }
    }
    merged.push(e); pos += e.ticks
  }
  // a cut note may be left with a length that has no single symbol: write it as tied pieces
  const final: Ev[] = []
  pos = 0
  for (const e of merged) {
    if (e.pitches.length && !e.tup && !notationOf(e.ticks)) {
      const parts = splitLength(pos, e.ticks)
      parts.forEach((len, i) => final.push({ ...e, id: i ? newId(s) : e.id, ticks: len, pitches: e.pitches.map((p) => ({ ...p })), tie: i < parts.length - 1 ? true : e.tie }))
    } else final.push(e)
    pos += e.ticks
  }
  s.measures[l.m].staves[l.staff][l.voice] = final
}

/**
 * Put a note (or add it to the chord that already starts here with the same length, and to the notes it is tied on to). Returns the new event's id.
 * A note that replaces another one keeps its grace notes, as in MuseScore.
 */
export function putNote(s: Score, l: Loc, at: number, ticks: number, pitch: Pitch, addToChord = false): number {
  const events = voiceOf(s, l)
  const idx = starts(events).indexOf(at)
  const old = idx >= 0 ? events[idx] : undefined
  if (addToChord && old?.pitches.length && old.ticks === ticks) {
    for (let f = findEv(s, old.id); f?.ev.pitches.length; f = f.ev.tie ? tiedNext(s, f) : undefined) {
      if (!f.ev.pitches.some((p) => midiOf(p) === midiOf(pitch))) f.ev.pitches = [...f.ev.pitches, { ...pitch }].sort((a, b) => midiOf(a) - midiOf(b))
    }
    return old.id
  }
  return writeChord(s, l, at, ticks, [pitch], old?.graces ? { graces: old.graces, graceKind: old.graceKind } : {}).id
}

/** The event after `f` in its voice (the first one of the next bar after the last one of a bar). */
export function tiedNext(s: Score, f: Loc & { index: number }): (Loc & { index: number; at: number; ev: Ev }) | undefined {
  const here = voiceOf(s, f)
  const ev = here[f.index + 1] ?? (f.m + 1 < s.measures.length ? voiceOf(s, { ...f, m: f.m + 1 })[0] : undefined)
  return ev && findEv(s, ev.id)
}

/** Write a note or chord over whatever is there. Longer than what is left of the bar, it goes on in the next bars, tied (bars are added at the end of the piece), as in MuseScore. */
function writeChord(s: Score, l: Loc, at: number, ticks: number, pitches: Pitch[], keep: Partial<Ev>): Ev {
  const len = Math.min(ticks, barTicks(contextAt(s, l.m).time) - at)
  const ev: Ev = { id: newId(s), ...keep, ticks: len, pitches: pitches.map((p) => ({ ...p })), tup: undefined }
  if (ticks > len) ev.tie = true
  overwrite(s, l, at, len, [ev])
  if (ticks > len) {
    if (l.m + 1 >= s.measures.length) insertMeasures(s, s.measures.length, 1)
    writeChord(s, { ...l, m: l.m + 1 }, 0, ticks - len, pitches, {})
  }
  return ev
}

/** Replace what is at [at, at+ticks) with a rest; `kept`: the user wrote it (the rest key), so it keeps its value instead of merging with the rests around it. */
export function putRest(s: Score, l: Loc, at: number, ticks: number, kept = false) {
  const time = contextAt(s, l.m).time, bar = barTicks(time)
  const len = Math.min(ticks, bar - at)
  overwrite(s, l, at, len, restsFor(s, at, len, bar, restGroups(time)).map((r) => (kept ? { ...r, kept } : r)))
}

export function findEv(s: Score, id: number): (Loc & { index: number; at: number; ev: Ev }) | undefined {
  for (let m = 0; m < s.measures.length; m++) {
    const staves = s.measures[m].staves
    for (let st = 0; st < staves.length; st++) {
      for (let v = 0; v < staves[st].length; v++) {
        const ev = staves[st][v]
        const sts = starts(ev)
        const i = ev.findIndex((e) => e.id === id)
        if (i >= 0) return { m, staff: st, voice: v, index: i, at: sts[i], ev: ev[i] }
      }
    }
  }
}

/** Delete = turn into a rest of the same length. */
export function deleteEv(s: Score, id: number) {
  const f = findEv(s, id)
  if (!f) return
  if (f.ev.pitches.length === 0) return
  if (f.ev.tup) { f.ev.pitches = []; f.ev.tie = undefined; f.ev.art = undefined; f.ev.orn = undefined; f.ev.graces = undefined; return } // a tuplet keeps its shape
  putRest(s, f, f.at, f.ev.ticks)
}

/** Move every pitch of an event by `semitones` (spelled for the key), or one diatonic step with `steps`. */
export function transpose(s: Score, id: number, semitones: number) {
  const f = findEv(s, id)
  if (!f || !f.ev.pitches.length) return
  const key = contextAt(s, f.m).key
  f.ev.pitches = f.ev.pitches.map((p) => spell(midiOf(p) + semitones, key))
}

/** Alt+Shift+↑/↓: every pitch one step up or down the scale of the key. */
export function stepDiatonic(s: Score, id: number, dir: 1 | -1) {
  const f = findEv(s, id)
  if (!f) return
  const { key } = contextAt(s, f.m)
  f.ev.pitches = f.ev.pitches.map((p) => { const n = fromDiatonic(diatonic(p) + dir); return { ...n, alter: keyAlterFor(key, n.step) } })
}

/** J: the next way of writing the same sounds (C♯ → D♭ → B𝄪 → C♯), as MuseScore cycles them. */
export function respell(s: Score, id: number) {
  const f = findEv(s, id)
  if (!f) return
  f.ev.pitches = f.ev.pitches.map((p) => {
    const m = midiOf(p), d = diatonic(p)
    const ways = [d - 2, d - 1, d, d + 1, d + 2].map((x) => { const n = fromDiatonic(x); return { ...n, alter: m - midiOf({ ...n, alter: 0 }) } }).filter((n) => Math.abs(n.alter) <= 2)
    ways.sort((a, b) => Math.abs(a.alter) - Math.abs(b.alter) || diatonic(a) - diatonic(b))
    return ways[(ways.findIndex((n) => n.step === p.step && n.octave === p.octave) + 1) % ways.length]
  })
}

export function setAlter(s: Score, id: number, alter: number) {
  const f = findEv(s, id)
  if (!f) return
  f.ev.pitches = f.ev.pitches.map((p) => ({ ...p, alter }))
}

/** Change the length of an event: the next events are overwritten, a shorter length leaves rests. */
export function setLength(s: Score, id: number, ticks: number) {
  const f = findEv(s, id)
  if (!f) return
  const time = contextAt(s, f.m).time, bar = barTicks(time)
  if (f.ev.pitches.length) { writeChord(s, f, f.at, ticks, f.ev.pitches, f.ev); return } // (a re-timed note leaves its tuplet)
  const len = Math.min(ticks, bar - f.at)
  overwrite(s, f, f.at, len, restsFor(s, f.at, len, bar, restGroups(time)).map((r) => ({ ...r, kept: true })))
}

/**
 * Tie a note to the one after it, like MuseScore: a tied note is untied; otherwise the next note of the same voice (in the next bar if need be)
 * is tied to it, and when there is only a rest (or nothing) there, a note of the same pitch and length is written there.
 * Returns the id of the note at the other end of the tie, or undefined when nothing was done (no note, or the next note has other pitches).
 */
export function toggleTie(s: Score, id: number): number | undefined {
  const f = findEv(s, id)
  if (!f || !f.ev.pitches.length) return undefined
  if (f.ev.tie) { f.ev.tie = false; return id }
  const here = voiceOf(s, f)
  let loc: Loc = f, at = f.at + f.ev.ticks, next = here[f.index + 1]
  if (!next) {
    if (f.m + 1 >= s.measures.length) insertMeasures(s, f.m + 1, 1)
    loc = { m: f.m + 1, staff: f.staff, voice: f.voice }; at = 0; next = voiceOf(s, loc)[0]
  }
  if (next.pitches.length) {
    if (!sameMidi(next.pitches, f.ev.pitches)) return undefined
    f.ev.tie = true
    return next.id
  }
  const bar = barTicks(contextAt(s, loc.m).time)
  const copy: Ev = { id: newId(s), ticks: Math.min(f.ev.ticks, bar - at), pitches: f.ev.pitches.map((p) => ({ ...p })) }
  overwrite(s, loc, at, copy.ticks, [copy])
  findEv(s, id)!.ev.tie = true // (re-found: the overwrite may have rebuilt the voice)
  return copy.id
}

const sameMidi = (a: Pitch[], b: Pitch[]) => a.length === b.length && a.every((p, i) => midiOf(p) === midiOf(b[i]))

export function insertMeasure(s: Score, after: number) { insertMeasures(s, after + 1, 1) }

/** `count` empty bars before bar `at` (0 = at the start of the piece, the number of bars = at the end), in the time signature in force there. */
export function insertMeasures(s: Score, at: number, count: number) {
  const time = at > 0 ? contextAt(s, at - 1).time : s.time
  s.measures.splice(at, 0, ...Array.from({ length: Math.max(0, Math.floor(count)) }, () => blankMeasure(s, time)))
}

/** Take out bars `from` to `to`; at least one bar always stays. */
export function deleteMeasures(s: Score, from: number, to: number) {
  const n = Math.min(to, s.measures.length - 1) - Math.max(from, 0) + 1
  if (n > 0 && n < s.measures.length) s.measures.splice(Math.max(from, 0), n)
}

/** Bars `from` to `to` stay on one line, as far as the page allows (turn it on again to release them). */
export function toggleKeep(s: Score, from: number, to: number) {
  const on = !s.measures.slice(from, to).every((m) => m.keep)
  for (let i = from; i < to; i++) s.measures[i].keep = on ? true : undefined
}

export function deleteMeasure(s: Score, i: number) {
  if (s.measures.length > 1) s.measures.splice(i, 1)
}

/**
 * Change the time signature from measure `i` until the next change: the music is re-barred like MuseScore does
 * (notes that now cross a barline become tied pieces, the last bar is padded with rests). If a tuplet would be cut
 * by a new barline the affected bars are cleared instead. Returns true when the notes were kept.
 */
export function setTime(s: Score, i: number, time: TimeSig): boolean {
  const old = contextAt(s, i).time
  let e = i + 1
  while (e < s.measures.length && !s.measures[e].time) e++
  const oldBar = barTicks(old), newBar = barTicks(time)
  const total = (e - i) * oldBar
  const count = Math.max(1, Math.ceil(total / newBar))
  const keep = s.measures.slice(i, e)
  const nVoices = (si: number) => Math.max(1, ...keep.map((m) => m.staves[si].length))
  const fresh: Measure[] = Array.from({ length: count }, (_, k) => {
    const meta = keep[k] ? { ...keep[k], staves: [] as Ev[][][] } : { staves: [] as Ev[][][] }
    return meta as Measure
  })
  let ok = true
  s.clefs.forEach((_, si) => {
    for (let v = 0; v < nVoices(si) && ok; v++) {
      const flat: Ev[] = keep.flatMap((m) => m.staves[si][v] ?? restsFor(s, 0, oldBar, oldBar))
      const bars: Ev[][] = Array.from({ length: count }, () => [])
      let pos = 0
      for (const ev of flat) {
        const end = pos + ev.ticks
        const k = Math.floor(pos / newBar)
        if (end <= (k + 1) * newBar) { bars[k].push(ev); pos = end; continue }
        if (ev.tup) { ok = false; break } // a tuplet cannot be cut
        let at = pos, first = true
        while (at < end) { // split at every barline, then spell each piece
          const bk = Math.floor(at / newBar), stop = Math.min(end, (bk + 1) * newBar)
          const pieces = ev.pitches.length ? splitLength(at - bk * newBar, stop - at) : splitLength(at - bk * newBar, stop - at, { dots: false, bar: newBar })
          for (const [pi, len] of pieces.entries()) {
            const lastPiece = stop === end && pi === pieces.length - 1
            const tie = ev.pitches.length ? (lastPiece ? ev.tie : true) : undefined
            // the first piece keeps every mark of the note; the tied pieces after it are plain notes
            bars[bk].push(first ? { ...clone(ev), ticks: len, tie } : { id: newId(s), ticks: len, pitches: clone(ev.pitches), tie })
            first = false
          }
          at = stop
        }
        pos = end
      }
      if (!ok) break
      for (let k = 0; k < count; k++) {
        const used = bars[k].reduce((a, x) => a + x.ticks, 0)
        if (used < newBar) bars[k].push({ id: newId(s), ticks: newBar - used, pitches: [] }) // the last bar is padded
        fresh[k].staves[si] ??= []
        fresh[k].staves[si][v] = respellRests(s, bars[k], newBar, restGroups(time))
      }
    }
  })
  if (i === 0) s.time = time
  else s.measures[i].time = time
  if (!ok) {
    for (let k = i; k < e; k++) s.measures[k].staves = s.clefs.map(() => [restsFor(s, 0, newBar, newBar)])
    return false
  }
  fresh[0].time = i === 0 ? undefined : time
  s.measures.splice(i, e - i, ...fresh)
  return true
}

/** Each run of rests in a re-barred bar becomes one gap, written again in the new time (a rest the user wrote or in a tuplet stays). */
function respellRests(s: Score, events: Ev[], bar: number, groups?: RestGroups): Ev[] {
  const out: Ev[] = []
  let pos = 0, gap = 0
  const flush = () => { if (gap) out.push(...restsFor(s, pos - gap, gap, bar, groups)); gap = 0 }
  for (const e of events) {
    if (!e.pitches.length && !e.tup && !e.kept) gap += e.ticks
    else { flush(); out.push(e) }
    pos += e.ticks
  }
  flush()
  return out
}

export function setKey(s: Score, i: number, fifths: number) {
  if (i === 0) s.key = fifths
  else s.measures[i].key = fifths
}

// ---- tuplets ---------------------------------------------------------------------------------------------
export const TUPLETS: { n: number; m: number; label: string }[] = [
  { n: 3, m: 2, label: 'Bộ ba (3:2)' }, { n: 2, m: 3, label: 'Đôi (2:3)' }, { n: 4, m: 3, label: 'Bốn (4:3)' },
  { n: 5, m: 4, label: 'Năm (5:4)' }, { n: 6, m: 4, label: 'Sáu (6:4)' },
]

/**
 * Turn the space starting at `at` into `n` equal rests that count as `m` notes of written value `nominal`
 * (e.g. 480 = eighth, n=3, m=2 -> an eighth-note triplet). Returns the member ids, or [] if it does not fit.
 */
export function makeTuplet(s: Score, l: Loc, at: number, nominal: number, n = 3, m = 2): number[] {
  const bar = barTicks(contextAt(s, l.m).time)
  const span = nominal * m
  if (span % n !== 0 || at + span > bar) return []
  const group = newId(s)
  const members: Ev[] = Array.from({ length: n }, () => ({ id: newId(s), ticks: span / n, pitches: [], tup: { n, m, group } }))
  overwrite(s, l, at, span, members)
  return members.map((e) => e.id)
}

/** Put a note into an existing tuplet member (it keeps its length and its place in the group). */
export function putInTuplet(s: Score, id: number, pitch: Pitch, addToChord = false) {
  const f = findEv(s, id)
  if (!f?.ev.tup) return
  if (addToChord && f.ev.pitches.length) {
    if (!f.ev.pitches.some((p) => midiOf(p) === midiOf(pitch))) f.ev.pitches = [...f.ev.pitches, pitch].sort((a, b) => midiOf(a) - midiOf(b))
  } else f.ev.pitches = [pitch]
}

/** Dissolve a tuplet: its span becomes plain rests. */
export function removeTuplet(s: Score, id: number) {
  const f = findEv(s, id)
  if (!f?.ev.tup) return
  const events = s.measures[f.m].staves[f.staff][f.voice], st = starts(events)
  const [lo, hi] = groupSpan(events, st, f.ev.tup.group)
  putRest(s, f, lo, hi - lo)
}

// ---- marks -----------------------------------------------------------------------------------------------
export function setDyn(s: Score, id: number, dyn?: Dyn) {
  const f = findEv(s, id)
  if (f) f.ev.dyn = dyn
}
export function toggleArt(s: Score, id: number, art: Art) {
  const f = findEv(s, id)
  if (!f || !f.ev.pitches.length) return
  const has = f.ev.art?.includes(art)
  const rest = (f.ev.art ?? []).filter((a) => a !== art)
  f.ev.art = has ? (rest.length ? rest : undefined) : [...rest, art]
}
/**
 * Slur / hairpin / ottava / pedal from event `from` to event `to` (same staff and voice, `to` later). A second call on the same pair removes it.
 * A pedal or an ottava may also cover one note (`from` = `to`): put on a single picked note, then its end is dragged further.
 */
export function toggleSpan(s: Score, kind: SpanKind, from: number, to: number): boolean {
  const a = findEv(s, from), b = findEv(s, to)
  const line = kind.startsWith('pedal') || kind.startsWith('o')
  if (!a || !b || a.staff !== b.staff || a.voice !== b.voice || (a.m === b.m ? a.at > b.at : a.m > b.m) || (from === to && !line)) return false
  if (kind === 'slur') a.ev.slur = a.ev.slur === to ? undefined : to
  else if (kind === 'cresc' || kind === 'dim') a.ev.hairpin = a.ev.hairpin?.end === to && a.ev.hairpin.type === kind ? undefined : { type: kind, end: to }
  else if (kind.startsWith('pedal')) {
    const style = (kind.split('-')[1] ?? 'star') as PedalStyle
    a.ev.pedal = a.ev.pedal?.end === to && (a.ev.pedal.style ?? 'star') === style ? undefined : { end: to, ...(style === 'star' ? {} : { style }) }
  }
  else {
    const n = Number(kind.slice(1)) as 8 | -8 | 15 | -15
    keepWritten(s, () => { a.ev.ottava = a.ev.ottava?.end === to && a.ev.ottava.n === n ? undefined : { n, end: to } })
  }
  return true
}

/**
 * Let the pedal or the ottava line that starts at `from` end at event `to` instead (its end dragged there): any note of the same staff and voice
 * from `from` on, the first note itself included. False when `to` is earlier or elsewhere.
 */
export function setSpanEnd(s: Score, from: number, field: 'pedal' | 'ottava', to: number): boolean {
  const a = findEv(s, from)
  const span = a?.ev[field]
  if (!a || !span) return false
  if (span.end === to) return true
  if (field === 'pedal') { const style = a.ev.pedal!.style; return toggleSpan(s, style && style !== 'star' ? (`pedal-${style}` as SpanKind) : 'pedal', from, to) }
  return toggleSpan(s, `o${a.ev.ottava!.n}` as SpanKind, from, to) // (keepWritten: the notes it now covers or leaves keep their place on the page)
}

/**
 * Let the pedal or the ottava line that starts at `from` start at event `to` instead (its sign dragged there), still ending where it ends:
 * any note of the same staff and voice up to that end. Returns false when `to` is after the end or elsewhere.
 */
export function setSpanStart(s: Score, from: number, field: 'pedal' | 'ottava', to: number): boolean {
  const a = findEv(s, from), b = findEv(s, to), span = a?.ev[field]
  if (!a || !b || !span) return false
  if (from === to) return true
  const e = findEv(s, span.end)
  if (!e || b.staff !== a.staff || b.voice !== a.voice || (b.m === e.m ? b.at > e.at : b.m > e.m)) return false
  const move = () => { b.ev[field] = { ...span } as never; a.ev[field] = undefined }
  if (field === 'ottava') keepWritten(s, move); else move() // (the notes it now covers or leaves keep their place on the page)
  return true
}

/**
 * Put up or take down ottava lines (`change`) the way MuseScore does: the notes stay where they are on the page and what they sound moves,
 * an octave up under a new 8va, back down when it goes.
 * ponytail: only the palette goes through here; a line lost because its last note was deleted keeps the sound, the page shifts.
 */
export function keepWritten(s: Score, change: () => void) {
  const before = ottavaShifts(s)
  change()
  const after = ottavaShifts(s)
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const oct = (before.get(id) ?? 0) - (after.get(id) ?? 0), f = oct && findEv(s, id)
    if (!f) continue
    f.ev.pitches = f.ev.pitches.map((p) => ({ ...p, octave: p.octave + oct }))
    if (f.ev.graces) f.ev.graces = f.ev.graces.map((p) => ({ ...p, octave: p.octave + oct }))
  }
}

/** How many octaves an ottava line moves what is written away from what sounds (8va: written one octave lower). */
export const octShift = (n: number) => (n > 0 ? -(n === 8 ? 1 : 2) : n === -8 ? 1 : 2)

/** Octave shift (written minus sounding) that ottava lines put on every event of the score. */
export function ottavaShifts(s: Score): Map<number, number> {
  const out = new Map<number, number>()
  const nStaves = s.clefs.length
  for (let st = 0; st < nStaves; st++) for (let v = 0; v < 8; v++) {
    const evs = s.measures.flatMap((m) => m.staves[st]?.[v] ?? [])
    evs.forEach((e, i) => {
      if (!e.ottava) return
      const j = evs.findIndex((x) => x.id === e.ottava!.end)
      if (j < i) return
      for (let k = i; k <= j; k++) out.set(evs[k].id, octShift(e.ottava.n))
    })
  }
  return out
}
/** The same, for the spot where a note would be entered: bar `m`, tick `at`. */
export function ottavaShiftAt(s: Score, m: number, staff: number, voice: number, at: number): number {
  const here = s.measures[m]?.staves[staff]?.[voice] ?? []
  const st = starts(here)
  const e = here[st.findIndex((x, i) => x <= at && at < x + here[i].ticks)] ?? here[here.length - 1]
  return e ? ottavaShifts(s).get(e.id) ?? 0 : 0
}

/** Drop references to events that no longer exist (after deleting or replacing notes). */
export function pruneRefs(s: Score) {
  const ids = new Set<number>()
  s.measures.forEach((m) => m.staves.forEach((vs) => vs.forEach((v) => v.forEach((e) => ids.add(e.id)))))
  s.measures.forEach((m) => m.staves.forEach((vs) => vs.forEach((v) => v.forEach((e) => {
    if (e.slur !== undefined && !ids.has(e.slur)) e.slur = undefined
    if (e.hairpin && !ids.has(e.hairpin.end)) e.hairpin = undefined
    if (e.ottava && !ids.has(e.ottava.end)) e.ottava = undefined
    if (e.pedal && !ids.has(e.pedal.end)) e.pedal = undefined
  }))))
}

// ---- navigation (endings, D.C., D.S.) --------------------------------------------------------------------
export type Mark = 'segno' | 'coda' | 'toCoda' | 'fine'

/** Put bars `from..to` inside an ending bracket (or take them out with `undefined`). */
export function setVolta(s: Score, from: number, to: number, numbers?: number[]) {
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
    const m = s.measures[i]
    if (m) m.volta = numbers && numbers.length ? [...numbers] : undefined
  }
}
export function toggleMark(s: Score, bar: number, mark: Mark) {
  const m = s.measures[bar]
  if (m) m[mark] = m[mark] ? undefined : true
}
export function setJump(s: Score, bar: number, jump?: Measure['jump']) {
  const m = s.measures[bar]
  if (m) m.jump = jump
}
/** Things that will not play as intended (a D.S. without a segno, "al Coda" without a Coda…). */
export function navigationProblems(s: Score): string[] {
  const out: string[] = []
  const has = (k: Mark) => s.measures.some((m) => m[k])
  s.measures.forEach((m, i) => {
    if (!m.jump) return
    if (m.jump.kind === 'ds' && !has('segno')) out.push(`ô ${i + 1}: D.S. nhưng chưa có dấu Segno`)
    if (m.jump.al === 'fine' && !has('fine')) out.push(`ô ${i + 1}: "al Fine" nhưng chưa có dấu Fine`)
    if (m.jump.al === 'coda' && !(has('toCoda') && has('coda'))) out.push(`ô ${i + 1}: "al Coda" cần cả "To Coda" và Coda`)
  })
  return out
}

/** Check that every voice of every bar adds up. Returns human-readable problems (empty = fine). */
export function validate(s: Score): string[] {
  const bad: string[] = []
  s.measures.forEach((m, i) => {
    const bar = barTicks(contextAt(s, i).time)
    m.staves.forEach((vs, st) => vs.forEach((ev, v) => {
      const sum = ev.reduce((a, e) => a + e.ticks, 0)
      if (sum !== bar) bad.push(`bar ${i + 1}, staff ${st + 1}, voice ${v + 1}: ${sum}/${bar} ticks`)
      const groups = new Map<number, number[]>()
      ev.forEach((e, k) => { if (e.tup) groups.set(e.tup.group, [...(groups.get(e.tup.group) ?? []), k]) })
      groups.forEach((idx, g) => {
        const t = ev[idx[0]].tup!
        const contiguous = idx.every((k, j) => j === 0 || k === idx[j - 1] + 1)
        if (idx.length !== t.n || !contiguous) bad.push(`bar ${i + 1}, staff ${st + 1}, voice ${v + 1}: broken tuplet ${g}`)
      })
    }))
  })
  return bad
}

// ---- palette operations ----------------------------------------------------------------------------------
type EvKey = 'arp' | 'gliss' | 'trem' | 'orn' | 'breath'
/** Set a note mark, or clear it when it is already that value. */
export function toggleEv<K extends EvKey>(s: Score, id: number, key: K, value: NonNullable<Ev[K]>) {
  const f = findEv(s, id)
  if (!f || !f.ev.pitches.length) return
  f.ev[key] = f.ev[key] === value ? undefined : value
  if (key === 'arp' && f.ev.pitches.length < 2) f.ev.arp = undefined // nothing to roll
}
export function flipStem(s: Score, id: number) {
  const f = findEv(s, id)
  if (f && f.ev.pitches.length) f.ev.flip = !f.ev.flip
}

/** Add a grace note before an event, a step above its top note (change it with graceStep). */
export function addGrace(s: Score, id: number, kind: 'acc' | 'app') {
  const f = findEv(s, id)
  if (!f || !f.ev.pitches.length) return
  const top = f.ev.pitches[f.ev.pitches.length - 1]
  const { key } = contextAt(s, f.m)
  const g = fromDiatonic(diatonic(top) + 1)
  g.alter = keyAlterFor(key, g.step)
  f.ev.graces = [...(f.ev.graces ?? []), g].slice(0, 4)
  f.ev.graceKind = kind
}
/** Move grace note `i` (default: the last) up or down by a diatonic step. */
export function graceStep(s: Score, id: number, dir: 1 | -1, i?: number) {
  const f = findEv(s, id)
  if (!f?.ev.graces?.length) return
  const { key } = contextAt(s, f.m)
  const at = i ?? f.ev.graces.length - 1, n = fromDiatonic(diatonic(f.ev.graces[at]) + dir)
  n.alter = keyAlterFor(key, n.step)
  f.ev.graces[at] = n
}
/** Move grace note `i` by semitones, spelled for the key (the arrow keys on a picked grace note). */
export function transposeGrace(s: Score, id: number, i: number, semitones: number) {
  const f = findEv(s, id), g = f?.ev.graces?.[i]
  if (f && g) f.ev.graces![i] = spell(midiOf(g) + semitones, contextAt(s, f.m).key)
}
/** Give grace note `i` an accidental; asking for the one it already has puts back what the key says. */
export function setGraceAlter(s: Score, id: number, i: number, alter: number) {
  const f = findEv(s, id), g = f?.ev.graces?.[i]
  if (f && g) f.ev.graces![i] = { ...g, alter: g.alter === alter ? keyAlterFor(contextAt(s, f.m).key, g.step) : alter }
}
/** Drag a grace note: `steps` up or down the scale, and onto the note `to` (itself, or another note). Returns its place among `to`'s grace notes, or undefined when it cannot go there. */
export function moveGrace(s: Score, id: number, i: number, to: number, steps: number): number | undefined {
  const f = findEv(s, id), g = f?.ev.graces?.[i], t = findEv(s, to)
  if (!f || !g || !t?.ev.pitches.length || (to !== id && (t.ev.graces?.length ?? 0) >= 4)) return undefined
  const n = steps ? { ...fromDiatonic(diatonic(g) + steps), alter: 0 } : g
  if (steps) n.alter = keyAlterFor(contextAt(s, t.m).key, n.step)
  if (to === id) { f.ev.graces![i] = n; return i }
  const kind = f.ev.graceKind
  removeGrace(s, id, i)
  t.ev.graces = [...(t.ev.graces ?? []), n]
  t.ev.graceKind ??= kind
  return t.ev.graces.length - 1
}
/** Delete one grace note (Delete on a picked grace note); the main note stays. */
export function removeGrace(s: Score, id: number, i: number) {
  const f = findEv(s, id)
  if (!f?.ev.graces) return
  f.ev.graces.splice(i, 1)
  if (!f.ev.graces.length) clearGrace(s, id)
}
export function clearGrace(s: Score, id: number) {
  const f = findEv(s, id)
  if (f) { f.ev.graces = undefined; f.ev.graceKind = undefined }
}
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'], FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F']
export const keyAlterFor = (fifths: number, step: string) =>
  fifths > 0 ? (SHARP_ORDER.slice(0, fifths).includes(step) ? 1 : 0) : fifths < 0 ? (FLAT_ORDER.slice(0, -fifths).includes(step) ? -1 : 0) : 0

export type TextField = 'staffText' | 'expr' | 'chord' | 'lyric'
export function setText(s: Score, id: number, field: TextField, text: string) {
  const f = findEv(s, id)
  if (f) f.ev[field] = text.trim() ? text.trim() : undefined
}

/** Clef from measure `i` on, for one staff (the first bar changes the staff itself). */
export function setClef(s: Score, i: number, staff: number, clef: ClefName) {
  if (i === 0) { s.clefs[staff] = clef; if (s.measures[0].clefs) s.measures[0].clefs[staff] = undefined; return }
  const m = s.measures[i]
  m.clefs = m.clefs ? [...m.clefs] : s.clefs.map(() => undefined)
  m.clefs[staff] = clefAt(s, i - 1, staff) === clef ? undefined : clef // "change" to what is already there removes the mark
  if (m.clefs.every((c) => c === undefined)) m.clefs = undefined
}

export function setTimeSymbol(s: Score, i: number, symbol?: 'common' | 'cut') {
  const t = i === 0 ? s.time : s.measures[i].time ?? contextAt(s, i).time
  const next = { beats: t.beats, unit: t.unit, ...(symbol ? { symbol } : {}) }
  if (i === 0) s.time = next
  else s.measures[i].time = next
}

export function setTempoMark(s: Score, i: number, bpm?: number, text?: string, at = 0) {
  const m = s.measures[i]
  if (!m) return
  if (i === 0 && bpm && !at) s.tempo = bpm
  else m.tempo = bpm
  m.tempoText = text || undefined
  m.tempoAt = at > 0 ? at : undefined
}

/** Move a tempo mark (not the one at the very start of the piece) to another bar and position. Returns false when there is nothing to move. */
export function moveTempo(s: Score, from: number, to: number, at = 0): boolean {
  const a = s.measures[from], b = s.measures[to]
  if (!a || !b || (from === 0 && !a.tempoAt)) return false
  if (!a.tempo && !a.tempoText) return false
  const bar = barTicks(contextAt(s, to).time)
  const pos = Math.max(0, Math.min(bar - 1, at))
  if (to === 0 && !pos) return false // the start of the piece keeps its own tempo
  const { tempo, tempoText, tempoDy } = a
  a.tempo = undefined; a.tempoText = undefined; a.tempoAt = undefined; a.tempoDy = undefined; a.tempoDx = undefined
  b.tempo = tempo; b.tempoText = tempoText; b.tempoAt = pos > 0 ? pos : undefined; b.tempoDy = tempoDy; b.tempoDx = undefined
  return true
}

/** Nudge a tempo mark in the picture (it keeps its meaning): `dy` up / down for any mark, `dx` sideways for the one at the very start. */
export function setTempoOffset(s: Score, bar: number, dx: number, dy: number) {
  const m = s.measures[bar]
  if (!m) return
  m.tempoDy = Math.abs(dy) < 1 ? undefined : Math.max(-30, Math.min(160, Math.round(dy)))
  m.tempoDx = Math.abs(dx) < 1 ? undefined : Math.max(0, Math.min(700, Math.round(dx)))
}
export function setRehearsal(s: Score, i: number, text?: string) { const m = s.measures[i]; if (m) m.rehearsal = text?.trim() || undefined }
export function setBarline(s: Score, i: number, kind?: BarlineKind) {
  const m = s.measures[i]
  if (!m) return
  m.barline = kind && kind !== 'single' ? kind : undefined
  if (kind) m.endRepeat = false
}
export function setBreak(s: Score, i: number, kind?: 'system' | 'page' | 'section') { const m = s.measures[i]; if (m) m.break = m.break === kind ? undefined : kind }
/** The gap between the two staves of the line that runs from bar `from` to `to` (set on its first bar; 0 puts it back to the usual). */
export function setStaffGap(s: Score, from: number, to: number, extra: number) {
  for (let i = from; i <= to; i++) if (s.measures[i]) s.measures[i].staffGap = undefined
  const m = s.measures[from]
  if (m && Math.abs(extra) >= 1) m.staffGap = Math.round(Math.min(STAFF_GAP_MAX, Math.max(STAFF_GAP_MIN, extra)))
}
export const STAFF_GAP_MIN = -40, STAFF_GAP_MAX = 120
export function setStretch(s: Score, i: number, factor: number) { const m = s.measures[i]; if (m) m.stretch = Math.abs(factor - 1) < 0.01 ? undefined : Math.min(3, Math.max(0.5, factor)) }

/** "Repeat bar": copy the previous bar (every staff and voice) into bar `i`, with fresh ids. */
export function copyPrevious(s: Score, i: number) {
  if (i < 1) return
  const src = s.measures[i - 1], dst = s.measures[i]
  if (barTicks(contextAt(s, i - 1).time) !== barTicks(contextAt(s, i).time)) return
  const groups = new Map<number, number>()
  dst.staves = src.staves.map((vs) => vs.map((events) => events.map((e) => {
    const c: Ev = { ...clone(e), id: newId(s), slur: undefined, hairpin: undefined, ottava: undefined, pedal: undefined, tie: false }
    if (c.tup) { if (!groups.has(c.tup.group)) groups.set(c.tup.group, newId(s)); c.tup = { ...c.tup, group: groups.get(c.tup.group)! } }
    return c
  })))
}

// ---- moving notes and marks -----------------------------------------------------------------------------
export type MarkField = 'dyn' | 'staffText' | 'expr' | 'chord' | 'lyric' | 'hairpin' | 'pedal' | 'ottava'

/** Set how far a mark was dragged vertically from its usual place (0 puts it back). */
export function setMarkOffset(s: Score, id: number, field: MarkField, dy: number) {
  const f = findEv(s, id)
  if (!f) return
  const off = { ...f.ev.off }
  if (Math.abs(dy) < 0.5) delete off[field]; else off[field] = Math.round(dy * 10) / 10
  f.ev.off = Object.keys(off).length ? off : undefined
}

/** Move a mark (dynamic, text, chord symbol, lyric) to another note; it takes its drag offset along unless `dy` says otherwise. */
export function moveMark(s: Score, from: number, field: MarkField, to: number, dy?: number): boolean {
  const a = findEv(s, from), b = findEv(s, to)
  if (!a || !b || a.ev[field] === undefined) return false
  const carried = dy ?? a.ev.off?.[field] ?? 0
  if (from !== to) {
    ;(b.ev as unknown as Record<string, unknown>)[field] = a.ev[field]
    a.ev[field] = undefined as never
    setMarkOffset(s, from, field, 0)
  }
  setMarkOffset(s, to, field, carried)
  return true
}
export function clearMark(s: Score, id: number, field: MarkField) {
  const f = findEv(s, id)
  if (!f) return
  if (field === 'ottava') keepWritten(s, () => { f.ev.ottava = undefined }) // (the notes under it stay where they are on the page)
  else f.ev[field] = undefined as never
  setMarkOffset(s, id, field, 0)
}

/**
 * Move an event to another place: another beat, bar, staff or voice (voices stack: the same beat in voice 2 keeps voice 1).
 * `steps` moves its pitches up or down by that many diatonic steps on the way. Keeps the event's id and all its marks.
 * Returns false when it cannot be done (a tuplet member, a rest, no room).
 */
export function moveEv(s: Score, id: number, dest: Loc & { at: number }, steps = 0): boolean {
  const f = findEv(s, id)
  if (!f || !f.ev.pitches.length || f.ev.tup) return false
  const ev: Ev = clone(f.ev)
  const { key } = contextAt(s, dest.m)
  if (steps) ev.pitches = ev.pitches.map((p) => { const q = fromDiatonic(diatonic(p) + steps); q.alter = keyAlterFor(key, q.step); return q })
  const bar = barTicks(contextAt(s, dest.m).time)
  if (dest.at >= bar) return false
  const len = Math.min(ev.ticks, bar - dest.at)
  const here = voiceOf(s, dest)
  const hit = here.find((e, i) => starts(here)[i] < dest.at + len && starts(here)[i] + e.ticks > dest.at && e.tup) // do not cut into a tuplet
  if (hit && hit.id !== id) return false
  const stay = f.m === dest.m && f.staff === dest.staff && f.voice === dest.voice && f.at === dest.at
  if (!stay) { if (f.ev.tup) return false; putRest(s, f, f.at, f.ev.ticks) } // the old place becomes silence
  ev.ticks = len
  if (len !== f.ev.ticks) ev.tie = false
  overwrite(s, dest, dest.at, len, [ev])
  return true
}

// ---- copy and paste --------------------------------------------------------------------------------------
/** What the clipboard holds: for each staff+voice the events with their distance (in ticks) from the start of the copied range. */
export interface Clip { lanes: { staff: number; voice: number; items: { rel: number; ev: Ev }[] }[]; span: number }

/** Ticks from the start of the score to bar `m`, tick `at`. */
export function absOf(s: Score, m: number, at: number): number {
  let t = 0
  for (let i = 0; i < m && i < s.measures.length; i++) t += barTicks(contextAt(s, i).time)
  return t + at
}
/** The bar and the tick inside it for an absolute position (a position past the last bar answers bar `measures.length`). */
export function whereAbs(s: Score, abs: number): { m: number; at: number } {
  let t = 0
  for (let i = 0; i < s.measures.length; i++) {
    const bar = barTicks(contextAt(s, i).time)
    if (abs < t + bar) return { m: i, at: abs - t }
    t += bar
  }
  return { m: s.measures.length, at: abs - t }
}

/** Copy events (any staves, any voices) into a clip. Returns undefined when `ids` holds nothing. */
export function copyEvents(s: Score, ids: number[]): Clip | undefined {
  const found = ids.map((id) => findEv(s, id)).filter((f): f is NonNullable<ReturnType<typeof findEv>> => !!f)
  if (!found.length) return undefined
  const abs = (f: (typeof found)[number]) => absOf(s, f.m, f.at)
  const t0 = Math.min(...found.map(abs)), t1 = Math.max(...found.map((f) => abs(f) + f.ev.ticks))
  const lanes = new Map<string, Clip['lanes'][number]>()
  for (const f of found.sort((a, b) => abs(a) - abs(b))) {
    const k = `${f.staff}:${f.voice}`
    const lane = lanes.get(k) ?? { staff: f.staff, voice: f.voice, items: [] }
    lane.items.push({ rel: abs(f) - t0, ev: clone(f.ev) })
    lanes.set(k, lane)
  }
  return { lanes: [...lanes.values()], span: t1 - t0 }
}

/**
 * Paste a clip with its start at bar `dest.m`, tick `dest.at`. A clip with one lane goes to `dest.staff` / `dest.voice` when they are given,
 * otherwise every lane goes back to where it came from. Notes that run over a barline become tied pieces; a tuplet that would be cut makes
 * the paste fail. Bars are added at the end when the clip does not fit. Returns the ids of the pasted events (first pieces) and where it ended.
 */
export function pasteClip(s: Score, clip: Clip, dest: { m: number; at: number; staff?: number; voice?: number }): { ok: boolean; ids: number[]; end?: { m: number; at: number }; reason?: string } {
  const start = absOf(s, dest.m, dest.at)
  { // look before writing anything: a tuplet that a barline would cut makes the whole paste fail
    const total = absOf(s, s.measures.length, 0), lastBar = barTicks(contextAt(s, s.measures.length - 1).time)
    for (const lane of clip.lanes) for (const { rel, ev } of lane.items) {
      if (!ev.tup) continue
      const abs = start + rel
      const pos = abs < total ? whereAbs(s, abs) : { m: s.measures.length, at: (abs - total) % lastBar }
      const bar = pos.m < s.measures.length ? barTicks(contextAt(s, pos.m).time) : lastBar
      if (pos.at + ev.ticks > bar) return { ok: false, ids: [], reason: 'bộ ba bị cắt ngang bởi vạch nhịp' }
    }
  }
  const map = new Map<number, number>()
  const pasted: Ev[] = []
  const single = clip.lanes.length === 1
  for (const lane of clip.lanes) {
    const staff = single && dest.staff !== undefined ? dest.staff : lane.staff
    const voice = single && dest.voice !== undefined ? dest.voice : lane.voice
    if (staff >= s.clefs.length) return { ok: false, ids: [], reason: 'khuông đích không có' }
    const groups = new Map<number, number>()
    for (const { rel, ev } of lane.items) {
      let pos = whereAbs(s, start + rel)
      while (pos.m >= s.measures.length) { insertMeasure(s, s.measures.length - 1); pos = whereAbs(s, start + rel) }
      const bar = barTicks(contextAt(s, pos.m).time)
      if (ev.tup && pos.at + ev.ticks > bar) return { ok: false, ids: [], reason: 'bộ ba bị cắt ngang bởi vạch nhịp' }
      let left = ev.ticks, m = pos.m, at = pos.at, first = true
      while (left > 0) {
        while (m >= s.measures.length) insertMeasure(s, s.measures.length - 1)
        const room = barTicks(contextAt(s, m).time) - at, len = Math.min(left, room)
        const piece: Ev = first ? { ...clone(ev), id: newId(s), ticks: len } : { id: newId(s), ticks: len, pitches: clone(ev.pitches) }
        if (first && ev.tup) { if (!groups.has(ev.tup.group)) groups.set(ev.tup.group, newId(s)); piece.tup = { ...ev.tup, group: groups.get(ev.tup.group)! } }
        const rest = left - len
        if (piece.pitches.length) piece.tie = rest > 0 ? true : first ? ev.tie : ev.tie
        if (first) { map.set(ev.id, piece.id); pasted.push(piece) }
        overwrite(s, { m, staff, voice }, at, len, [piece])
        left = rest; m++; at = 0; first = false
      }
    }
  }
  // spans (slurs, hairpins, ottava, pedal) keep working inside the pasted music, and are dropped where their end was not copied
  const ids = new Set(map.keys())
  for (const piece of pasted) {
    const f = findEv(s, piece.id)
    if (!f) continue
    const e = f.ev
    if (e.slur !== undefined) e.slur = ids.has(e.slur) ? map.get(e.slur) : undefined
    if (e.hairpin) e.hairpin = ids.has(e.hairpin.end) ? { ...e.hairpin, end: map.get(e.hairpin.end)! } : undefined
    if (e.ottava) e.ottava = ids.has(e.ottava.end) ? { ...e.ottava, end: map.get(e.ottava.end)! } : undefined
    if (e.pedal) e.pedal = ids.has(e.pedal.end) ? { end: map.get(e.pedal.end)! } : undefined
  }
  return { ok: true, ids: pasted.map((p) => p.id), end: whereAbs(s, start + clip.span) }
}

/** Every event of the score, in reading order (for Select all). */
export const allEventIds = (s: Score) => s.measures.flatMap((m) => m.staves.flatMap((vs) => vs.flatMap((v) => v.map((e) => e.id))))

/** One score from several (the movements of a sonata): each one starts where the one before ended, with its own key, time signature and tempo. */
export function joinScores(parts: Score[]): Score {
  const [first, ...rest] = structuredClone(parts)
  for (const p of rest) {
    const off = first.nextId
    for (const m of p.measures) for (const st of m.staves) for (const v of st) for (const e of v) {
      e.id += off
      if (e.slur !== undefined) e.slur += off
      if (e.hairpin) e.hairpin.end += off
      if (e.ottava) e.ottava.end += off
      if (e.pedal) e.pedal.end += off
    }
    first.nextId += p.nextId
    const last = first.measures[first.measures.length - 1]
    if (last && !last.endRepeat) last.barline = 'final'
    p.measures[0] = { ...p.measures[0], time: p.time, key: p.key, tempo: p.tempo, clefs: p.clefs }
    first.measures.push(...p.measures)
  }
  return first
}
