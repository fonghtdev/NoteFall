import { describe, expect, it } from 'vitest'
import { startVoice } from './synth'

const store = (o: Record<string, string>) => (k: string) => o[k] ?? null
const all = () => true

describe('the piano the app opens with', () => {
  it('is the default when one is ticked, even if another was used last', () => {
    expect(startVoice(store({ 'notefall.pianoDefault': 'crystal', 'notefall.piano': 'sf2:generaluser' }), all)).toBe('crystal')
  })
  it('is the app\'s own piano (Salamander) when none is ticked, whatever was used last', () => {
    expect(startVoice(store({ 'notefall.piano': 'crystal' }), all)).toBe('salamander')
    expect(startVoice(store({}), all)).toBe('salamander')
  })
  it('a ticked piano that is gone (a removed SoundFont) gives the app\'s own piano', () => {
    expect(startVoice(store({ 'notefall.pianoDefault': 'sf2:old', 'notefall.piano': 'simple' }), (v) => v !== 'sf2:old')).toBe('salamander')
  })
})
