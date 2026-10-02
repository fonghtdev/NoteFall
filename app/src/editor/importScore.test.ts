// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import minuet from '../core/score/fixtures/minuet-p1.json'
import { readScore } from '../core/score/omr'
import type { PagePrims } from '../core/score/primitives'
import { unroll } from '../core/score/playback'
import { scoreFromOmr } from './importScore'
import { scoreFromMusicXml, scoreToMusicXml } from './io'
import { validate } from './model'
import { toPerformance } from './perform'

const omr = readScore([minuet as unknown as PagePrims])
const key = (ns: { pitch: number; start: number; duration: number; staff: number }[]) => ns.map((n) => `${n.staff}:${n.pitch}@${+n.start.toFixed(4)}/${+n.duration.toFixed(4)}`).sort()

describe('PDF -> editor', () => {
  const { score, warnings } = scoreFromOmr(omr, 'Minuet in G')

  it('is a valid score with the right shape', () => {
    expect(warnings).toEqual([])
    expect(validate(score)).toEqual([])
    expect(score.measures).toHaveLength(32)
    expect(score.key).toBe(1)
    expect(score.time).toEqual({ beats: 3, unit: 4 })
    expect(score.clefs).toEqual(['treble', 'bass'])
    expect(score.measures[15].endRepeat).toBe(true)
    expect(score.measures[16].startRepeat).toBe(true)
  })

  it('keeps the ornaments and the grace note as notation', () => {
    const rh = (i: number) => score.measures[i].staves[0][0]
    expect(rh(2).filter((e) => e.orn).map((e) => e.orn)).toEqual(['mordent'])          // bar 3
    expect(rh(29).filter((e) => e.orn).map((e) => e.orn)).toEqual(['inverted'])        // bar 30
    expect(rh(7).find((e) => e.graces)?.graces).toEqual([{ step: 'B', alter: 0, octave: 4 }]) // bar 8
  })

  it('plays exactly what the PDF itself plays', () => {
    expect(key(unroll(toPerformance(score)))).toEqual(key(unroll(omr)))
  })

  it('survives a trip through MusicXML (so MuseScore can open it)', () => {
    const back = scoreFromMusicXml(scoreToMusicXml(score)).score
    expect(validate(back)).toEqual([])
    expect(key(unroll(toPerformance(back)))).toEqual(key(unroll(omr)))
  })
})
