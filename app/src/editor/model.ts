// Notation-level score model: what a composer edits (note values, voices, ties), not what a player hears.

export const TPQ = 960 // ticks per quarter note: every value down to a 64th (60) and dotted ones is an integer
export type StepName = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'
export interface Pitch { step: StepName; alter: number; octave: number } // alter: -2 bb .. +2 x

/** `n` notes in the time of `m` (3:2 = triplet). Members share a group id and sit side by side. */
export interface Tup { n: number; m: number; group: number }
export type Dyn = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff'
export type Art = 'staccato' | 'accent' | 'tenuto' | 'marcato' | 'fermata'

/** A note, chord (several pitches) or rest (no pitches). */
export interface Ev {
  id: number
  ticks: number
  pitches: Pitch[]  // sorted low -> high; empty = rest
  tie?: boolean     // tied to the next event with the same pitches
  tup?: Tup         // part of a tuplet: `ticks` is the real length, the written value is ticks*n/m
  dyn?: Dyn         // dynamic marking from this event on
  hairpin?: { type: 'cresc' | 'dim'; end: number } // wedge from this event to the event with id `end`
  slur?: number     // slur from this event to the event with id `end`
  art?: Art[]       // articulations
  hidden?: boolean  // a rest that keeps the bar full but is not printed (as in printed scores)
  orn?: 'mordent' | 'inverted'  // ornament sign over the (top) note; played as main / neighbour / main
  graces?: Pitch[]  // small notes before this one, played quickly just before the main note
}

export interface TimeSig { beats: number; unit: number }

