import { BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch'
import type { Note } from './models'

const SR = 22050 // the model's required sample rate
let model: BasicPitch | undefined

/** Mono, 22.05 kHz copy of a decoded buffer (Basic Pitch input format). */
async function toModelInput(buf: AudioBuffer): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(buf.duration * SR), SR)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination) // channel mixdown to mono happens here
  src.start()
  return (await ctx.startRendering()).getChannelData(0)
}

/** Audio -> notes with Basic Pitch, fully local (tfjs). */
export async function transcribe(buf: AudioBuffer, onProgress: (p: number) => void = () => {}): Promise<Note[]> {
  model ??= new BasicPitch(new URL('model/model.json', document.baseURI).href)
  const frames: number[][] = [], onsets: number[][] = []
  await model.evaluateModel(
    await toModelInput(buf),
    (f, o) => { frames.push(...f); onsets.push(...o) },
    onProgress,
  )
  // thresholds = Basic Pitch's own defaults; looser values (0.25/0.25/5) roughly double the notes, mostly noise
  return noteFramesToTime(outputToNotesPoly(frames, onsets, 0.5, 0.3, 11))
    .map((n) => ({
      pitch: n.pitchMidi,
      start: n.startTimeSeconds,
      duration: n.durationSeconds,
      velocity: Math.max(1, Math.min(127, Math.round(n.amplitude * 127))),
    }))
    .sort((a, b) => a.start - b.start)
}
