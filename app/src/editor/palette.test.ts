import { describe, expect, it } from 'vitest'
import { palette, fromText, pitch } from './demo'
import { TPQ, addGrace, clefAt, copyPrevious, flipStem, graceStep, octShift, ottavaShiftAt, ottavaShifts, setBarline, setBreak, setClef, setStretch, setTempoMark, setText, toggleEv, toggleSpan, validate } from './model'
import { toPerformance } from './perform'
import { tempoRatios, toNotes, unroll } from '../core/score/playback'

const play = (s: ReturnType<typeof fromText>, bpm = 60) => { const p = toPerformance(s); return toNotes(unroll(p), bpm, 85, tempoRatios(p)) } // 60 bpm: one quarter = one second
const one = (txt: string) => fromText([{ rh: txt, lh: 'r:4' }])
const evs = (s: ReturnType<typeof fromText>) => s.measures[0].staves[0][0]

describe('palette marks that change the sound', () => {
  it('trill alternates the note and the one above, ending on the note', () => {
    const s = one('C5:2 r:2'); toggleEv(s, evs(s)[0].id, 'orn', 'trill')
    const n = play(s).filter((x) => x.pitch >= 60)
    expect(n.length).toBeGreaterThan(8)
    expect(n.map((x) => x.pitch).slice(0, 4)).toEqual([72, 74, 72, 74])
    expect(n[n.length - 1].pitch).toBe(72)
    expect(n[n.length - 1].start + n[n.length - 1].duration).toBeCloseTo(2, 5)
  })

  it('turn plays upper, main, lower, main inside the note', () => {
    const s = one('C5:2 r:2'); toggleEv(s, evs(s)[0].id, 'orn', 'turn')
    expect(play(s).filter((x) => x.pitch >= 60).map((x) => x.pitch)).toEqual([74, 72, 71, 72])
  })

  it('tremolo repeats the note: 2 strokes = sixteenths', () => {
    const s = one('C5:1 r:3'); toggleEv(s, evs(s)[0].id, 'trem', 2)
    const n = play(s).filter((x) => x.pitch >= 60)
    expect(n).toHaveLength(4)                  // a quarter of sixteenths
    expect(n.every((x) => x.pitch === 72 && Math.abs(x.duration - 0.25) < 1e-9)).toBe(true)
  })

  it('a rolled chord enters note by note, bottom up (or top down), and ends together', () => {
    const s = fromText([{ rh: 'C5+E5+G5:2 r:2', lh: 'r:4' }])
    toggleEv(s, evs(s)[0].id, 'arp', 'up')
    const up = play(s).filter((x) => x.pitch >= 60).sort((a, b) => a.pitch - b.pitch)
    expect(up[0].start).toBeLessThan(up[1].start); expect(up[1].start).toBeLessThan(up[2].start)
    expect(new Set(up.map((x) => +(x.start + x.duration).toFixed(6))).size).toBe(1)
    toggleEv(s, evs(s)[0].id, 'arp', 'up'); toggleEv(s, evs(s)[0].id, 'arp', 'down')
    const down = play(s).filter((x) => x.pitch >= 60).sort((a, b) => a.pitch - b.pitch)
    expect(down[2].start).toBeLessThan(down[0].start)
  })

  it('a glissando runs through every semitone up to the next note', () => {
    const s = one('C5:2 G5:2'); toggleEv(s, evs(s)[0].id, 'gliss', 'straight')
    const n = play(s).filter((x) => x.pitch >= 60 && x.start < 2)
    expect(n.map((x) => x.pitch)).toEqual([72, 73, 74, 75, 76, 77, 78])   // C5 .. F#5, then G5 is the next note itself
    expect(n[n.length - 1].start + n[n.length - 1].duration).toBeCloseTo(2, 5)
  })

  it('staccatissimo is shorter than staccato', () => {
    const a = one('C5:1 r:3'), b = one('C5:1 r:3')
    a.measures[0].staves[0][0][0].art = ['staccato']; b.measures[0].staves[0][0][0].art = ['staccatissimo']
    expect(play(b).find((x) => x.pitch === 72)!.duration).toBeLessThan(play(a).find((x) => x.pitch === 72)!.duration)
  })

  it('the new dynamics are louder / softer in the right order', () => {
    const s = one('C5:1 D5:1 E5:1 F5:1')
    const e = evs(s); e[0].dyn = 'pppp'; e[1].dyn = 'sfz'; e[2].dyn = 'fp'; e[3].dyn = 'ffff'
    const v = play(s).filter((x) => x.pitch >= 60).map((x) => x.velocity!)
    expect(v[0]).toBeLessThan(v[2]); expect(v[2]).toBeLessThan(v[1]); expect(v[1]).toBeLessThan(v[3])
  })

  it('a tempo change speeds up the notes after it, and D.C. goes back to the first tempo', () => {
    const s = fromText([{ rh: 'C5:4', lh: 'r:4' }, { rh: 'D5:4', lh: 'r:4' }, { rh: 'E5:4', lh: 'r:4' }], { tempo: 60 })
    setTempoMark(s, 1, 120, 'Allegro')                       // bar 2 is twice as fast
    const n = play(s).filter((x) => x.pitch >= 60)
    expect(n.map((x) => +x.start.toFixed(3))).toEqual([0, 4, 6])
    expect(n[1].duration).toBeCloseTo(2, 5)
    s.measures[2].jump = { kind: 'dc', al: 'end' }
    const again = play(s).filter((x) => x.pitch >= 60)
    expect(again.map((x) => x.pitch)).toEqual([72, 74, 76, 72, 74, 76])
    expect(+again[3].start.toFixed(3)).toBe(8)               // second time round bar 1 is slow again ...
    expect(+again[4].start.toFixed(3)).toBe(12)              // ... and bar 2 fast
  })
})

