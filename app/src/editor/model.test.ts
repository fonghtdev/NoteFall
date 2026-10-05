import { describe, expect, it } from 'vitest'
import { TPQ, deleteEv, emptyScore, findEv, insertMeasure, midiOf, notationOf, putNote, putRest, setKey, setLength, setTime, spell, splitLength, starts, toggleTie, transpose, validate, barTicks, type Pitch, type Score } from './model'

const P = (step: Pitch['step'], octave: number, alter = 0): Pitch => ({ step, octave, alter })
const L = { m: 0, staff: 0, voice: 0 }
const shape = (s: Score, m = 0, staff = 0, voice = 0) =>
  s.measures[m].staves[staff][voice].map((e) => `${e.pitches.length ? e.pitches.map((p) => p.step + p.octave).join('+') : 'r'}:${e.ticks / TPQ}`).join(' ')

describe('lengths', () => {
  it('names plain and dotted values, refuses odd ones', () => {
    expect(notationOf(TPQ)).toEqual({ name: 'q', dots: 0 })
    expect(notationOf(1.5 * TPQ)).toEqual({ name: 'q', dots: 1 })
    expect(notationOf(1.75 * TPQ)).toEqual({ name: 'q', dots: 2 })
    expect(notationOf(5 * TPQ)).toBeNull()
  })
  it('splits on the beat grid', () => {
    expect(splitLength(0, 3 * TPQ)).toEqual([3 * TPQ])                 // dotted half from the bar start (notes may be dotted)
    expect(splitLength(0, 3 * TPQ, { dots: false })).toEqual([2 * TPQ, TPQ]) // rests are not dotted
    expect(splitLength(TPQ, 2 * TPQ)).toEqual([TPQ, TPQ])              // never a half note starting on beat 2
    expect(splitLength(0, 4 * TPQ)).toEqual([4 * TPQ])
    expect(splitLength(TPQ / 2, TPQ)).toEqual([TPQ / 2, TPQ / 2])      // a quarter may not start off the beat
    expect(splitLength(TPQ, 3 * TPQ, { dots: false })).toEqual([TPQ, 2 * TPQ])
    expect(splitLength(0, 3 * TPQ, { dots: false, bar: 3 * TPQ })).toEqual([3 * TPQ]) // an empty bar is one whole-measure rest
  })
  it('spells by key', () => {
    expect(spell(61, 0)).toEqual(P('C', 4, 1))
    expect(spell(61, -3)).toEqual(P('D', 4, -1))
    expect(midiOf(P('A', 4))).toBe(69)
  })
})

