import { beatTimes, type BeatGrid } from '../core/beats'
import type { Note } from '../core/models'
import { HIGH, LOW, isBlack, keyRect } from './geometry'
import { GlassRenderer, type GlassNote } from './glass'
import { KeyState } from './keyState'
import { Particles } from './particles'
import { handOf } from '../core/models'
import { THEMES, mix, rgb, type Theme } from './theme'

const MIN_NOTE_H = 10
let imgSeq = 0

// fixed star field (seeded so it looks the same every run)
let seed = 12345
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const STARS = Array.from({ length: 140 }, () => ({ x: rnd(), y: rnd(), r: 0.6 + rnd() * 1.1, sp: 4 + rnd() * 14, ph: rnd() * 6.28 }))

/** Draws only: give it time t and notes. Knows nothing about audio. */
/** What each quality level costs: resolution of the glass layer and of the backdrop it refracts, blur samples. */
const QUALITY = [
  { gl: 1, bd: 0.5, taps: 8, flat: false },
  { gl: 0.75, bd: 0.33, taps: 5, flat: false },
  { gl: 0.5, bd: 0.25, taps: 3, flat: false },
  { gl: 0.5, bd: 0.25, taps: 3, flat: true },
]

export class PianoView {
  keys = new KeyState([])
  lookahead = 4 // seconds visible above the hit line
  beats?: BeatGrid // faint beat lines when set
  theme: Theme = THEMES.crystal
  sparks = true
  glass = true // liquid-glass notes via WebGL when available
  bgImage?: { id: number; bmp: ImageBitmap } // the picture behind the notes in the "image" theme
  bgDim = 0.45  // 0..1 how much it is darkened
  bgBlur = 6    // px of blur
  private bgCache?: { key: string; canvas: HTMLCanvasElement }
  private gl?: GlassRenderer
  /** 0 best … 2 lightest glass, 3 = plain notes (no WebGL). Lowered automatically when the machine cannot keep up. */
  quality = 0
  private backdrop = document.createElement('canvas')
  private particles = new Particles()
  private lastT = 0
  private lastWall = performance.now()
  private g: CanvasRenderingContext2D

  constructor(readonly canvas: HTMLCanvasElement, readonly glCanvas?: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!
    try { if (glCanvas) this.gl = new GlassRenderer(glCanvas) } catch (e) { console.warn('glass off:', e) }
  }

  get glassAvailable() { return !!this.gl }

  setBackground(bmp?: ImageBitmap) { this.bgImage = bmp ? { id: ++imgSeq, bmp } : undefined; this.bgCache = undefined }

  setNotes(notes: Note[]) { this.keys = new KeyState(notes) }

  /** True when the last draw() used the WebGL glass layer (the export composites both canvases). */
  glassActive = false

