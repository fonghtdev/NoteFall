import { describe, expect, it } from 'vitest'
import type { Note } from '../core/models'
import { tempoRatios, toNotes, unroll } from '../core/score/playback'
import { validate } from './model'
import { detectKey, scoreFromNotes } from './fromNotes'
import { toPerformance } from './perform'

const n = (pitch: number, start: number, duration: number, hand?: 0 | 1): Note => ({ pitch, start, duration, velocity: 80, hand })
const scale = (pcs: number[]) => pcs.map((p, i) => n(60 + p, i * 0.5, 0.5))
const played = (notes: Note[], bpm = 120) => { const s = scoreFromNotes(notes, bpm); expect(validate(s)).toEqual([]); void tempoRatios; return toNotes(unroll(toPerformance(s)), bpm).map((x) => `${x.pitch}@${x.start}/${x.duration}`).sort() }

describe('the key found from the notes', () => {
  it.each([
    ['C major', [0, 2, 4, 5, 7, 9, 11, 0], 0],
    ['G major (F sharp)', [7, 9, 11, 0, 2, 4, 6, 7], 1],
    ['B flat major', [10, 0, 2, 3, 5, 7, 9, 10], -2],
    ['A minor shares the signature of C major', [9, 11, 0, 2, 4, 5, 8, 9], 0],
    ['D minor shares the signature of F major', [2, 4, 5, 7, 9, 10, 1, 2], -1],
  ])('%s', (_, pcs, fifths) => { expect(detectKey(scale(pcs))).toBe(fifths) })
  it('no notes: C major', () => { expect(detectKey([])).toBe(0) })
})

describe('performed notes become a readable score', () => {
  it('keeps every note, its start and its length', () => {
    expect(played([n(60, 0, 0.5), n(62, 0.5, 0.5), n(64, 1, 0.5), n(65, 1.5, 0.5), n(60, 2, 2), n(64, 2, 2), n(67, 2, 2)]))
      .toEqual(['60@0/0.5', '60@2/2', '62@0.5/0.5', '64@1/0.5', '64@2/2', '65@1.5/0.5', '67@2/2'].sort())
  })
  it('puts the hand the file names on its staff, whatever the pitch', () => {
    const s = scoreFromNotes([n(40, 0, 1, 0), n(80, 0, 1, 1)], 60)
    const pitched = (staff: number) => s.measures[0].staves[staff].flat().filter((e) => e.pitches.length).length
    expect([pitched(0), pitched(1)]).toEqual([1, 1])
    expect(s.measures[0].staves[0][0][0].pitches[0].octave).toBe(2) // the E2 sits on the upper staff because the file says right hand
  })
  it('a note that starts while another still sounds goes to a second voice instead of cutting it short', () => {
    // a whole note C5 with a quarter G5 on the second beat above it
    expect(played([n(72, 0, 2), n(79, 0.5, 0.5)])).toEqual(['72@0/2', '79@0.5/0.5'])
  })
  it('a note longer than the bar is tied across the barline', () => {
    expect(played([n(60, 1.5, 1)])).toEqual(['60@1.5/1'])
  })
})
