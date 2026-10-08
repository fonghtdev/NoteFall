import * as cache from './cache'
import { defaultPreset, parseSf2, type SoundFont } from './sf2'

/** The SoundFont libraries the user installed: their bytes live in IndexedDB, the list (and which preset each one plays) in localStorage. */
export interface FontInfo { id: string; name: string; size: number; preset: number; presetName?: string; pianos?: Piano[] } // presetName: what the preset is called, so the pickers can say which instrument plays; pianos: the presets offered as pianos
export interface Piano { i: number; name: string } // a preset (by its place in the library) and its name
const LIST = 'notefall.fonts'
const bytesKey = (id: string) => `sf2:${id}`

export const listFonts = (): FontInfo[] => { try { const v = JSON.parse(localStorage.getItem(LIST) ?? '[]') as FontInfo[]; return Array.isArray(v) ? v : [] } catch { return [] } }
const saveList = (l: FontInfo[]) => { try { localStorage.setItem(LIST, JSON.stringify(l)) } catch { /* best effort */ } }

const parsed = new Map<string, SoundFont>()

/** Install a library: check that it is a real SoundFont, keep it for the next time. `name`: what to call it (else the name inside the file). */
export async function addFont(buf: ArrayBuffer, fileName: string, id = `f${Date.now().toString(36)}`, name?: string): Promise<FontInfo> {
  const font = parseSf2(buf) // throws for anything that is not a SoundFont
  await cache.save(bytesKey(id), buf)
  parsed.set(id, font)
  const info: FontInfo = { id, name: name ?? (font.name && font.name !== 'SoundFont' ? font.name : fileName.replace(/\.sf2$/i, '')), size: buf.byteLength, preset: defaultPreset(font), presetName: font.presets[defaultPreset(font)]?.name, pianos: pianosOf(font) }
  saveList([...listFonts().filter((f) => f.id !== id), info])
  return info
}
export async function removeFont(id: string) { parsed.delete(id); saveList(listFonts().filter((f) => f.id !== id)); await cache.remove(bytesKey(id)) }
export function setPreset(id: string, preset: number, presetName?: string) { saveList(listFonts().map((f) => (f.id === id ? { ...f, preset, presetName } : f))) }

/** The library and the preset it plays (undefined if its bytes are gone: the browser cleared its storage). */
export async function loadSoundFont(id: string): Promise<{ font: SoundFont; preset: number } | undefined> {
  const info = listFonts().find((f) => f.id === id)
  if (!info) return undefined
  let font = parsed.get(id)
  if (!font) {
    const buf = await cache.load<ArrayBuffer>(bytesKey(id))
    if (!buf) return undefined
    try { font = parseSf2(buf) } catch { return undefined }
    parsed.set(id, font)
  }
  const preset = Math.min(info.preset, font.presets.length - 1)
  const name = font.presets[preset]?.name
  if (name !== info.presetName) setPreset(id, info.preset, name) // (a library installed before the name was kept)
  if (!info.pianos) { const pianos = pianosOf(font); saveList(listFonts().map((f) => (f.id === id ? { ...f, pianos } : f))) } // (or before its pianos were listed)
  return { font, preset }
}

/** The pianos of a library: the General MIDI piano family (programs 0–7 of a melodic bank: grands, upright, electric pianos, harpsichord, clavinet); a library with none (one odd instrument) offers what it has. */
export function pianosOf(font: SoundFont): Piano[] {
  const all = font.presets.map((p, i) => ({ i, name: p.name, p }))
  const family = all.filter(({ p }) => p.bank < 120 && p.program <= 7)
  return (family.length ? family : all).sort((a, b) => a.p.bank - b.p.bank || a.p.program - b.p.program).map(({ i, name }) => ({ i, name }))
}

/** Each piano of a library as a voice to play with: 'sf2:<library>:<preset>'. */
export const fontVoices = (f: FontInfo): { value: string; label: string }[] =>
  (f.pianos ?? [{ i: f.preset, name: fontLabel(f) }]).map((p) => ({ value: `sf2:${f.id}:${p.i}`, label: p.name }))

/** A voice saved before every piano had its own ('sf2:<library>'): the piano that library played then. */
export function upgradeVoice(v: string): string {
  const f = /^sf2:[^:]+$/.test(v) ? listFonts().find((x) => `sf2:${x.id}` === v) : undefined
  return f ? `sf2:${f.id}:${f.preset}` : v
}
/** Which library and preset a voice plays. */
export const voiceFont = (v: string) => { const [id, p] = v.slice(4).split(':'); return { id, preset: p === undefined ? undefined : +p } }

/** How a library shows in a list: the instrument that plays (its own name says nothing the person needs), the library's name until that is known. */
export const fontLabel = (f: FontInfo) => f.presetName ?? f.name

/** Free libraries that are known to download from a public address (only fetched when the user asks). */
export interface CatalogEntry { id: string; name: string; size: number; urls: string[]; note: string } // urls: the first that answers is used (copies kept in other people's repositories can go away)
export const CATALOG: CatalogEntry[] = [
  { id: 'yamahagrand', name: 'Yamaha Grand Lite', size: 21782810, urls: ['https://smpldsnds.github.io/soundfonts/soundfonts/yamaha-grand-lite.sf2'], note: '3 tiếng grand Yamaha C5: Grand, Bright (sáng), Dark (ấm, trầm) · Soundfonts 4U · GPL 3, dùng tự do' },
  { id: 'galaxyep', name: 'Galaxy Electric Pianos', size: 30299302, urls: ['https://smpldsnds.github.io/soundfonts/soundfonts/galaxy-electric-pianos.sf2'], note: '8 tiếng piano điện (Rhodes, Wurlitzer…) · GPL 3, dùng tự do' },
  { id: 'uprightkw', name: 'Upright Piano KW', size: 4730396, urls: ['https://raw.githubusercontent.com/LiuYunPlayer/TuneLab/master/TuneLab/Resources/SoundFonts/UprightPianoKW.sf2'], note: 'Đàn piano đứng Kawai thu âm trong phòng khách, tiếng mộc và gần · FreePats, CC0 (bản nhẹ 22 kHz)' },
  { id: 'generaluser', name: 'GeneralUser GS', size: 32319396, urls: ['https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2'], note: '18 tiếng họ piano (grand, bright, honky-tonk, piano điện, harpsichord, clavinet, piano & dây…) · S. Christian Collins · dùng tự do, kể cả thương mại' },
]

/** Download a catalog library (with progress 0..1) and install it. */
export async function downloadFont(e: CatalogEntry, onProgress: (p: number) => void, signal?: AbortSignal): Promise<FontInfo> {
  let res: Response | undefined
  for (const url of e.urls) { // the next copy when one is gone or the network refuses it
    try { res = await fetch(url, { signal }); if (res.ok && res.body) break } catch (err) { if (signal?.aborted) throw err }
  }
  if (!res?.ok || !res.body) throw new Error(`Không tải được (${res?.status ?? 'mạng'})`)
  const total = +(res.headers.get('content-length') ?? e.size) || e.size
  const chunks: Uint8Array[] = []
  let got = 0
  const reader = res.body.getReader()
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress(Math.min(1, got / total)) }
  const buf = new Uint8Array(got); let at = 0
  for (const c of chunks) { buf.set(c, at); at += c.length }
  return addFont(buf.buffer, e.name, e.id, e.name) // (the catalog's name: the one inside a file can be "Yamaha-Grand-Lite-v2.0")
}
