import { bus } from '../core/mixer'

/** Playback clock. Time comes from the AudioContext clock, so picture and sound share one timeline. */
export class Transport {
  ctx = new AudioContext()
  duration = 0
  /** Lead-in: the song starts at -lead, so the first notes fall in from the top before the music begins. */
  lead = 0
  playing = false
  private buffer?: AudioBuffer
  private src?: AudioBufferSourceNode
  private t0 = 0 // song position at audio-clock time c0
  private c0 = 0

  /** `buffer` undefined = silent (MIDI). */
  load(duration: number, buffer?: AudioBuffer) {
    this.pause()
    this.duration = duration
    this.buffer = buffer
    this.t0 = -this.lead
  }

  /** Change the lead-in; a song parked at its start moves with it. */
  setLead(lead: number) {
    if (!this.playing && this.t0 <= 0) this.t0 = -lead
    this.lead = lead
  }

  now(): number {
    const t = this.playing ? this.t0 + this.ctx.currentTime - this.c0 : this.t0
    return Math.min(t, this.duration)
  }

  play() {
    if (this.playing) return
    if (this.t0 >= this.duration) this.t0 = -this.lead
    void this.ctx.resume()
    this.c0 = this.ctx.currentTime
    this.playing = true
    if (this.buffer) {
      this.src = this.ctx.createBufferSource()
      this.src.buffer = this.buffer
      this.src.connect(bus(this.ctx, 'piano'))
      // before the song starts the audio waits; otherwise it joins mid-way
      this.src.start(this.ctx.currentTime + Math.max(0, -this.t0), Math.max(0, this.t0))
    }
  }

  pause() {
    if (!this.playing) return
    this.t0 = this.now()
    this.playing = false
    this.src?.stop()
    this.src = undefined
  }

  seek(t: number) {
    const was = this.playing
    this.pause()
    this.t0 = Math.max(-this.lead, Math.min(t, this.duration))
    if (was) this.play()
  }
}