describe('palette bookkeeping', () => {
  it('ottava shifts what is written, not what sounds', () => {
    const s = one('C6:1 D6:1 E6:1 F6:1')
    const e = evs(s)
    expect(toggleSpan(s, 'o8', e[0].id, e[3].id)).toBe(true)
    expect(octShift(8)).toBe(-1); expect(octShift(-8)).toBe(1); expect(octShift(15)).toBe(-2); expect(octShift(-15)).toBe(2)
    expect([...ottavaShifts(s).values()]).toEqual([-1, -1, -1, -1])
    expect(ottavaShiftAt(s, 0, 0, 0, TPQ)).toBe(-1)
    expect(play(s).filter((x) => x.pitch >= 60).map((x) => x.pitch)).toEqual([84, 86, 88, 89]) // still C6..F6
    toggleSpan(s, 'o8', e[0].id, e[3].id)                      // second time removes it
    expect(ottavaShifts(s).size).toBe(0)
  })

  it('grace notes: added a step above, moved, kind remembered', () => {
    const s = one('C5:1 r:3'); const id = evs(s)[0].id
    addGrace(s, id, 'acc'); expect(evs(s)[0].graces).toEqual([pitch('D5')]); expect(evs(s)[0].graceKind).toBe('acc')
    graceStep(s, id, -1); expect(evs(s)[0].graces).toEqual([pitch('C5')])
  })

  it('clef changes apply from their bar on and can be undone by repeating the old clef', () => {
    const s = fromText([{ rh: 'C5:4', lh: 'r:4' }, { rh: 'C5:4', lh: 'r:4' }, { rh: 'C5:4', lh: 'r:4' }])
    setClef(s, 1, 0, 'alto')
    expect([0, 1, 2].map((i) => clefAt(s, i, 0))).toEqual(['treble', 'alto', 'alto'])
    expect(clefAt(s, 2, 1)).toBe('bass')
    setClef(s, 1, 0, 'treble')
    expect(s.measures[1].clefs).toBeUndefined()
  })

  it('texts, barlines, breaks, stretch, flip', () => {
    const s = one('C5:4'); const id = evs(s)[0].id
    setText(s, id, 'lyric', '  la '); expect(evs(s)[0].lyric).toBe('la')
    setText(s, id, 'lyric', '   '); expect(evs(s)[0].lyric).toBeUndefined()
    setBarline(s, 0, 'double'); expect(s.measures[0].barline).toBe('double')
    setBarline(s, 0, 'single'); expect(s.measures[0].barline).toBeUndefined()
    setBreak(s, 0, 'page'); expect(s.measures[0].break).toBe('page'); setBreak(s, 0, 'page'); expect(s.measures[0].break).toBeUndefined()
    setStretch(s, 0, 9); expect(s.measures[0].stretch).toBe(3); setStretch(s, 0, 1); expect(s.measures[0].stretch).toBeUndefined()
    flipStem(s, id); expect(evs(s)[0].flip).toBe(true)
    toggleEv(s, id, 'arp', 'up'); expect(evs(s)[0].arp).toBeUndefined() // a single note has nothing to roll
  })

  it('copying the previous bar gives fresh ids and keeps the bar valid', () => {
    const s = fromText([{ rh: 'C5:1 D5:1 E5:2', lh: 'C3:4' }, { rh: 'r:4', lh: 'r:4' }])
    copyPrevious(s, 1)
    expect(validate(s)).toEqual([])
    const ids = s.measures.flatMap((m) => m.staves.flat(2)).map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(s.measures[1].staves[0][0].map((e) => e.pitches[0]?.step)).toEqual(['C', 'D', 'E'])
  })

  it('the palette demo score is valid, plays, and survives JSON', () => {
    const s = palette()
    expect(validate(s)).toEqual([])
    expect(play(s).length).toBeGreaterThan(40)
    const back = JSON.parse(JSON.stringify(s)) as typeof s // what a saved draft goes through: undefined clef slots turn into null
    expect([0, 4, 7].map((i) => clefAt(back, i, 1))).toEqual([0, 4, 7].map((i) => clefAt(s, i, 1)))
    expect(clefAt(back, 4, 1)).toBe('tenor')
    expect(validate(back)).toEqual([])
    expect(play(back as typeof s).length).toBe(play(s).length)
  })
})
