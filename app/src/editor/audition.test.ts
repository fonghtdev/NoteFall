// @vitest-environment jsdom
// A note placed, picked or moved sounds once (MuseScore's "play on note entry"); nothing else does.
import { describe, expect, it, vi } from 'vitest'

const played: number[][] = []
vi.mock('../core/synth', () => ({ PIANO_CHANGED: 'x', renderNotes: async (notes: { pitch: number }[]) => ({ pitches: notes.map((n) => n.pitch) }) }))
class FakeCtx { currentTime = 0; destination = {}; resume = async () => {}; createGain() { return { gain: { value: 1 }, connect: (n: unknown) => n } } createBufferSource() { return { buffer: { pitches: [] as number[] }, connect: (n: unknown) => n, start() { played.push(this.buffer.pitches) } } } }
;(globalThis as { AudioContext?: unknown }).AudioContext = FakeCtx
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
const { Composer } = await import('./composer')
const { emptyScore } = await import('./model')

describe('audition', () => {
  it('plays each placed note and each pitch change once, not every redraw', async () => {
    localStorage.clear()
    const c = new Composer(document.body.appendChild(document.createElement('div')), { toFalling() {}, piano: { options: () => [], value: () => 'crystal', set() {}, openLibrary() {}, isDefault: () => true, setDefault() {} }, click: () => ({ sound: 'wood' as const, accent: true }) })
    c.setScore(emptyScore(2))
    c.key('n'); c.key('3'); c.key('c'); c.key('e')
    c.refresh()                         // a redraw alone: silent
    c.key('Escape'); c.sel = c.score.measures[0].staves[0][0][0].id; c.refresh(); c.key('ArrowUp')
    await new Promise((r) => setTimeout(r, 0))
    expect(played).toEqual([[72], [76], [72], [73]])
  })
})
