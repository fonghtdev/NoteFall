// A metronome that is pleasant to practise with: a short, rounded tick (no beep), the first beat of the bar a fifth higher.
// Sounds are synthesised, so there is nothing to download and every click starts exactly when asked. How loud it is: the mixer's metronome fader.
import { bus } from './mixer'

export type ClickSound = 'wood' | 'soft' | 'rim'
export interface ClickSettings { sound: ClickSound; accent: boolean }
export const DEFAULT_CLICK: ClickSettings = { sound: 'soft', accent: true } // the soft bell: the one sound the app uses

/** Loudness of a click before the fader: about as loud as the piano's notes, so it is heard over the music. */
export const CLICK_PEAK = 1

const noise = new WeakMap<BaseAudioContext, AudioBuffer>()
const noiseOf = (ctx: BaseAudioContext) => {
  let b = noise.get(ctx)
  if (!b) { b = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.06), ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; noise.set(ctx, b) }
  return b
}

/** One click at audio-clock time `when`. The accent is the same sound a perfect fifth up and a little louder. */
export function playClick(ctx: BaseAudioContext, when: number, accent: boolean, st: ClickSettings, out: AudioNode = bus(ctx, 'metro')) {
  const peak = CLICK_PEAK * (accent && st.accent ? 1 : 0.8)
  const hi = accent && st.accent
  const master = ctx.createGain(), tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'; tone.frequency.value = st.sound === 'rim' ? 6500 : 4800; tone.Q.value = 0.5 // takes the edge off
  master.gain.value = 1
  tone.connect(master); master.connect(out)
  const partial = (type: OscillatorType, freq: number, level: number, attack: number, decay: number) => {
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.type = type; o.frequency.value = freq
    g.gain.setValueAtTime(0.0001, when)
    g.gain.linearRampToValueAtTime(peak * level, when + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay)
    o.connect(g); g.connect(tone)
    o.start(when); o.stop(when + attack + decay + 0.02)
  }
  const burst = (centre: number, q: number, level: number, length: number) => {
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain()
    n.buffer = noiseOf(ctx); f.type = 'bandpass'; f.frequency.value = centre; f.Q.value = q
    g.gain.setValueAtTime(peak * level, when); g.gain.exponentialRampToValueAtTime(0.0001, when + length)
    n.connect(f); f.connect(g); g.connect(tone)
    n.start(when, 0, length + 0.01)
  }
  if (st.sound === 'wood') { // a wood block: a rounded body, a quick overtone, a hint of knock
    const f = hi ? 1500 : 1000
    partial('triangle', f, 1, 0.0015, 0.1)
    partial('sine', f * 2.4, 0.35, 0.001, 0.03)
    burst(3200, 1.5, 0.12, 0.008)
  } else if (st.sound === 'soft') { // a small soft bell: gentle attack, longer ring, no hard edge at all
    const f = hi ? 990 : 660
    partial('sine', f, 0.9, 0.004, 0.16)
    partial('sine', f * 2, 0.18, 0.004, 0.07)
  } else { // a muffled rim tap: short filtered noise on a low thump
    partial('sine', hi ? 330 : 220, 0.9, 0.002, 0.09)
    burst(hi ? 2400 : 1800, 1.1, 0.9, 0.04)
  }
}

export type ClickSource = (from: number, to: number) => { t: number; accent: boolean }[]

/** The clicks of a sorted list (as `scoreClicks` makes it) that fall in (from, to]; before the first one (the falling view's lead-in) they count in at the first beat's pace. */
export const listSource = (list: { t: number; accent: boolean }[]): ClickSource => (from, to) => {
  let lo = 0, hi = list.length
  while (lo < hi) { const m = (lo + hi) >> 1; list[m].t <= from ? (lo = m + 1) : (hi = m) }
  const out = []
  const first = list[0]?.t ?? 0, step = list.length > 1 ? list[1].t - first : 0
  if (lo === 0 && step > 0) { // count-in: first - k·step for every k >= 1 that falls in (from, to]
    const kMin = Math.max(1, Math.ceil((first - to) / step - 1e-9)), kMax = Math.ceil((first - from) / step - 1e-9) - 1
    for (let k = kMax; k >= kMin; k--) out.push({ t: first - k * step, accent: false })
  }
  for (let i = lo; i < list.length && list[i].t <= to; i++) out.push(list[i])
  return out
}

/** Clicks along the song: while the song plays, sound every beat the source reports, in step with the playback clock. */
export class Follower {
  private timer?: ReturnType<typeof setInterval>
  private last = 0
  constructor(private ctx: AudioContext, private now: () => number, private source: () => ClickSource | undefined, private settings: () => ClickSettings, private out?: AudioNode, private play = playClick) {}
  get running() { return this.timer !== undefined }
  start() {
    this.stop()
    this.last = this.now() - 0.004
    this.timer = setInterval(() => this.tick(), 25)
  }
  stop() { if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined } }
  /** After a jump in the song: forget what was already scheduled. */
  reset() { this.last = this.now() - 0.004 }
  private tick() {
    const src = this.source()
    const t = this.now(), horizon = t + 0.12
    if (src && horizon > this.last) {
      for (const c of src(this.last, horizon)) if (c.t > this.last && c.t <= horizon) this.play(this.ctx, this.ctx.currentTime + Math.max(0, c.t - t), c.accent, this.settings(), this.out)
    }
    this.last = Math.max(this.last, horizon)
  }
}
