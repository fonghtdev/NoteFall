/**
 * The mixer: one fader for the piano, one for the metronome and one for everything, shared by both screens and kept between sessions.
 * Every AudioContext of the app plays through its own copy of the faders (piano / metronome -> master -> speakers).
 */
export type Fader = 'piano' | 'metro' | 'master'
export const FADERS: Record<Fader, string> = { piano: 'Piano', metro: 'Metronome', master: 'Tổng' }
/** Fired on `window` when a fader moved, so every slider showing it follows. */
export const MIX_CHANGED = 'notefall-mix'
const KEY = 'notefall.mix'

export const levels: Record<Fader, number> = { piano: 0.75, metro: 1, master: 0.9 } // 0..1
try { Object.assign(levels, JSON.parse(localStorage.getItem(KEY) ?? '{}')) } catch { /* defaults */ }

/** A fader position as gain: squared, so the travel feels even to the ear (half way is about -12 dB). */
export const gainOf = (level: number) => Math.max(0, Math.min(1, level)) ** 2

const buses = new Map<BaseAudioContext, Record<Fader, GainNode>>()

/** Where a sound of `ctx` goes in: the piano's or the metronome's fader. */
export function bus(ctx: BaseAudioContext, f: Exclude<Fader, 'master'>): AudioNode {
  let b = buses.get(ctx)
  if (!b) {
    const g = (to: AudioNode) => { const n = ctx.createGain(); n.connect(to); return n }
    const master = g(ctx.destination)
    b = { master, piano: g(master), metro: g(master) }
    for (const k of Object.keys(b) as Fader[]) b[k].gain.value = gainOf(levels[k])
    buses.set(ctx, b)
  }
  return b[f]
}

export function setLevel(f: Fader, level: number) {
  levels[f] = Math.max(0, Math.min(1, level))
  for (const b of buses.values()) b[f].gain.setTargetAtTime(gainOf(levels[f]), b[f].context.currentTime, 0.015) // a short glide: no zipper noise
  try { localStorage.setItem(KEY, JSON.stringify(levels)) } catch { /* best effort */ }
  window.dispatchEvent(new Event(MIX_CHANGED))
}
