import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { PianoView } from './ui/pianoView'

export interface ExportOptions {
  view: PianoView          // a view configured like the on-screen one (notes, theme, beats, glass…)
  duration: number         // seconds of song
  lead?: number            // seconds of lead-in before the song starts (notes falling in)
  audio?: AudioBuffer      // undefined = silent video
  height: 720 | 1080
  fps: number
  onProgress: (p: number) => void
  cancelled: () => boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Wait until an encoder's queue is short; give up when it stops moving (a device that accepts the settings but never encodes would otherwise hang the export). */
async function drain(enc: VideoEncoder | AudioEncoder, max: number) {
  let last = enc.encodeQueueSize, since = performance.now()
  while (enc.encodeQueueSize > max) {
    await sleep(1)
    if (enc.encodeQueueSize < last) { last = enc.encodeQueueSize; since = performance.now() }
    else if (performance.now() - since > 20000) throw new Error('Bộ mã hoá của thiết bị không phản hồi (xuất video có thể chưa chạy được trên máy này)')
  }
}
const flushWithin = (enc: VideoEncoder | AudioEncoder, ms: number) => Promise.race([enc.flush(), sleep(ms).then(() => { throw new Error('Bộ mã hoá của thiết bị không phản hồi khi hoàn tất video') })])

/** Renders frame by frame (so it is smooth at any speed) and encodes H.264 + AAC with the browser's WebCodecs. */
export async function exportVideo(o: ExportOptions): Promise<Blob | undefined> {
  const { view, duration, audio, fps } = o
  const lead = o.lead ?? 0
  const H = o.height, W = (H * 16) / 9
  const out = document.createElement('canvas')
  out.width = W; out.height = H
  const ctx = out.getContext('2d')!

  const channels = audio ? Math.min(2, audio.numberOfChannels) : 0
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    audio: audio ? { codec: 'aac', numberOfChannels: channels, sampleRate: audio.sampleRate } : undefined,
    fastStart: 'in-memory',
  })
  let failure: Error | undefined
  const fail = (e: Error) => { failure = e }

  const vcfg = { codec: H === 1080 ? 'avc1.640028' : 'avc1.64001f', width: W, height: H, bitrate: H === 1080 ? 10e6 : 6e6, framerate: fps }
  if (!(await VideoEncoder.isConfigSupported(vcfg).catch(() => ({ supported: false }))).supported) throw new Error('Thiết bị này không mã hoá được video H.264 ở độ phân giải đã chọn: thử 720p')
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: fail })
  venc.configure(vcfg)

  const frames = Math.ceil((duration + lead) * fps)
  for (let i = 0; i < frames; i++) {
    if (failure) throw failure
    if (o.cancelled()) { venc.close(); return undefined }
    view.draw(i / fps - lead, { w: W, h: H, dt: 1 / fps })
    ctx.clearRect(0, 0, W, H)
    if (view.glassActive) ctx.drawImage(view.glCanvas!, 0, 0)
    ctx.drawImage(view.canvas, 0, 0)
    const vf = new VideoFrame(out, { timestamp: Math.round((i * 1e6) / fps) })
    venc.encode(vf, { keyFrame: i % (fps * 2) === 0 })
    vf.close()
    await drain(venc, 8) // don't let raw frames pile up in memory
    if (i % 5 === 0) { o.onProgress(i / frames); await sleep(0) } // let the UI breathe
  }
  await flushWithin(venc, 120000)
  venc.close()

  if (audio) {
    const acfg = { codec: 'mp4a.40.2', sampleRate: audio.sampleRate, numberOfChannels: channels, bitrate: 192000 }
    if (!(await AudioEncoder.isConfigSupported(acfg).catch(() => ({ supported: false }))).supported) throw new Error('Thiết bị này không mã hoá được âm thanh AAC')
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: fail })
    aenc.configure(acfg)
    const total = Math.min(audio.length, Math.ceil(duration * audio.sampleRate)), step = 4800
    for (let at = 0; at < total; at += step) {
      if (o.cancelled()) { aenc.close(); return undefined }
      const n = Math.min(step, total - at)
      const data = new Float32Array(n * channels) // planar: all of ch0, then all of ch1
      for (let ch = 0; ch < channels; ch++) data.set(audio.getChannelData(ch).subarray(at, at + n), ch * n)
      const ad = new AudioData({ format: 'f32-planar', sampleRate: audio.sampleRate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round(((at / audio.sampleRate) + lead) * 1e6), data })
      aenc.encode(ad)
      ad.close()
      await drain(aenc, 8)
    }
    await flushWithin(aenc, 120000)
    aenc.close()
  }
  if (failure) throw failure
  muxer.finalize()
  o.onProgress(1)
  return new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: 'video/mp4' })
}
