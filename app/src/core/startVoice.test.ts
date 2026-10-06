import { describe, expect, it } from 'vitest'
import { startVoice } from './synth'

const store = (o: Record<string, string>) => (k: string) => o[k] ?? null
const all = () => true

describe('the piano the app opens with', () => {
  it('is the default when one is ticked, even if another was used last', () => {
    expect(startVoice(store({ 'notefall.pianoDefault': 'crystal', 'notefall.piano': 'sf2:generaluser' }), all)).toBe('crystal')
  })
  it('is the one used last when no default is ticked', () => {
    expect(startVoice(store({ 'notefall.piano': 'simple' }), all)).toBe('simple')
  })
  it('skips a piano that is gone (a removed SoundFont) and falls back to the next choice, else to nothing', () => {
    const gone = (v: string) => v !== 'sf2:old'
    expect(startVoice(store({ 'notefall.pianoDefault': 'sf2:old', 'notefall.piano': 'simple' }), gone)).toBe('simple')
    expect(startVoice(store({ 'notefall.pianoDefault': 'sf2:old' }), gone)).toBeUndefined()
    expect(startVoice(store({}), all)).toBeUndefined()
  })
})
