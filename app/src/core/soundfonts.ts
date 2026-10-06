import * as cache from './cache'
import { defaultPreset, parseSf2, type SoundFont } from './sf2'

/** The SoundFont libraries the user installed: their bytes live in IndexedDB, the list (and which preset each one plays) in localStorage. */
export interface FontInfo { id: string; name: string; size: number; preset: number; presetName?: string } // presetName: what the preset is called, so the pickers can say which instrument plays
const LIST = 'notefall.fonts'
const bytesKey = (id: string) => `sf2:${id}`

export const listFonts = (): FontInfo[] => { try { const v = JSON.parse(localStorage.getItem(LIST) ?? '[]') as FontInfo[]; return Array.isArray(v) ? v : [] } catch { return [] } }
const saveList = (l: FontInfo[]) => { try { localStorage.setItem(LIST, JSON.stringify(l)) } catch { /* best effort */ } }

const parsed = new Map<string, SoundFont>()

/** Install a library: check that it is a real SoundFont, keep it for the next time. */
export async function addFont(buf: ArrayBuffer, fileName: string, id = `f${Date.now().toString(36)}`): Promise<FontInfo> {
  const font = parseSf2(buf) // throws for anything that is not a SoundFont
  await cache.save(bytesKey(id), buf)
  parsed.set(id, font)
  const info: FontInfo = { id, name: font.name && font.name !== 'SoundFont' ? font.name : fileName.replace(/\.sf2$/i, ''), size: buf.byteLength, preset: defaultPreset(font), presetName: font.presets[defaultPreset(font)]?.name }
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
  return { font, preset }
}

/** How a library shows in a list: the instrument that plays (its own name says nothing the person needs), the library's name until that is known. */
export const fontLabel = (f: FontInfo) => f.presetName ?? f.name

/** Free libraries that are known to download from a public address (only fetched when the user asks). */
export interface CatalogEntry { id: string; name: string; size: number; url: string; note: string }
export const CATALOG: CatalogEntry[] = [
  { id: 'generaluser', name: 'GeneralUser GS', size: 32319396, url: 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2', note: 'S. Christian Collins · dùng tự do, kể cả khi soạn nhạc thương mại · 287 tiếng đàn, trong đó có piano, đàn điện, đàn dây' },
]

/** Download a catalog library (with progress 0..1) and install it. */
export async function downloadFont(e: CatalogEntry, onProgress: (p: number) => void, signal?: AbortSignal): Promise<FontInfo> {
  const res = await fetch(e.url, { signal })
  if (!res.ok || !res.body) throw new Error(`Không tải được (${res.status})`)
  const total = +(res.headers.get('content-length') ?? e.size) || e.size
  const chunks: Uint8Array[] = []
  let got = 0
  const reader = res.body.getReader()
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress(Math.min(1, got / total)) }
  const buf = new Uint8Array(got); let at = 0
  for (const c of chunks) { buf.set(c, at); at += c.length }
  return addFont(buf.buffer, e.name, e.id)
}