export interface Measure {
  staves: Ev[][][]        // [staff][voice] -> events in order; every voice fills the bar exactly
  time?: TimeSig          // set when it changes here
  key?: number            // fifths (-7..7), set when it changes here
  tempo?: number          // quarter notes per minute, set when it changes here
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
  clefs: ('treble' | 'bass')[]  // one per staff
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
 * Split `ticks` starting at `at` (within a bar) into writable lengths that respect the beat grid
 * (no half note across beat 2). Fewest pieces wins. Rests pass `dots: false` (engraving avoids dotted rests)
 * and `bar`, so a whole empty bar stays a single whole-measure rest.
 */
export function splitLength(at: number, ticks: number, opts: { dots?: boolean; bar?: number } = {}): number[] {
  const { dots = true, bar } = opts
  if (bar !== undefined && at === 0 && ticks === bar) return [ticks]
  const U = TPQ / 16 // one 64th
  if (at % U || ticks % U) return [ticks] // finer than a 64th: leave as is
  const options: { len: number; unit: number; cost: number }[] = []
  for (const v of VALUES) for (let d = 0; d <= (dots ? 2 : 0); d++) {
    const len = (v.ticks * (2 - 0.5 ** d)) / U
    if (Number.isInteger(len)) options.push({ len, unit: v.ticks / U, cost: 1 + 0.3 * d }) // fewest pieces, then fewest dots
  }
  options.sort((x, y) => y.len - x.len)
  const end = (at + ticks) / U, memo = new Map<number, { n: number; len: number }>()
  const best = (pos: number): { n: number; len: number } => {
    if (pos === end) return { n: 0, len: 0 }
    const hit = memo.get(pos)
    if (hit) return hit
    let r = { n: Infinity, len: 0 }
    for (const o of options) {
      if (pos + o.len > end || pos % o.unit) continue
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

function restsFor(s: Score, at: number, ticks: number, bar: number): Ev[] {
  return splitLength(at, ticks, { dots: false, bar }).map((t) => ({ id: newId(s), ticks: t, pitches: [] }))
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
    if (m.tempo) tempo = m.tempo
  }
  return { time, key, tempo }
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
  const bar = barTicks(contextAt(s, l.m).time)
  // a tuplet is all or nothing: touching one member replaces the whole group (what the new content leaves free becomes rests)
  {
    const st = starts(events)
    let lo = at, hi = Math.min(bar, at + ticks)
    events.forEach((e, i) => { if (e.tup && st[i] < hi && st[i] + e.ticks > lo) { lo = Math.min(lo, groupSpan(events, st, e.tup.group)[0]); hi = Math.max(hi, groupSpan(events, st, e.tup.group)[1]) } })
    if (lo !== at || hi !== at + ticks) {
      const tail = hi - (lo + ticks)
      content = tail > 0 ? [...content, ...restsFor(s, lo + ticks, tail, bar)] : content
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
      if (t < at) out.push(...(e.pitches.length ? [{ ...e, ticks: at - t, tie: false }] : restsFor(s, t, at - t, bar)))  // head of a cut note stays
      place()
      if (eEnd > end) out.push(...restsFor(s, end, eEnd - end, bar)) // tail becomes rests
    }
    t = eEnd
  }
  place()
  // rebuild so lengths are consistent and rests are re-spelled on the beat grid
  const fixed: Ev[] = []
  let pos = 0
  for (const e of out) {
    if (!e.pitches.length && !e.tup) {
      for (const len of splitLength(pos, e.ticks, { dots: false, bar })) { fixed.push({ ...e, id: fixed.length ? newId(s) : e.id, ticks: len }); pos += len }
    } else { fixed.push(e); pos += e.ticks }
  }
  // merge neighbouring rests that came from the same cut (e.g. two eighth rests that are really a quarter on the beat)
  const merged: Ev[] = []
  pos = 0
  for (const e of fixed) {
    const prev = merged[merged.length - 1]
    if (!e.pitches.length && prev && !prev.pitches.length && !e.tup && !prev.tup) {
      const startPrev = pos - prev.ticks, ok = splitLength(startPrev, prev.ticks + e.ticks, { dots: false, bar })
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

/** Put a note (or add it to the chord that already starts here with the same length). Returns the new event's id. */
export function putNote(s: Score, l: Loc, at: number, ticks: number, pitch: Pitch, addToChord = false): number {
  const events = voiceOf(s, l)
  const idx = starts(events).indexOf(at)
  if (addToChord && idx >= 0 && events[idx].pitches.length && events[idx].ticks === ticks) {
    const e = events[idx]
    if (!e.pitches.some((p) => midiOf(p) === midiOf(pitch))) {
      e.pitches.push(pitch)
      e.pitches.sort((a, b) => midiOf(a) - midiOf(b))
    }
    return e.id
  }
  const bar = barTicks(contextAt(s, l.m).time)
  const len = Math.min(ticks, bar - at)
  const ev: Ev = { id: newId(s), ticks: len, pitches: [pitch] }
  overwrite(s, l, at, len, [ev])
  return ev.id
}

/** Replace what is at [at, at+ticks) with a rest. */
export function putRest(s: Score, l: Loc, at: number, ticks: number) {
  const bar = barTicks(contextAt(s, l.m).time)
  const len = Math.min(ticks, bar - at)
  overwrite(s, l, at, len, restsFor(s, at, len, bar))
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

export function setAlter(s: Score, id: number, alter: number) {
  const f = findEv(s, id)
  if (!f) return
  f.ev.pitches = f.ev.pitches.map((p) => ({ ...p, alter }))
}

/** Change the length of an event: the next events are overwritten, a shorter length leaves rests. */
export function setLength(s: Score, id: number, ticks: number) {
  const f = findEv(s, id)
  if (!f) return
  const bar = barTicks(contextAt(s, f.m).time)
  const len = Math.min(ticks, bar - f.at)
  const ev: Ev = { ...f.ev, pitches: [...f.ev.pitches], ticks: len, tup: undefined } // a re-timed note leaves its tuplet
  overwrite(s, f, f.at, len, f.ev.pitches.length ? [ev] : restsFor(s, f.at, len, bar))
}

export function toggleTie(s: Score, id: number) {
  const f = findEv(s, id)
  if (f && f.ev.pitches.length) f.ev.tie = !f.ev.tie
}

export function insertMeasure(s: Score, after: number) {
  s.measures.splice(after + 1, 0, blankMeasure(s, contextAt(s, after).time))
}

export function deleteMeasure(s: Score, i: number) {
  if (s.measures.length > 1) s.measures.splice(i, 1)
}

/** Change the time signature from measure `i` on: the bars there are re-filled with rests. (ponytail: notes in those bars are cleared) */
export function setTime(s: Score, i: number, time: TimeSig) {
  if (i === 0) s.time = time
  else s.measures[i].time = time
  for (let k = i; k < s.measures.length; k++) {
    if (k > i && s.measures[k].time) break
    s.measures[k].staves = s.clefs.map(() => [restsFor(s, 0, barTicks(time), barTicks(time))])
  }
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
/** Slur / hairpin from event `from` to event `to` (same staff and voice, `to` later). A second call on the same pair removes it. */
export function toggleSpan(s: Score, kind: 'slur' | 'cresc' | 'dim', from: number, to: number): boolean {
  const a = findEv(s, from), b = findEv(s, to)
  if (!a || !b || a.staff !== b.staff || a.voice !== b.voice || (a.m === b.m ? a.at >= b.at : a.m > b.m) || from === to) return false
  if (kind === 'slur') a.ev.slur = a.ev.slur === to ? undefined : to
  else a.ev.hairpin = a.ev.hairpin?.end === to && a.ev.hairpin.type === kind ? undefined : { type: kind, end: to }
  return true
}

/** Drop references to events that no longer exist (after deleting or replacing notes). */
export function pruneRefs(s: Score) {
  const ids = new Set<number>()
  s.measures.forEach((m) => m.staves.forEach((vs) => vs.forEach((v) => v.forEach((e) => ids.add(e.id)))))
  s.measures.forEach((m) => m.staves.forEach((vs) => vs.forEach((v) => v.forEach((e) => {
    if (e.slur !== undefined && !ids.has(e.slur)) e.slur = undefined
    if (e.hairpin && !ids.has(e.hairpin.end)) e.hairpin = undefined
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
