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

describe('stem direction', () => {
  const stems = (host: HTMLElement) => [...host.querySelectorAll('.vf-stem > path')].map((e) => e.getAttribute('d')!.match(/-?[\d.]+/g)!.map(Number)).map(([, y1, , y2]) => Math.sign(y2 - y1)) // +1: drawn down the page
  it('high notes point their stems down when the other voice holds only rests (a misread scan); two voices with notes still go up and down', () => {
    const s = fromText([{ rh: 'C6:1 D6:1 E6:1 F6:1', lh: 'r:4' }])
    s.measures[0].staves[0].push([{ id: 999, ticks: 3840, pitches: [] }])
    const a = document.body.appendChild(document.createElement('div')); renderScore(a, s, { width: 1000 })
    expect(stems(a).slice(0, 4)).toEqual([1, 1, 1, 1])
    const t = fromText([{ rh: 'C6:1 D6:1 E6:1 F6:1', lh: 'r:4' }])
    t.measures[0].staves[0].push(fromText([{ rh: 'A5:4', lh: 'r:4' }]).measures[0].staves[0][0].map((e) => ({ ...e, id: e.id + 500 })))
    const b = document.body.appendChild(document.createElement('div')); renderScore(b, t, { width: 1000 })
    expect(stems(b).slice(0, 4)).toEqual([-1, -1, -1, -1]) // voice 1 up when voice 2 has a note
  })
  it('decides note by note: only the notes that sound together with the other voice keep its side (a stray note at the end of a scanned bar)', () => {
    const s = fromText([{ rh: 'C6:1 D6:1 E6:1 F6:1', lh: 'r:4' }])
    s.measures[0].staves[0].push([{ id: 900, ticks: 2880, pitches: [] }, { id: 901, ticks: 960, pitches: [{ step: 'G', alter: 0, octave: 4 }] }]) // voice 2: rests, then a note under the last beat only
    const a = document.body.appendChild(document.createElement('div')); renderScore(a, s, { width: 1000 })
    const l = [...a.querySelectorAll('.vf-stem > path')].length
    expect(stems(a).slice(0, 4)).toEqual([1, 1, 1, -1]) // C6 D6 E6 alone: down; F6 sounds with the G4: up
    expect(l).toBeGreaterThanOrEqual(5)
  })
})