  /** `o` renders at a fixed size with a fixed time step (video export) instead of the on-screen size and wall clock. */
  draw(t: number, o?: { w: number; h: number; dt: number }) {
    const { canvas: c, g } = this
    const dpr = o ? 1 : window.devicePixelRatio || 1
    const w = o?.w ?? c.clientWidth, h = o?.h ?? c.clientHeight
    const size = (cv: HTMLCanvasElement, k = 1) => {
      const pw = Math.round(w * dpr * k), ph = Math.round(h * dpr * k)
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph }
    }
    size(c)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)

    const kbH = Math.max(80, h * 0.16)
    const hitY = h - kbH
    const pressed = this.keys.at(t)
    const q = o ? QUALITY[0] : QUALITY[Math.min(this.quality, QUALITY.length - 1)] // a video export is always made at full quality
    const glass = this.glass && this.gl && this.glCanvas && !q.flat
    this.glassActive = !!glass
    if (glass) {
      // backdrop at half resolution: it only feeds the refraction, and halves the upload cost
      size(this.glCanvas!, q.gl); size(this.backdrop, q.bd)
      this.glCanvas!.style.visibility = 'visible'
      g.clearRect(0, 0, w, h)
      const bg = this.backdrop.getContext('2d')!
      bg.setTransform(dpr * q.bd, 0, 0, dpr * q.bd, 0, 0)
      this.drawBackdrop(bg, t, hitY, w, true)
      this.gl!.render(this.backdrop, this.noteRects(t, hitY, w), dpr * q.gl, q.taps)
    } else {
      if (this.glCanvas) this.glCanvas.style.visibility = 'hidden'
      this.drawBackdrop(g, t, hitY, w, false)
      this.drawFlatNotes(t, hitY, w)
    }
    this.drawHitLine(hitY, w, pressed, t)
    this.drawSparks(t, hitY, w, o?.dt)
    this.drawKeyboard(hitY, kbH, w, pressed)
  }

  /** What lies behind the glass: a sky, plain black or your own picture, with faint lanes and beat lines on top. */
  private drawBackdrop(g: CanvasRenderingContext2D, t: number, hitY: number, w: number, thick: boolean) {
    const th = this.theme
    if (th.kind === 'image' && this.bgImage) this.drawImageBackdrop(g, w, hitY)
    else {
      const bg = g.createLinearGradient(0, 0, 0, hitY)
      bg.addColorStop(0, rgb(th.bgTop)); bg.addColorStop(1, rgb(th.bgBottom))
      g.fillStyle = bg
      g.fillRect(0, 0, w, hitY)
      if (th.kind !== 'black') this.drawSky(g, t, hitY, w)
    }
    this.drawLanes(g, w, hitY, thick)
    const glow = g.createLinearGradient(0, hitY - 140, 0, hitY) // the keyboard lights the bottom of the screen
    glow.addColorStop(0, 'rgba(255,255,255,0)'); glow.addColorStop(1, 'rgba(255,255,255,0.07)')
    g.fillStyle = glow
    g.fillRect(0, hitY - 140, w, 140)

    if (!this.beats) return
    const pps = hitY / this.lookahead
    for (const b of beatTimes(this.beats, t, t + this.lookahead)) {
      g.fillStyle = b.bar ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.05)'
      const lw = thick ? (b.bar ? 3 : 2) : b.bar ? 2 : 1 // thicker when it must survive the half-res backdrop
      g.fillRect(0, hitY - (b.t - t) * pps, w, lw)
    }
  }

  /** Slow clouds of light, stars and a moon: texture for the glass to bend. */
  private drawSky(g: CanvasRenderingContext2D, t: number, hitY: number, w: number) {
    g.save()
    g.globalCompositeOperation = 'lighter'
    const blobs: [number, number, number, [number, number, number], number][] = [
      [0.2, 0.3, 0.55, [60, 110, 230], 0.085], [0.8, 0.2, 0.5, [110, 90, 220], 0.06], [0.55, 0.7, 0.6, [50, 160, 200], 0.045],
    ]
    blobs.forEach(([bx, by, br, c, a], i) => {
      const x = w * bx + Math.sin(t * 0.05 + i * 2.1) * w * 0.07, y = hitY * by + Math.cos(t * 0.04 + i * 1.3) * hitY * 0.06, r = w * br
      const gr = g.createRadialGradient(x, y, 0, x, y, r)
      gr.addColorStop(0, rgb(c, 1, a)); gr.addColorStop(1, rgb(c, 1, 0))
      g.fillStyle = gr
      g.fillRect(x - r, y - r, 2 * r, 2 * r)
    })
    g.restore()

    g.fillStyle = '#fff'
    for (const s of STARS) {
      g.globalAlpha = 0.12 + 0.28 * (0.5 + 0.5 * Math.sin(t * 1.5 + s.ph))
      g.beginPath(); g.arc(s.x * w, (s.y * hitY + t * s.sp) % hitY, s.r, 0, 6.2832); g.fill()
    }
    g.globalAlpha = 1

    const mx = w * 0.84, my = 70, moon = mix([255, 255, 255], this.theme.hot, 0.25)
    const halo = g.createRadialGradient(mx, my, 10, mx, my, 130)
    halo.addColorStop(0, rgb(moon, 1, 0.16)); halo.addColorStop(1, rgb(moon, 1, 0))
    g.fillStyle = halo
    g.fillRect(mx - 130, my - 130, 260, 260)
    g.fillStyle = rgb(moon, 1, 0.55)
    g.beginPath(); g.arc(mx, my, 24, 0, 6.2832); g.fill()
  }

  /** Faint vertical guides at every white-key edge (a little stronger at each C). */
  private drawLanes(g: CanvasRenderingContext2D, w: number, hitY: number, thick: boolean) {
    g.fillStyle = '#fff'
    for (let pitch = LOW; pitch <= HIGH; pitch++) {
      if (isBlack(pitch)) continue
      g.globalAlpha = pitch % 12 === 0 ? 0.045 : 0.016
      g.fillRect(keyRect(pitch, w)[0], 0, thick ? 1.5 : 1, hitY)
    }
    g.globalAlpha = 1
  }

  /** The user's picture, covered to the screen, blurred and darkened; rebuilt only when something about it changes. */
  private drawImageBackdrop(g: CanvasRenderingContext2D, w: number, hitY: number) {
    const img = this.bgImage!
    const key = `${img.id}|${Math.round(w)}x${Math.round(hitY)}|${this.bgDim}|${this.bgBlur}`
    if (this.bgCache?.key !== key) {
      const sc = Math.min(1, 1600 / Math.max(1, w))
      const cv = document.createElement('canvas')
      cv.width = Math.max(2, Math.round(w * sc)); cv.height = Math.max(2, Math.round(hitY * sc))
      const c = cv.getContext('2d')!
      const k = Math.max(cv.width / img.bmp.width, cv.height / img.bmp.height) * 1.06 // a little oversize so blurred edges stay clean
      const iw = img.bmp.width * k, ih = img.bmp.height * k
      c.filter = `blur(${this.bgBlur * sc}px) saturate(1.05)`
      c.drawImage(img.bmp, (cv.width - iw) / 2, (cv.height - ih) / 2, iw, ih)
      c.filter = 'none'
      c.fillStyle = `rgba(4,6,12,${this.bgDim})`; c.fillRect(0, 0, cv.width, cv.height) // keeps the notes readable on any picture
      const sh = c.createLinearGradient(0, 0, 0, cv.height)
      sh.addColorStop(0, 'rgba(0,0,0,0.08)'); sh.addColorStop(1, 'rgba(0,0,0,0.3)')
      c.fillStyle = sh; c.fillRect(0, 0, cv.width, cv.height)
      this.bgCache = { key, canvas: cv }
    }
    g.drawImage(this.bgCache.canvas, 0, 0, w, hitY)
  }

  private handColor(hand: 0 | 1) { return hand === 0 ? this.theme.right : this.theme.left }

  /** Sparks burst from every key a note has just reached; cleared on seek. */
  private drawSparks(t: number, hitY: number, w: number, fixedDt?: number) {
    const now = performance.now(), dt = fixedDt ?? Math.min(0.1, (now - this.lastWall) / 1000)
    this.lastWall = now
    const jump = t < this.lastT || t - this.lastT > 0.25 // seek, not playback
    if (jump) this.particles.clear()
    else if (this.sparks) {
      for (const n of this.keys.startedBetween(this.lastT, t)) {
        const [x, kw] = keyRect(n.pitch, w)
        this.particles.spawn(x + kw / 2, hitY, 3 + Math.round((n.velocity / 127) * 9), rgb(mix(this.handColor(handOf(n)), [255, 255, 255], 0.3)))
      }
    }
    this.lastT = t
    if (!this.sparks) this.particles.clear()
    this.particles.step(dt)
    this.particles.draw(this.g)
  }

  /** Screen rectangles of the notes in view (shared by the flat and glass renderers). */
  private noteRects(t: number, hitY: number, w: number): GlassNote[] {
    const pps = hitY / this.lookahead, out: GlassNote[] = []
    for (const n of this.keys.visible(t, this.lookahead)) {
      const [x, kw] = keyRect(n.pitch, w)
      const bottom = Math.min(hitY, hitY - (n.start - t) * pps) // swallowed by the keyboard line
      const top = hitY - (n.start - t) * pps - Math.max(MIN_NOTE_H, n.duration * pps)
      if (bottom < 0 || top > hitY) continue
      // this very note is sounding (not just another of the same pitch): a flash on the strike that settles to a steady glow, and a fade on release
      const age = t - n.start, left = n.start + n.duration - t
      const hot = age < 0 ? 0 : (0.55 + 0.45 * Math.exp(-age * 7)) * Math.min(1, Math.max(0, left / 0.12))
      const base = this.handColor(handOf(n)) // each hand keeps its own colour; the note that is sounding just glows brighter
      out.push({ x: x + 1, y: top, w: kw - 2, h: bottom - top, hot, color: hot > 0 ? mix(base, [255, 255, 255], 0.45 * hot) : base })
    }
    return out
  }

  /** Without WebGL: the same idea in 2D, a clear pane with a lit edge. */
  private drawFlatNotes(t: number, hitY: number, w: number) {
    const g = this.g
    for (const r of this.noteRects(t, hitY, w)) {
      const rad = Math.min(7, r.w / 2, r.h / 2)
      g.beginPath()
      g.roundRect(r.x, r.y, r.w, r.h, rad)
      g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 12; g.shadowOffsetY = 5
      g.fillStyle = rgb(r.color, 1, 0.2 + 0.18 * r.hot)
      g.fill()
      g.shadowBlur = 0; g.shadowOffsetY = 0
      const edge = g.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h) // brightest top left, fading round
      edge.addColorStop(0, 'rgba(255,255,255,0.85)'); edge.addColorStop(0.5, 'rgba(255,255,255,0.22)'); edge.addColorStop(1, rgb(r.color, 1, 0.5))
      g.strokeStyle = edge; g.lineWidth = 1
      g.stroke()
    }
  }

  private drawHitLine(hitY: number, w: number, pressed: Map<number, [number, number, 0 | 1]>, t: number) {
    const g = this.g
    g.save()
    g.globalCompositeOperation = 'lighter'
    for (const n of this.keys.visible(t, 0)) { // a soft ring spreading from every fresh strike, a function of time so seeking and export agree
      const age = t - n.start
      if (age < 0 || age > 0.45) continue
      const [x, kw] = keyRect(n.pitch, w), k = age / 0.45, e = 1 - (1 - k) ** 3
      const c = this.handColor(handOf(n)), cx = x + kw / 2, a = (1 - k) * (0.25 + 0.35 * n.velocity / 127)
      g.save()
      g.translate(cx, hitY); g.scale(1, 0.28)
      g.strokeStyle = rgb(mix(c, [255, 255, 255], 0.4), 1, a); g.lineWidth = 2.2 * (1 - k) + 0.6
      g.beginPath(); g.arc(0, 0, kw * (0.6 + 2.6 * e), 0, 6.2832); g.stroke()
      g.restore()
      const fl = g.createRadialGradient(cx, hitY, 0, cx, hitY, kw * 2.2)
      fl.addColorStop(0, rgb(mix(c, [255, 255, 255], 0.5), 1, a * 0.9)); fl.addColorStop(1, rgb(c, 1, 0))
      g.fillStyle = fl; g.fillRect(cx - kw * 2.2, hitY - kw * 2.2, kw * 4.4, kw * 4.4)
    }
    g.restore()
    g.fillStyle = 'rgba(255,255,255,0.35)'
    g.fillRect(0, hitY - 1, w, 2)
    for (const [pitch, [press, vel, hand]] of pressed) {
      const [x, kw] = keyRect(pitch, w)
      const c = this.handColor(hand)
      const grad = g.createLinearGradient(0, hitY - 90, 0, hitY)
      grad.addColorStop(0, rgb(c, 1, 0))
      grad.addColorStop(1, rgb(c, 1, (press * vel) / 127))
      g.fillStyle = grad
      g.fillRect(x, hitY - 90, kw, 90)
    }
  }

  private drawKeyboard(top: number, kbH: number, w: number, pressed: Map<number, [number, number, 0 | 1]>) {
    const g = this.g
    g.strokeStyle = 'rgb(40,40,50)'
    g.lineWidth = 1
    for (const black of [false, true]) {
      for (let pitch = LOW; pitch <= HIGH; pitch++) {
        if (isBlack(pitch) !== black) continue
        const [x, kw] = keyRect(pitch, w)
        const [press, vel, hand] = pressed.get(pitch) ?? [0, 0, 0 as const]
        const dip = 4 * press, k = 0.6 * press * (vel / 127)
        const [y, hh] = black ? [top, kbH * 0.62 + dip] : [top + dip, kbH - dip]
        g.fillStyle = black ? 'rgb(25,25,30)' : rgb(mix([245, 245, 250], this.handColor(hand), k))
        g.fillRect(x, y, kw, hh)
        g.strokeRect(x, y, kw, hh)
      }
    }
  }
}
