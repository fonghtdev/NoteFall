interface P { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string }

const GRAVITY = 420 // px/s²

/** Fixed-size pool of sparks; when full the oldest slot is reused, so cost is bounded. */
export class Particles {
  list: P[] = []
  private next = 0
  constructor(private cap = 400) {}

  spawn(x: number, y: number, n: number, color = 'rgb(255,210,90)') {
    for (let i = 0; i < n; i++) {
      const life = 0.4 + Math.random() * 0.5
      const p = { x, y, vx: (Math.random() - 0.5) * 160, vy: -(60 + Math.random() * 220), life, max: life, size: 1.5 + Math.random() * 2.5, color }
      if (this.list.length < this.cap) this.list.push(p)
      else { this.list[this.next] = p; this.next = (this.next + 1) % this.cap }
    }
  }

  step(dt: number) {
    for (const p of this.list) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += GRAVITY * dt }
    this.list = this.list.filter((p) => p.life > 0)
    this.next = 0
  }

  clear() { this.list = []; this.next = 0 }

  draw(g: CanvasRenderingContext2D) {
    g.save()
    g.globalCompositeOperation = 'lighter'
    for (const p of this.list) {
      const k = Math.max(0, p.life / p.max), r = p.size * (0.35 + 0.65 * Math.sqrt(k))
      g.fillStyle = p.color
      g.globalAlpha = k * 0.25                                  // soft halo, then a bright core
      g.beginPath(); g.arc(p.x, p.y, r * 3, 0, 6.2832); g.fill()
      g.globalAlpha = Math.min(1, k * 1.4)
      g.beginPath(); g.arc(p.x, p.y, r, 0, 6.2832); g.fill()
    }
    g.restore()
  }
}
