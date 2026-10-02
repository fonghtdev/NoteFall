import { end, type Note } from './models'

/**
 * Notes -> piano-ish audio (one additive-spectrum oscillator per note, exponential decay),
 * rendered offline so it plays, seeks and exports like any decoded file.
 * ponytail: static spectrum, mono, no pedal or sympathetic resonance; swap in a sampler for realism.
 */
export async function renderNotes(notes: Note[], sampleRate = 44100): Promise<AudioBuffer> {
  const length = Math.ceil((notes.reduce((m, n) => Math.max(m, end(n)), 0) + 2) * sampleRate)
  const ctx = new OfflineAudioContext(1, length, sampleRate)

  // harmonics 1..8, rolling off: a bit of bite on top of the fundamental
  const amps = [0, 1, 0.55, 0.32, 0.2, 0.12, 0.07, 0.04, 0.02]
  const wave = ctx.createPeriodicWave(new Float32Array(amps.length), Float32Array.from(amps))

  for (const n of notes) {
    const osc = ctx.createOscillator()
    osc.setPeriodicWave(wave)
    osc.frequency.value = 440 * 2 ** ((n.pitch - 69) / 12)
    const g = ctx.createGain()
    const peak = 0.22 * (n.velocity / 127) ** 1.4
    const tau = Math.max(0.35, 2.6 - n.pitch * 0.022) // low notes ring longer
    const t = n.start, off = Math.max(n.start + 0.05, end(n))
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + 0.004)
    g.gain.setTargetAtTime(0, t + 0.004, tau)        // natural decay…
    g.gain.setTargetAtTime(0, off, 0.09)             // …and a quicker fade when the key is released
    osc.connect(g).connect(ctx.destination)
    osc.start(t)
    osc.stop(off + 1)
  }

  const buf = await ctx.startRendering()
  const data = buf.getChannelData(0)
  let peak = 0
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]))
  if (peak > 0) for (let i = 0; i < data.length; i++) data[i] *= 0.85 / peak // normalise: dense chords can't clip
  return buf
}
