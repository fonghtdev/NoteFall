import { describe, expect, it } from 'vitest'
import { endings, fromText, pitch } from './demo'
import { TPQ, makeTuplet, putInTuplet, setDyn, toggleArt, toggleSpan, emptyScore, putNote, findEv, validate } from './model'
import { DYN_VELOCITY, toPerformance } from './perform'
import { playOrder, toNotes, unroll } from '../core/score/playback'

const play = (s: ReturnType<typeof fromText>) => toNotes(unroll(toPerformance(s)), 60) // 60 bpm: one quarter = one second
const L = { m: 0, staff: 0, voice: 0 }

describe('playing marks', () => {
  it('dynamics set the loudness until the next one', () => {
    const s = fromText([{ rh: 'C5:1 D5:1 E5:1 F5:1', lh: 'r:4' }])
    const ids = s.measures[0].staves[0][0].map((e) => e.id)
    setDyn(s, ids[0], 'p'); setDyn(s, ids[2], 'ff')
    const v = play(s).filter((n) => n.pitch >= 60).map((n) => n.velocity)
    expect(v).toEqual([DYN_VELOCITY.p, DYN_VELOCITY.p, DYN_VELOCITY.ff, DYN_VELOCITY.ff])
  })

  it('a crescendo glides up to the next dynamic', () => {
    const s = fromText([{ rh: 'C5:1 D5:1 E5:1 F5:1', lh: 'r:4' }])
    const ids = s.measures[0].staves[0][0].map((e) => e.id)
    setDyn(s, ids[0], 'p'); setDyn(s, ids[3], 'f')
    toggleSpan(s, 'cresc', ids[0], ids[3])
    const v = play(s).map((n) => n.velocity!)
    expect(v[0]).toBe(DYN_VELOCITY.p)
    expect(v[1]).toBeGreaterThan(v[0]); expect(v[2]).toBeGreaterThan(v[1])
    expect(v[3]).toBe(DYN_VELOCITY.f)
  })

  it('the sustain pedal holds every staff\'s notes until it goes up; the keys (falling notes) keep their length', () => {
    const s = fromText([{ rh: 'C5:1 D5:1 E5:1 F5:1', lh: 'C3:2 G3:2' }, { rh: 'G5:4', lh: 'C3:4' }])
    const rh = s.measures[0].staves[0][0]
    toggleSpan(s, 'pedal', rh[0].id, rh[2].id)                 // down on C5, up after E5 (beat 3)
    const n = play(s), at = (p: number, t: number) => n.find((x) => x.pitch === p && Math.abs(x.start - t) < 1e-6)!
    expect([at(72, 0).duration, at(72, 0).hold]).toEqual([1, 3])  // C5: key one beat, sound until beat 3
    expect(at(74, 1).hold).toBe(2); expect(at(76, 2).hold).toBeUndefined() // E5 ends where the pedal goes up
    expect(at(48, 0).hold).toBe(3)                            // the left hand too
    expect(at(77, 3).hold).toBeUndefined(); expect(at(79, 4).hold).toBeUndefined()
  })

  it('without any marking everything is mezzo-forte', () => {
    expect(play(fromText([{ rh: 'C5:4', lh: 'r:4' }]))[0].velocity).toBe(DYN_VELOCITY.mf)
  })

  it('staccato shortens, accent plays louder, tenuto leaves the note alone', () => {
    const s = fromText([{ rh: 'C5:1 D5:1 E5:1 F5:1', lh: 'r:4' }])
    const [a, b, c] = s.measures[0].staves[0][0].map((e) => e.id)
    toggleArt(s, a, 'staccato'); toggleArt(s, b, 'accent'); toggleArt(s, c, 'tenuto')
    const n = play(s)
    expect(n[0].duration).toBeCloseTo(0.5)
    expect(n[1].velocity!).toBeGreaterThan(n[0].velocity!)
    expect(n[2].duration).toBeCloseTo(1)
  })

  it('a triplet takes exactly the time of two plain notes', () => {
    const s = emptyScore(1)
    const ids = makeTuplet(s, L, 0, TPQ / 2)           // eighth-note triplet on beat 1
    ids.forEach((id, i) => putInTuplet(s, id, pitch(['C5', 'D5', 'E5'][i])))
    putNote(s, L, TPQ, TPQ, pitch('G5'))
    expect(validate(s)).toEqual([])
    const n = play(s).sort((x, y) => x.start - y.start)
    expect(n.map((x) => +x.start.toFixed(4))).toEqual([0, 0.3333, 0.6667, 1])
    expect(n[0].duration).toBeCloseTo(1 / 3, 4)
    void findEv
  })
})

describe('endings and D.C. in a composed score', () => {
  it('plays |: A B [1. C :|] [2. D] E(Fine) F(D.C. al Fine) as A B C A B D E F A B D E', () => {
    const order = playOrder(toPerformance(endings()).measures).map((i) => 'ABCDEF'[i]).join('')
    expect(order).toBe('ABCABDEFABDE')
  })

  it('the notes follow that order in time', () => {
    const n = unroll(toPerformance(endings())).filter((x) => x.staff === 0 && x.start % 4 === 0).sort((a, b) => a.start - b.start)
    // first right-hand note of each bar: A=C5 B=G5 C=D5 D=D5 E=C5 F=E5
    expect(n.map((x) => x.pitch)).toEqual([72, 79, 74, 72, 79, 74, 72, 76, 72, 79, 74, 72])
    expect(n.map((x) => x.start / 4)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })
})
