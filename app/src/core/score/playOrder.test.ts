import { describe, expect, it } from 'vitest'
import { playOrder } from './playback'
import type { Measure } from './omr'

// bars named A, B, C…; flags are given as a string list like 'A|:', 'B:|', 'C v1', 'D dc'
type Spec = Partial<Pick<Measure, 'startRepeat' | 'endRepeat' | 'volta' | 'segno' | 'coda' | 'toCoda' | 'fine' | 'jump'>>
const bars = (...specs: Spec[]): Measure[] => specs.map((s, i) => ({ index: i + 1, length: 4, notes: [], startRepeat: false, endRepeat: false, ...s }))
const play = (ms: Measure[], repeats = true) => playOrder(ms, repeats).map((i) => 'ABCDEFGHIJ'[i]).join('')

describe('repeats and endings', () => {
  it('a plain repeat plays twice', () => {
    expect(play(bars({ startRepeat: true }, { endRepeat: true }, {}))).toBe('ABABC')
  })
  it('first and second ending', () => {                       // |: A B [1. C :|] [2. D] E
    expect(play(bars({ startRepeat: true }, {}, { volta: [1], endRepeat: true }, { volta: [2] }, {}))).toBe('ABCABDE')
  })
  it('three endings give three passes', () => {               // |: A [1. B :|] [2. C :|] [3. D] E
    expect(play(bars({ startRepeat: true }, { volta: [1], endRepeat: true }, { volta: [2], endRepeat: true }, { volta: [3] }, {}))).toBe('ABACADE')
  })
  it('one ending shared by two passes', () => {               // |: A [1.2. B :|] C
    expect(play(bars({ startRepeat: true }, { volta: [1, 2], endRepeat: true }, {}))).toBe('ABABC')
  })
  it('a two-bar ending', () => {                              // |: A [1. B C :|] [2. D E] F
    expect(play(bars({ startRepeat: true }, { volta: [1] }, { volta: [1], endRepeat: true }, { volta: [2] }, { volta: [2] }, {}))).toBe('ABCADEF')
  })
  it('repeats off: straight through, last ending only', () => {
    expect(play(bars({ startRepeat: true }, {}, { volta: [1], endRepeat: true }, { volta: [2] }, {}), false)).toBe('ABDE')
  })
  it('two repeated sections', () => {
    expect(play(bars({ startRepeat: true }, { endRepeat: true }, { startRepeat: true }, { endRepeat: true }))).toBe('ABABCDCD')
  })
})

describe('D.C. / D.S.', () => {
  it('D.C. returns to the start and plays to the end', () => {
    expect(play(bars({}, {}, { jump: { kind: 'dc', al: 'end' } }))).toBe('ABCABC')
  })
  it('D.C. al Fine stops at Fine', () => {                    // A B(fine) C D(D.C. al Fine)
    expect(play(bars({}, { fine: true }, {}, { jump: { kind: 'dc', al: 'fine' } }))).toBe('ABCDAB')
  })
  it('Fine is ignored on the first pass', () => {
    expect(play(bars({ fine: true }, {}, { jump: { kind: 'dc', al: 'fine' } }))).toBe('ABCA')
  })
  it('D.S. al Coda jumps to the segno, then from "to Coda" to the Coda', () => { // A [segno]B C(to coda) D(D.S. al Coda) [coda]E
    expect(play(bars({}, { segno: true }, { toCoda: true }, { jump: { kind: 'ds', al: 'coda' } }, { coda: true }))).toBe('ABCDBCE')
  })
  it('"to Coda" is ignored until the jump has happened', () => {
    expect(play(bars({}, { toCoda: true }, {}, { jump: { kind: 'dc', al: 'coda' } }, { coda: true }))).toBe('ABCDABE')
  })
  it('after D.C. repeats are not taken again', () => {        // |: A B :| C D.C.
    expect(play(bars({ startRepeat: true }, { endRepeat: true }, { jump: { kind: 'dc', al: 'end' } }))).toBe('ABABCAB' + 'C')
  })
  it('after D.C. the last ending is played', () => {          // |: A [1. B :|] [2. C] D(D.C.)
    expect(play(bars({ startRepeat: true }, { volta: [1], endRepeat: true }, { volta: [2] }, { jump: { kind: 'dc', al: 'end' } }))).toBe('ABACDACD')
  })
  it('D.S. without a segno is ignored instead of looping forever', () => {
    expect(play(bars({}, { jump: { kind: 'ds', al: 'end' } }))).toBe('AB')
  })
  it('with repeats off nothing jumps', () => {
    expect(play(bars({}, { jump: { kind: 'dc', al: 'end' } }), false)).toBe('AB')
  })
})