describe('editing', () => {
  it('a new bar is one whole rest (3/4: a dotted half)', () => {
    expect(shape(emptyScore(1))).toBe('r:4')
    expect(shape(emptyScore(1, { beats: 3, unit: 4 }))).toBe('r:3')
  })

  it('puts a note over a rest and keeps the bar full', () => {
    const s = emptyScore(1)
    putNote(s, L, 0, TPQ, P('C', 4))
    expect(shape(s)).toBe('C4:1 r:1 r:2')
  })

  it('rests after a quarter are spelled on the beat grid', () => {
    const s = emptyScore(1)
    putNote(s, L, 0, TPQ, P('C', 4))
    expect(s.measures[0].staves[0][0].map((e) => e.ticks / TPQ)).toEqual([1, 1, 2]) // C4, quarter rest, half rest
    expect(validate(s)).toEqual([])
  })

  it('overwriting the middle of a long note cuts it', () => {
    const s = emptyScore(1)
    putNote(s, L, 0, 4 * TPQ, P('C', 4))
    putNote(s, L, TPQ, TPQ, P('E', 4))
    expect(shape(s)).toBe('C4:1 E4:1 r:2')
    expect(validate(s)).toEqual([])
  })

  it('a note longer than the bar is clamped', () => {
    const s = emptyScore(1)
    putNote(s, L, 3 * TPQ, 4 * TPQ, P('C', 4))
    expect(shape(s)).toBe('r:2 r:1 C4:1')
  })

  it('adds notes to a chord only when length and start agree', () => {
    const s = emptyScore(1)
    putNote(s, L, 0, TPQ, P('C', 4))
    putNote(s, L, 0, TPQ, P('E', 4), true)
    putNote(s, L, 0, TPQ, P('G', 4), true)
    expect(shape(s).startsWith('C4+E4+G4:1')).toBe(true)
    putNote(s, L, 0, TPQ / 2, P('A', 4), true) // different length: replaces instead
    expect(shape(s).startsWith('A4:0.5')).toBe(true)
  })

  it('deleting a note leaves a rest', () => {
    const s = emptyScore(1)
    const id = putNote(s, L, 0, 2 * TPQ, P('C', 4))
    deleteEv(s, id)
    expect(shape(s)).toBe('r:4')
  })

  it('changes length, transposes, ties', () => {
    const s = emptyScore(1)
    const id = putNote(s, L, 0, TPQ, P('C', 4))
    setLength(s, id, 2 * TPQ)
    expect(shape(s)).toBe('C4:2 r:2')
    transpose(s, id, 1)
    expect(findEv(s, id)!.ev.pitches[0]).toEqual(P('C', 4, 1))
    toggleTie(s, id)
    expect(findEv(s, id)!.ev.tie).toBe(true)
  })

  it('tie writes the next note when there is only a rest, and ties on to an existing equal one', () => {
    const s = emptyScore(1)
    const id = putNote(s, L, 0, TPQ, P('C', 4))
    const next = toggleTie(s, id)!
    expect(shape(s)).toBe('C4:1 C4:1 r:2')
    expect(findEv(s, id)!.ev.tie).toBe(true)
    expect(findEv(s, next)!.at).toBe(TPQ)
    toggleTie(s, id)                                   // again: untied, the written note stays
    expect(findEv(s, id)!.ev.tie).toBe(false)
    expect(toggleTie(s, id)).toBe(next)                // now it just ties to the note that is there
    expect(shape(s)).toBe('C4:1 C4:1 r:2')
  })

  it('tie goes over the barline, adds a bar at the end, and leaves a different next note alone', () => {
    const s = emptyScore(1)
    const id = putNote(s, L, 3 * TPQ, TPQ, P('G', 4))
    const to = toggleTie(s, id)!
    expect(s.measures).toHaveLength(2)
    expect(findEv(s, to)).toMatchObject({ m: 1, at: 0 })
    const t = emptyScore(1)
    const a = putNote(t, L, 0, TPQ, P('C', 4)), b = putNote(t, L, TPQ, TPQ, P('D', 4))
    expect(toggleTie(t, a)).toBeUndefined()
    expect(findEv(t, a)!.ev.tie).toBeFalsy()
    expect(findEv(t, b)!.ev.pitches[0]).toEqual(P('D', 4))
  })

  it('time signature change re-bars the music and keeps the notes', () => {
    const s = emptyScore(3)
    putNote(s, { m: 1, staff: 0, voice: 0 }, 0, TPQ, P('C', 4))
    putNote(s, { m: 1, staff: 0, voice: 0 }, 3 * TPQ, TPQ, P('D', 4))      // last beat of bar 2
    expect(setTime(s, 1, { beats: 3, unit: 4 })).toBe(true)
    expect(validate(s)).toEqual([])
    expect(s.measures[1].time).toEqual({ beats: 3, unit: 4 })
    expect(shape(s, 0)).toBe('r:4')
    const notes = s.measures.flatMap((m) => m.staves[0][0]).filter((e) => e.pitches.length)
    expect(notes.map((e) => `${e.pitches[0].step}${e.ticks / TPQ}`)).toEqual(['C1', 'D1'])
    expect(s.measures.length).toBe(1 + Math.ceil(8 / 3)) // 8 beats now take 3 bars of 3/4
  })

  it('a note that crosses a new barline becomes tied pieces', () => {
    const s = emptyScore(2)
    putNote(s, { m: 0, staff: 0, voice: 0 }, 2 * TPQ, 2 * TPQ, P('G', 4))   // half note on beats 3-4
    setTime(s, 0, { beats: 3, unit: 4 })                                    // bars of 3: the half note spans beat 3 | beat 1
    expect(validate(s)).toEqual([])
    const g = s.measures.flatMap((m) => m.staves[0][0]).filter((e) => e.pitches.length)
    expect(g.map((e) => [e.ticks / TPQ, !!e.tie])).toEqual([[1, true], [1, false]])
  })

  it('a tuplet that would be cut makes the bars clear instead', () => {
    const s = emptyScore(2)
    makeTuplet(s, { m: 0, staff: 0, voice: 0 }, 2 * TPQ, TPQ / 2)              // triplet of eighths on beat 3
    expect(setTime(s, 0, { beats: 2, unit: 4 })).toBe(true)                    // fits inside bar 2 of 2/4: fine
    const t = emptyScore(2)
    makeTuplet(t, { m: 0, staff: 0, voice: 0 }, 2 * TPQ, TPQ / 2 * 2)          // a quarter-note triplet over beats 3-4
    expect(setTime(t, 0, { beats: 3, unit: 4 })).toBe(false)                   // would cross the new barline
    expect(validate(t)).toEqual([])
  })

  it('inserts bars and sets the key', () => {
    const s = emptyScore(2)
    insertMeasure(s, 0)
    expect(s.measures).toHaveLength(3)
    setKey(s, 0, 1)
    expect(s.key).toBe(1)
  })

  it('a second voice starts as rests and is independent', () => {
    const s = emptyScore(1)
    putNote(s, { m: 0, staff: 0, voice: 1 }, 0, 2 * TPQ, P('G', 3))
    expect(shape(s, 0, 0, 1)).toBe('G3:2 r:2')
    expect(shape(s, 0, 0, 0)).toBe('r:4')
    expect(validate(s)).toEqual([])
  })
})

