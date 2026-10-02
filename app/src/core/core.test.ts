import { describe, expect, it } from 'vitest'
import { Midi } from '@tonejs/midi'
import { clean } from './postprocess'
import { parseMidi } from './midi'
import { keyRect } from '../ui/geometry'
import { KeyState } from '../ui/keyState'

describe('geometry', () => {
  it('places keys', () => {
    expect(keyRect(21, 52)).toEqual([0, 1])          // A0: first white key
    expect(keyRect(108, 52)[0]).toBe(51)              // C8: last white key
    const [x, w] = keyRect(22, 52)                    // A#0 sits on the A|B boundary
    expect(x + w / 2).toBeCloseTo(1)
    expect(w).toBeLessThan(1)
  })
})

describe('keyState', () => {
  const ks = new KeyState([{ pitch: 60, start: 1, duration: 1, velocity: 100 }])
  it('attacks, holds, releases', () => {
    expect(ks.at(0.9).size).toBe(0)
    expect(ks.at(1.02).get(60)![0]).toBeCloseTo(0.5)
    expect(ks.at(1.5).get(60)![0]).toBe(1)
    const r = ks.at(2.06).get(60)![0]
    expect(r).toBeGreaterThan(0); expect(r).toBeLessThan(1)
    expect(ks.at(2.2).size).toBe(0)
  })
})

describe('postprocess', () => {
  it('cleans', () => {
    const out = clean([
      { pitch: 60, start: 0, duration: 0.5, velocity: 80 }, { pitch: 60, start: 0.02, duration: 0.6, velocity: 90 }, // duplicate onset: merge
      { pitch: 62, start: 0, duration: 0.01, velocity: 80 }, // too short
      { pitch: 64, start: 0, duration: 1, velocity: 5 },      // too weak
      { pitch: 10, start: 0, duration: 1, velocity: 80 },     // out of range
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ pitch: 60, start: 0, velocity: 90 })
    expect(out[0].duration).toBeCloseTo(0.62)
  })

  it('keeps a re-struck key as separate notes', () => {
    const out = clean([
      { pitch: 60, start: 0, duration: 0.5, velocity: 80 },
      { pitch: 60, start: 0.5, duration: 0.5, velocity: 80 },  // starts exactly when the first ends
      { pitch: 60, start: 0.9, duration: 0.5, velocity: 80 },  // starts while the second still rings
    ])
    expect(out.map((n) => n.start)).toEqual([0, 0.5, 0.9])
  })
})

describe('midi', () => {
  it('reads notes with tempo applied', () => {
    const m = new Midi()
    m.addTrack().addNote({ midi: 60, time: 0, duration: 0.5, velocity: 90 / 127 })
    const notes = parseMidi(m.toArray().buffer as ArrayBuffer)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ pitch: 60, velocity: 90 })
    expect(notes[0].duration).toBeCloseTo(0.5, 1)
  })
})

import { Particles } from '../ui/particles'

describe('particles', () => {
  it('pool stays bounded and sparks die', () => {
    const p = new Particles(50)
    p.spawn(0, 0, 200)
    expect(p.list.length).toBe(50)
    p.step(2)
    expect(p.list.length).toBe(0)
  })
})

describe('keyState.startedBetween', () => {
  it('returns notes that just started', () => {
    const ks = new KeyState([1, 2, 3].map((s) => ({ pitch: 60, start: s, duration: 0.5, velocity: 90 })))
    expect(ks.startedBetween(1, 2).map((n) => n.start)).toEqual([2]) // (1, 2]
    expect(ks.startedBetween(0, 0.5)).toEqual([])
  })
})
