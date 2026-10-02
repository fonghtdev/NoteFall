import { describe, expect, it } from 'vitest'
import { Midi } from '@tonejs/midi'
import { handOf } from './models'
import { parseMidi } from './midi'
import { toNotes } from './score/playback'
import { KeyState } from '../ui/keyState'

const midiWith = (tracks: number[][]) => {
  const m = new Midi()
  tracks.forEach((pitches) => { const t = m.addTrack(); pitches.forEach((p, i) => t.addNote({ midi: p, time: i * 0.5, duration: 0.4, velocity: 0.8 })) })
  return m.toArray().slice().buffer as ArrayBuffer
}

describe('which hand plays a note', () => {
  it('uses the staff when the source knows it', () => {
    const n = toNotes([{ pitch: 40, start: 0, duration: 1, staff: 0 }, { pitch: 80, start: 0, duration: 1, staff: 1 }], 60)
    expect(n.map((x) => x.hand)).toEqual([0, 1])                       // staff decides, not the pitch
  })
  it('falls back to the pitch: middle C and up is the right hand', () => {
    expect(handOf({ pitch: 60 })).toBe(0)
    expect(handOf({ pitch: 59 })).toBe(1)
  })
  it('MIDI with two tracks: the higher track is the right hand, whatever the track order', () => {
    const notes = parseMidi(midiWith([[40, 43, 45], [72, 74, 76]]))   // low track first
    expect(notes.filter((n) => n.hand === 0).map((n) => n.pitch).sort()).toEqual([72, 74, 76])
    expect(notes.filter((n) => n.hand === 1).map((n) => n.pitch).sort()).toEqual([40, 43, 45])
  })
  it('MIDI with one track does not guess', () => {
    expect(parseMidi(midiWith([[40, 72]])).every((n) => n.hand === undefined)).toBe(true)
  })
  it('a pressed key remembers which hand pressed it', () => {
    const ks = new KeyState([{ pitch: 40, start: 0, duration: 1, velocity: 90, hand: 0 }]) // low note, but played by the right hand
    expect(ks.at(0.5).get(40)![2]).toBe(0)
  })
})