describe('property: any sequence of edits keeps every bar full', () => {
  it('fuzz', () => {
    let seed = 1
    const rnd = (n: number) => ((seed = (seed * 16807) % 2147483647) % n)
    for (let round = 0; round < 40; round++) {
      const s = emptyScore(3, round % 2 ? { beats: 3, unit: 4 } : { beats: 4, unit: 4 })
      const durations = [TPQ / 4, TPQ / 2, TPQ, 1.5 * TPQ, 2 * TPQ, 3 * TPQ, 4 * TPQ]
      for (let step = 0; step < 60; step++) {
        const m = rnd(3), staff = rnd(2), voice = rnd(2)
        const bar = barTicks(s.time)
        const at = rnd(bar / (TPQ / 4)) * (TPQ / 4)
        const op = rnd(6)
        const loc = { m, staff, voice }
        if (op <= 2) putNote(s, loc, at, durations[rnd(durations.length)], P('C', 3 + rnd(3)), rnd(2) === 1)
        else if (op === 3) putRest(s, loc, at, durations[rnd(durations.length)])
        else {
          const evs = s.measures[m].staves[staff][voice] ?? []
          const e = evs[rnd(Math.max(1, evs.length))]
          if (e) { if (op === 4) deleteEv(s, e.id); else setLength(s, e.id, durations[rnd(durations.length)]) }
        }
        expect(validate(s), `round ${round} step ${step}`).toEqual([])
      }
      // events never overlap and starts are increasing
      for (const m of s.measures) for (const vs of m.staves) for (const ev of vs) {
        const st = starts(ev)
        expect(st).toEqual([...st].sort((a, b) => a - b))
      }
    }
  })
})

import { navigationProblems, setJump, setVolta, toggleMark, TUPLETS, makeTuplet, nominalTicks, putInTuplet, removeTuplet, setDyn, toggleArt, toggleSpan, pruneRefs } from './model'

