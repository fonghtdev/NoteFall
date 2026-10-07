// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fromText, pitch } from './demo'
import { addGrace, setGraceAlter, transposeGrace, graceStep, moveGrace, removeGrace } from './model'
import { renderScore } from './render'

const one = (txt: string) => fromText([{ rh: txt, lh: 'r:4' }])
const evs = (s: ReturnType<typeof fromText>) => s.measures[0].staves[0][0]

describe('grace notes', () => {
  it('the one picked moves by semitones and takes an accidental; asking again gives back the key', () => {
    const s = one('C5:1 E5:1 r:2'), id = evs(s)[1].id
    addGrace(s, id, 'app'); addGrace(s, id, 'app') // F5, F5
    transposeGrace(s, id, 0, 1); expect(evs(s)[1].graces).toEqual([pitch('F#5'), pitch('F5')])
    setGraceAlter(s, id, 1, -1); expect(evs(s)[1].graces![1]).toEqual(pitch('Fb5'))
    setGraceAlter(s, id, 1, -1); expect(evs(s)[1].graces![1]).toEqual(pitch('F5'))
    graceStep(s, id, 1, 0); expect(evs(s)[1].graces![0]).toEqual(pitch('G5'))
  })

  it('dragged: up or down the scale, and onto another note (at most four on a note); Delete takes only the grace note', () => {
    const s = one('C5:1 E5:1 r:2'), [c, e] = evs(s).map((x) => x.id)
    addGrace(s, e, 'acc') // F5
    expect(moveGrace(s, e, 0, e, 2)).toBe(0); expect(evs(s)[1].graces).toEqual([pitch('A5')])
    expect(moveGrace(s, e, 0, c, -1)).toBe(0)
    expect(evs(s)[0]).toMatchObject({ graces: [pitch('G5')], graceKind: 'acc' }); expect(evs(s)[1].graces).toBeUndefined()
    for (let k = 0; k < 3; k++) addGrace(s, c, 'acc')
    addGrace(s, e, 'app'); expect(moveGrace(s, e, 0, c, 0)).toBeUndefined() // C5 already has four
    removeGrace(s, c, 0); expect(evs(s)[0].graces).toHaveLength(3); expect(evs(s)[0].pitches).toEqual([pitch('C5')])
  })

  it('stand in front of their note, clear of the note before', () => {
    const xs = (withGrace: boolean) => {
      const s = one('C5:1 E5:1 F5:1 G5:1')
      if (withGrace) { addGrace(s, evs(s)[1].id, 'acc'); addGrace(s, evs(s)[1].id, 'acc') }
      const host = document.createElement('div')
      const dm = renderScore(host, s, { width: 1000 }).measures[0]
      const at = (i: number) => dm.evs.find((e) => e.id === evs(s)[i].id)!.x
      return at(1) - at(0)
    }
    const plain = xs(false), graced = xs(true)
    expect(graced).toBeGreaterThan(plain + 10) // two grace notes get room of their own before E5, on top of the spring
  })
})
