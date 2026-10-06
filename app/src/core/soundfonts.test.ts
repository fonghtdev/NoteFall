// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { addFont, fontLabel, listFonts, loadSoundFont, removeFont, setPreset } from './soundfonts'
import { tinySf2 } from './sf2.fixture'

describe('installed SoundFonts', () => {
  beforeEach(async () => { for (const f of listFonts()) await removeFont(f.id) })
  it('installing keeps a name, a size and the instrument to play; the library can be loaded again', async () => {
    const buf = tinySf2()
    const info = await addFont(buf, 'tiny.sf2', 'a1')
    expect(listFonts().map((f) => [f.id, f.name, f.size, f.preset])).toEqual([['a1', 'Tiny test', buf.byteLength, 0]])
    const lib = await loadSoundFont('a1')
    expect(lib?.font.presets.length === 1 && lib.preset === 0 && info.id === 'a1').toBe(true)
  })
  it('a file that is not a SoundFont is refused and nothing is installed', async () => {
    await expect(addFont(new ArrayBuffer(64), 'x.sf2')).rejects.toThrow(/SoundFont/)
    expect(listFonts()).toEqual([])
  })
  it('removing and choosing an instrument', async () => {
    await addFont(tinySf2(), 'tiny.sf2', 'a1')
    setPreset('a1', 3); expect(listFonts()[0].preset).toBe(3)
    expect((await loadSoundFont('a1'))?.preset).toBe(0) // (there is only one instrument: the choice is held inside what exists)
    await removeFont('a1')
    expect(listFonts()).toEqual([]); expect(await loadSoundFont('a1')).toBeUndefined()
  })
  it('lists the instrument that plays by its own name, not that of the library', async () => {
    await addFont(tinySf2(), 'tiny.sf2', 'a1')
    const name = listFonts()[0].presetName!
    expect(name).toBeTruthy()
    expect(fontLabel(listFonts()[0])).toBe(name)
    setPreset('a1', 0, 'Xylophone')
    expect(fontLabel(listFonts()[0])).toBe('Xylophone')
  })
  it('a library installed before names were kept learns its name when it is loaded', async () => {
    await addFont(tinySf2(), 'tiny.sf2', 'a1')
    const real = listFonts()[0].presetName
    localStorage.setItem('notefall.fonts', JSON.stringify(listFonts().map(({ presetName: _, ...old }) => old)))
    expect(fontLabel(listFonts()[0])).toBe('Tiny test')
    await loadSoundFont('a1')
    expect(listFonts()[0].presetName).toBe(real)
  })
})