describe('tuplets', () => {
  it('a triplet of eighths fills one beat with three notes written as eighths', () => {
    const s = emptyScore(1)
    const ids = makeTuplet(s, L, 0, TPQ / 2)
    expect(ids).toHaveLength(3)
    const evs = s.measures[0].staves[0][0]
    expect(evs.slice(0, 3).map((e) => e.ticks)).toEqual([320, 320, 320])
    expect(evs.slice(0, 3).map(nominalTicks)).toEqual([480, 480, 480])
    expect(evs.slice(3).map((e) => e.ticks / TPQ)).toEqual([1, 2])   // rest of the bar: quarter + half
    expect(validate(s)).toEqual([])
  })

  it('notes go into the members and keep the shape', () => {
    const s = emptyScore(1)
    const ids = makeTuplet(s, L, TPQ, TPQ / 2)                      // second beat
    putInTuplet(s, ids[0], P('C', 5)); putInTuplet(s, ids[1], P('D', 5)); putInTuplet(s, ids[2], P('E', 5))
    const third = 320 / TPQ
    expect(shape(s)).toBe(`r:1 C5:${third} D5:${third} E5:${third} r:2`)
    deleteEv(s, ids[1])
    expect(findEv(s, ids[1])!.ev.pitches).toEqual([])
    expect(findEv(s, ids[1])!.ev.tup).toBeDefined()                  // still part of the triplet
    expect(validate(s)).toEqual([])
  })

  it('writing over part of a tuplet replaces the whole group', () => {
    const s = emptyScore(1)
    makeTuplet(s, L, 0, TPQ / 2)
    putNote(s, L, 320, TPQ / 2, P('G', 4))                           // lands inside the triplet
    expect(s.measures[0].staves[0][0].some((e) => e.tup)).toBe(false)
    expect(validate(s)).toEqual([])
    expect(shape(s).startsWith('G4:0.5')).toBe(true)                 // moved back to the start of the group
  })

  it('removing a tuplet leaves plain rests; quintuplets and sextuplets fit a beat', () => {
    const s = emptyScore(1)
    const ids = makeTuplet(s, L, 0, TPQ / 4, 5, 4)                    // 5 sixteenths in the time of 4
    expect(ids).toHaveLength(5)
    removeTuplet(s, ids[0])
    expect(s.measures[0].staves[0][0].some((e) => e.tup)).toBe(false)
    expect(makeTuplet(s, L, 0, TPQ / 4, 6, 4)).toHaveLength(6)
    expect(validate(s)).toEqual([])
    expect(makeTuplet(s, L, 3 * TPQ + 600, TPQ, 3, 2)).toEqual([])   // does not fit the bar
  })

  it('marks and spans', () => {
    const s = emptyScore(1)
    const a = putNote(s, L, 0, TPQ, P('C', 4)), b = putNote(s, L, TPQ, TPQ, P('D', 4))
    setDyn(s, a, 'mf'); toggleArt(s, a, 'staccato'); toggleArt(s, a, 'accent'); toggleArt(s, a, 'staccato')
    expect(findEv(s, a)!.ev.dyn).toBe('mf')
    expect(findEv(s, a)!.ev.art).toEqual(['accent'])
    expect(toggleSpan(s, 'slur', a, b)).toBe(true)
    expect(findEv(s, a)!.ev.slur).toBe(b)
    expect(toggleSpan(s, 'slur', b, a)).toBe(false)                   // wrong direction
    toggleSpan(s, 'cresc', a, b)
    expect(findEv(s, a)!.ev.hairpin).toEqual({ type: 'cresc', end: b })
    deleteEv(s, b)                                                    // b becomes a rest, a new rest has a new id
    putNote(s, L, TPQ, TPQ, P('E', 4))
    pruneRefs(s)
    expect(findEv(s, a)!.ev.slur).toBeUndefined()
    expect(TUPLETS.length).toBeGreaterThan(3)
  })

  it('fuzz with tuplets: every bar stays full and every tuplet whole', () => {
    let seed = 7
    const rnd = (n: number) => ((seed = (seed * 16807) % 2147483647) % n)
    for (let round = 0; round < 40; round++) {
      const s = emptyScore(2, { beats: 4, unit: 4 })
      for (let step = 0; step < 60; step++) {
        const loc = { m: rnd(2), staff: rnd(2), voice: rnd(2) }
        const at = rnd(16) * (TPQ / 4)
        const op = rnd(6)
        if (op === 0) { const t = TUPLETS[rnd(TUPLETS.length)]; makeTuplet(s, loc, at, [TPQ / 4, TPQ / 2, TPQ][rnd(3)], t.n, t.m) }
        else if (op === 1) { const evs = s.measures[loc.m].staves[loc.staff][loc.voice] ?? []; const e = evs.filter((x) => x.tup)[0]; if (e) putInTuplet(s, e.id, P('C', 4 + rnd(2))) }
        else if (op === 2) putNote(s, loc, at, [TPQ / 4, TPQ / 2, TPQ, 2 * TPQ][rnd(4)], P('D', 4), rnd(2) === 1)
        else if (op === 3) putRest(s, loc, at, [TPQ / 2, TPQ, 2 * TPQ][rnd(3)])
        else if (op === 4) { const evs = s.measures[loc.m].staves[loc.staff][loc.voice] ?? []; const e = evs[rnd(Math.max(1, evs.length))]; if (e) deleteEv(s, e.id) }
        else { const evs = s.measures[loc.m].staves[loc.staff][loc.voice] ?? []; const e = evs[rnd(Math.max(1, evs.length))]; if (e) setLength(s, e.id, [TPQ / 2, TPQ, 2 * TPQ][rnd(3)]) }
        expect(validate(s), `round ${round} step ${step} op ${op}`).toEqual([])
      }
    }
  })
})

