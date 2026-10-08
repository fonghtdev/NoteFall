// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addFont, downloadFont, fontLabel, fontVoices, pianosOf, upgradeVoice, listFonts, loadSoundFont, removeFont, setPreset } from './soundfonts'
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
  it('a catalog library comes from the first of its copies that answers', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', async (url: string) => { asked.push(url); return url.endsWith('gone.sf2') ? new Response(null, { status: 404 }) : new Response(tinySf2()) })
    const info = await downloadFont({ id: 'c1', name: 'Copy', size: 1, urls: ['https://a/gone.sf2', 'https://b/ok.sf2'], note: '' }, () => {})
    vi.unstubAllGlobals()
    expect([asked, info.id, listFonts().map((f) => f.id), info.name]).toEqual([['https://a/gone.sf2', 'https://b/ok.sf2'], 'c1', ['c1'], 'Copy'])
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

  it('offers the pianos of a library (General MIDI programs 0–7), not its other instruments; one with no piano offers what it has', () => {
    const lib = (ps: [string, number, number][]) => ({ presets: ps.map(([name, bank, program]) => ({ name, bank, program })) }) as unknown as Parameters<typeof pianosOf>[0]
    const gm = lib([['Violin', 0, 40], ['Bright Grand', 0, 1], ['Telephone', 0, 124], ['Grand Piano', 0, 0], ['Chorused EP', 8, 4], ['Standard Kit', 128, 0]])
    expect(pianosOf(gm)).toEqual([{ i: 3, name: 'Grand Piano' }, { i: 1, name: 'Bright Grand' }, { i: 4, name: 'Chorused EP' }])
    expect(pianosOf(lib([['Supersaw', 0, 81]]))).toEqual([{ i: 0, name: 'Supersaw' }])
  })
  it('every piano is a voice of its own; a voice saved as the whole library plays the piano it played then', async () => {
    await addFont(tinySf2(), 'tiny.sf2', 'a1')
    const f = { ...listFonts()[0], pianos: [{ i: 0, name: 'Grand' }, { i: 2, name: 'Bright' }] }
    expect(fontVoices(f)).toEqual([{ value: 'sf2:a1:0', label: 'Grand' }, { value: 'sf2:a1:2', label: 'Bright' }])
    expect([upgradeVoice('sf2:a1'), upgradeVoice('sf2:a1:2'), upgradeVoice('crystal'), upgradeVoice('sf2:gone')]).toEqual(['sf2:a1:0', 'sf2:a1:2', 'crystal', 'sf2:gone'])
  })
  it('a library installed before its pianos were listed learns them when it is loaded', async () => {
    await addFont(tinySf2(), 'tiny.sf2', 'a1')
    localStorage.setItem('notefall.fonts', JSON.stringify(listFonts().map(({ pianos: _, ...old }) => old)))
    await loadSoundFont('a1')
    expect(listFonts()[0].pianos).toEqual([{ i: 0, name: 'Piano' }])
  })
})
