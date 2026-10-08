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
    this.drawKeyLight(t, hitY, kbH, w)
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
      const base = mix(this.handColor(handOf(n)), [8, 10, 22], 0.38 * (1 - n.velocity / 127)) // each hand keeps its own colour, deeper for a soft note, full for a loud one; the note that is sounding glows brighter
      out.push({ x: x + 1, y: top, w: kw - 2, h: bottom - top, hot, color: hot > 0 ? mix(base, [255, 255, 255], 0.45 * hot) : base })
    }
    return out
  }

  /**
   * The notes light the keyboard: one about to land throws its colour onto the felt and the key below (stronger as it nears), one that sounds
   * pools light where it meets the felt and runs it down its key. A function of time, like the rest, so seeking and video export agree.
   */
  private drawKeyLight(t: number, hitY: number, kbH: number, w: number) {
    const g = this.g, fh = Math.max(4, kbH * 0.055), AHEAD = 0.6
    g.save()
    g.globalCompositeOperation = 'lighter'
    for (const n of this.keys.visible(t, AHEAD)) {
      const [x, kw] = keyRect(n.pitch, w), cx = x + kw / 2, v = 0.35 + 0.65 * (n.velocity / 127)
      const c = mix(this.handColor(handOf(n)), [255, 255, 255], 0.25)
      const coming = n.start > t ? (1 - (n.start - t) / AHEAD) ** 2 : 0                        // 0 … 1 as it nears the keys
      const age = t - n.start, left = n.start + n.duration - t
      const sounding = age >= 0 && left > 0 ? (0.6 + 0.4 * Math.exp(-age * 6)) * Math.min(1, left / 0.15) : 0
      const a = Math.max(coming * 0.32, sounding * 0.5) * v
      if (a < 0.01) continue
      const r = kw * (1.4 + 0.8 * sounding)
      g.save(); g.translate(cx, hitY + fh * 0.5); g.scale(1, 0.45)                                // a flat pool of light on the felt
      const pool = g.createRadialGradient(0, 0, 0, 0, 0, r)
      pool.addColorStop(0, rgb(c, 1, a)); pool.addColorStop(1, rgb(c, 1, 0))
      g.fillStyle = pool; g.fillRect(-r, -r, 2 * r, 2 * r)
      g.restore()
      if (sounding > 0) {                                                                         // light running down the pressed key, fading toward its front
        const len = (isBlack(n.pitch) ? 0.6 : 0.9) * kbH
        const run = g.createLinearGradient(0, hitY + fh, 0, hitY + fh + len)
        run.addColorStop(0, rgb(c, 1, 0.28 * sounding * v)); run.addColorStop(1, rgb(c, 1, 0))
        g.fillStyle = run; g.fillRect(x + 1, hitY + fh, kw - 2, len)
      }
    }
    g.restore()
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

  /**
   * A keyboard that looks like one: a strip of red felt, ivory white keys with a front lip and gaps, black keys with a glossy top, bevelled sides
   * and a shadow on the white keys. A pressed key goes down: its lip shortens, the back darkens as it tilts, and it takes the hand's colour.
   * The keyboard at rest is drawn once and kept; each frame only the pressed keys (and the black keys over them) are drawn again.
   */
  private kbCache?: { key: string; canvas: HTMLCanvasElement }
  private drawKeyboard(top: number, kbH: number, w: number, pressed: Map<number, [number, number, 0 | 1]>) {
    const g = this.g, dpr = g.getTransform().a
    const key = `${Math.round(w)}x${Math.round(kbH)}@${dpr}`
    if (this.kbCache?.key !== key) {
      const cv = document.createElement('canvas')
      cv.width = Math.round(w * dpr); cv.height = Math.round(kbH * dpr)
      const c = cv.getContext('2d')!
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      for (let p = LOW; p <= HIGH; p++) if (!isBlack(p)) this.whiteKey(c, p, 0, kbH, w, 0, 0, 0)
      for (let p = LOW; p <= HIGH; p++) if (isBlack(p)) this.blackKey(c, p, 0, kbH, w, 0, 0, 0)
      this.felt(c, 0, kbH, w)
      this.kbCache = { key, canvas: cv }
    }
    g.drawImage(this.kbCache.canvas, 0, top, w, kbH)
    if (!pressed.size) return
    const blacks = new Set<number>()
    for (const [p, [press, vel, hand]] of pressed) {
      if (isBlack(p)) { blacks.add(p); continue }
      this.whiteKey(g, p, top, kbH, w, press, vel, hand)
      for (const nb of [p - 1, p + 1]) if (nb >= LOW && nb <= HIGH && isBlack(nb)) blacks.add(nb) // the black keys that lie over it
    }
    for (const p of [...blacks].sort((x, y) => x - y)) { const [press, vel, hand] = pressed.get(p) ?? [0, 0, 0 as const]; this.blackKey(g, p, top, kbH, w, press, vel, hand) }
    this.felt(g, top, kbH, w)
  }

  /** The felt strip the keys disappear under, with the soft shadow it throws on them. */
  private felt(g: CanvasRenderingContext2D, top: number, kbH: number, w: number) {
    const fh = Math.max(4, kbH * 0.055)
    const f = g.createLinearGradient(0, top, 0, top + fh)
    f.addColorStop(0, 'rgb(118,26,38)'); f.addColorStop(0.55, 'rgb(86,16,27)'); f.addColorStop(1, 'rgb(52,9,16)')
    g.fillStyle = f; g.fillRect(0, top, w, fh)
    g.fillStyle = 'rgba(255,180,190,0.18)'; g.fillRect(0, top, w, 1) // the light catching its top edge
    const sh = g.createLinearGradient(0, top + fh, 0, top + fh + kbH * 0.09)
    sh.addColorStop(0, 'rgba(0,0,0,0.38)'); sh.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = sh; g.fillRect(0, top + fh, w, kbH * 0.09)
  }

  /** One white key; `press` 0..1 how far down it is. */
  private whiteKey(g: CanvasRenderingContext2D, pitch: number, top: number, kbH: number, w: number, press: number, vel: number, hand: 0 | 1) {
    const [x0, kw] = keyRect(pitch, w), x = x0 + 0.5, kx = kw - 1 // a hairline gap between keys
    const y = top + Math.max(4, kbH * 0.055), bottom = top + kbH - 1
    const lip = Math.max(3, kbH * 0.075) * (1 - 0.65 * press) // the front edge: shorter as the key goes down
    const tint = this.handColor(hand), k = press * (0.25 + 0.4 * (vel / 127))
    const shade = (c: [number, number, number], d: number) => rgb(mix(mix(c, tint, k), [0, 0, 0], d))
    g.save()
    g.beginPath(); g.roundRect(x, y - 2, kx, bottom - y + 2, [0, 0, 3, 3]); g.clip()
    const body = g.createLinearGradient(0, y, 0, bottom - lip)
    body.addColorStop(0, shade([214, 211, 204], 0.18 * press))   // the back, under the felt: darker as the key tilts down
    body.addColorStop(0.12, shade([240, 238, 233], 0.08 * press))
    body.addColorStop(1, shade([252, 251, 248], 0))
    g.fillStyle = body; g.fillRect(x, y, kx, bottom - y)
    const face = g.createLinearGradient(0, bottom - lip, 0, bottom)
    face.addColorStop(0, shade([206, 202, 195], 0)); face.addColorStop(1, shade([176, 171, 163], 0))
    g.fillStyle = face; g.fillRect(x, bottom - lip, kx, lip)
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(x, bottom - lip, kx, 1) // the rounded edge where top meets front
    g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(x + kx - 1, y, 1, bottom - y) // a faint side, so neighbours read as separate keys
    g.restore()
  }

  /** One black key: a block with a glossy top, bevelled sides and a front face; it shades the white keys beside it. */
  private blackKey(g: CanvasRenderingContext2D, pitch: number, top: number, kbH: number, w: number, press: number, vel: number, hand: 0 | 1) {
    const [x, bw] = keyRect(pitch, w)
    const y = top + Math.max(4, kbH * 0.055), h = kbH * 0.6 + 2 * press
    const front = Math.max(3, kbH * 0.06) * (1 - 0.6 * press), bev = Math.max(1.5, bw * 0.13)
    const tint = this.handColor(hand), k = press * (0.35 + 0.45 * (vel / 127))
    const col = (c: [number, number, number]) => rgb(mix(c, tint, k))
    g.save()
    g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 6; g.shadowOffsetX = 2; g.shadowOffsetY = 3 - 2 * press // lower, so its shadow shrinks
    g.fillStyle = col([14, 14, 17])
    g.beginPath(); g.roundRect(x, y - 2, bw, h + 2, [0, 0, 2, 2]); g.fill()
    g.restore()
    const sides = g.createLinearGradient(x, 0, x + bw, 0) // the bevels catch a little light, the top between them stays dark
    sides.addColorStop(0, col([58, 58, 64])); sides.addColorStop(bev / bw, col([30, 30, 34])); sides.addColorStop(1 - bev / bw, col([24, 24, 28])); sides.addColorStop(1, col([44, 44, 50]))
    g.fillStyle = sides; g.fillRect(x, y, bw, h - front)
    const top_ = g.createLinearGradient(0, y, 0, y + h - front)
    top_.addColorStop(0, 'rgba(0,0,0,0.35)'); top_.addColorStop(0.35, 'rgba(255,255,255,0.05)'); top_.addColorStop(1, 'rgba(255,255,255,0.12)')
    g.fillStyle = top_; g.fillRect(x + bev, y, bw - 2 * bev, h - front)
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(x + bev + 1, y + h * 0.18, Math.max(1, bw * 0.08), h * 0.55) // a long highlight on the gloss
    const face = g.createLinearGradient(0, y + h - front, 0, y + h)
    face.addColorStop(0, col([70, 70, 78])); face.addColorStop(1, col([34, 34, 40]))
    g.fillStyle = face
    g.beginPath(); g.roundRect(x + 0.5, y + h - front, bw - 1, front, [0, 0, 2, 2]); g.fill()
  }
}