describe('navigation', () => {
  it('sets endings over a range of bars and clears them', () => {
    const s = emptyScore(5)
    setVolta(s, 3, 2, [1])           // order does not matter
    expect(s.measures.map((m) => m.volta)).toEqual([undefined, undefined, [1], [1], undefined])
    setVolta(s, 2, 3, undefined)
    expect(s.measures.every((m) => !m.volta)).toBe(true)
  })

  it('toggles marks and sets a jump', () => {
    const s = emptyScore(3)
    toggleMark(s, 1, 'segno'); expect(s.measures[1].segno).toBe(true)
    toggleMark(s, 1, 'segno'); expect(s.measures[1].segno).toBeUndefined()
    setJump(s, 2, { kind: 'dc', al: 'fine' })
    expect(s.measures[2].jump).toEqual({ kind: 'dc', al: 'fine' })
  })

  it('warns about jumps that cannot work', () => {
    const s = emptyScore(4)
    setJump(s, 3, { kind: 'ds', al: 'coda' })
    expect(navigationProblems(s)).toHaveLength(2)          // no segno, and no To Coda / Coda
    toggleMark(s, 0, 'segno'); toggleMark(s, 1, 'toCoda'); toggleMark(s, 2, 'coda')
    expect(navigationProblems(s)).toEqual([])
    setJump(s, 3, { kind: 'dc', al: 'fine' })
    expect(navigationProblems(s)).toHaveLength(1)          // al Fine without a Fine
  })
})

import { clearMark, moveMark, setMarkOffset } from './model'
describe('dragged marks keep their place', () => {
  const two = () => {
    const s = emptyScore(1, { beats: 4, unit: 4 }, 0)
    const a = putNote(s, { m: 0, staff: 0, voice: 0 }, 0, TPQ, P('C', 0, 5)), b = putNote(s, { m: 0, staff: 0, voice: 0 }, TPQ, TPQ, P('D', 0, 5))
    findEv(s, a)!.ev.dyn = 'p'
    return { s, a, b }
  }
  it('an offset is stored, rounded, and 0 puts the mark back', () => {
    const { s, a } = two()
    setMarkOffset(s, a, 'dyn', 17.26); expect(findEv(s, a)!.ev.off).toEqual({ dyn: 17.3 })
    setMarkOffset(s, a, 'dyn', 0.2); expect(findEv(s, a)!.ev.off).toBeUndefined()
  })
  it('moving a mark to another note takes its offset along, or sets a new one', () => {
    const { s, a, b } = two()
    setMarkOffset(s, a, 'dyn', 12)
    moveMark(s, a, 'dyn', b)
    expect([findEv(s, a)!.ev.dyn, findEv(s, a)!.ev.off, findEv(s, b)!.ev.dyn, findEv(s, b)!.ev.off?.dyn]).toEqual([undefined, undefined, 'p', 12])
    moveMark(s, b, 'dyn', b, -8)
    expect(findEv(s, b)!.ev.off?.dyn).toBe(-8)
  })
  it('deleting a mark forgets its offset', () => {
    const { s, a } = two()
    setMarkOffset(s, a, 'dyn', 12); clearMark(s, a, 'dyn')
    expect(findEv(s, a)!.ev.dyn === undefined && findEv(s, a)!.ev.off === undefined).toBe(true)
  })
})

import { contextAt, deleteMeasures, insertMeasures, toggleKeep } from './model'
describe('inserting and removing several bars', () => {
  const piece = (n: number) => { const s = emptyScore(n, { beats: 4, unit: 4 }, 0); putNote(s, { m: 1, staff: 0, voice: 0 }, 0, TPQ, P('C', 0, 5)); return s }
  it('inserts empty bars at the start, in the middle and at the end, keeping the music where it was', () => {
    const s = piece(3), mark = s.measures[1]
    insertMeasures(s, 0, 2); expect(s.measures.length).toBe(5); expect(s.measures[3]).toBe(mark)
    insertMeasures(s, 4, 3); expect(s.measures.length).toBe(8); expect(s.measures[3]).toBe(mark)
    insertMeasures(s, 8, 1); expect(s.measures.length).toBe(9)
    expect(validate(s)).toEqual([])
  })
  it('new bars take the time signature in force where they go in', () => {
    const s = piece(3); setTime(s, 1, { beats: 3, unit: 4 })
    insertMeasures(s, 2, 1)
    expect(barTicks(contextAt(s, 2).time)).toBe(3 * TPQ)
    expect(validate(s)).toEqual([])
  })
  it('removes a run of bars but always leaves one', () => {
    const s = piece(4); deleteMeasures(s, 1, 2); expect(s.measures.length).toBe(2)
    deleteMeasures(s, 0, 5); expect(s.measures.length).toBe(2) // would leave none: refused
  })
  it('keep-together marks the bars before the last one and releases them on the second call', () => {
    const s = piece(4)
    toggleKeep(s, 0, 2); expect(s.measures.map((m) => !!m.keep)).toEqual([true, true, false, false])
    toggleKeep(s, 0, 2); expect(s.measures.map((m) => !!m.keep)).toEqual([false, false, false, false])
  })
})
