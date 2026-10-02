import type { Glyph, PagePrims } from './primitives'
import type { Measure } from './omr'

// Reads the words and brackets that steer playback in a printed score: "D.C. al Fine", "Fine", "To Coda",
// and the 1./2. ending brackets. Conservative on purpose: nothing is assumed unless the text or bracket is clear.
// ponytail: only verified on synthetic geometry, not on a real PDF that uses them.

export interface BarGeom { x0: number; x1: number; top: number; bottom: number; sp: number }
export type Nav = Pick<Measure, 'volta' | 'toCoda' | 'fine' | 'jump'>

interface Word { text: string; x0: number; x1: number; y: number; size: number }

/** Glue the page's plain-text glyphs (not music-font symbols) into words, line by line. */
export function words(glyphs: Glyph[]): Word[] {
  const text = glyphs.filter((g) => g.code < 0xf000 && g.code > 0x20).sort((a, b) => b.y - a.y || a.x - b.x)
  const out: Word[] = []
  for (const g of text) {
    const c = String.fromCodePoint(g.code)
    const w = out[out.length - 1]
    if (w && Math.abs(w.y - g.y) < 1.5 && g.x - w.x1 < 0.9 * g.size && g.x - w.x1 > -0.5 * g.size) {
      if (g.x - w.x1 > 0.22 * g.size) w.text += ' '
      w.text += c; w.x1 = Math.max(w.x1, g.x + g.w)
    } else out.push({ text: c, x0: g.x, x1: g.x + g.w, y: g.y, size: g.size })
  }
  return out
}

/** Navigation found on one page, one entry per bar (matching `bars`). */
export function readNavigation(p: PagePrims, bars: BarGeom[]): Nav[] {
  const out: Nav[] = bars.map(() => ({}))
  const ws = words(p.glyphs)
  const barAt = (x: number, y: number) => bars.findIndex((b) => x > b.x0 && x <= b.x1 + 4 && (y > b.top - 10 * b.sp && y < b.bottom + 10 * b.sp))

  for (const w of ws) {
    const t = w.text.replace(/\s+/g, ' ').trim()
    const bi = barAt(w.x1, w.y)
    if (bi < 0) continue
    const m = /^d\.?\s?([cs])\.?(?:\s*al\s*(fine|coda))?$/i.exec(t)
    if (m) out[bi].jump = { kind: m[1].toLowerCase() === 'c' ? 'dc' : 'ds', al: (m[2]?.toLowerCase() as 'fine' | 'coda' | undefined) ?? 'end' }
    else if (/^fine$/i.test(t)) out[bi].fine = true
    else if (/^to\s*coda$/i.test(t)) out[bi].toCoda = true
  }

  // ending brackets: a horizontal line above the top staff with a short hook down at its left end and a number beside the hook
  for (const s of p.segs) {
    if (Math.abs(s.y1 - s.y2) > 0.01) continue
    const x0 = Math.min(s.x1, s.x2), x1 = Math.max(s.x1, s.x2), y = s.y1
    const home = bars.find((b) => x0 < b.x1 && x1 > b.x0 && y > b.top + 1.2 * b.sp && y < b.top + 8 * b.sp)
    if (!home || x1 - x0 < 2.5 * home.sp) continue
    const hook = (x: number) => p.segs.some((v) => Math.abs(v.x1 - v.x2) < 0.01 && Math.abs(v.x1 - x) < 0.8 && Math.max(v.y1, v.y2) > y - 0.3 && Math.max(v.y1, v.y2) - Math.min(v.y1, v.y2) < 3 * home.sp)
    if (!hook(x0)) continue
    const digits = p.glyphs.filter((g) => g.code >= 0x31 && g.code <= 0x39 && g.x >= x0 - 1 && g.x <= x0 + 6 * home.sp && g.y < y && g.y > y - 3 * home.sp)
    const nums = [...new Set(digits.sort((a, b) => a.x - b.x).map((g) => g.code - 0x30))]
    if (!nums.length) continue
    // "1.-3." reads as digits 1 and 3: fill the range
    const list = nums.length === 2 && ws.some((w) => Math.abs(w.y - digits[0].y) < 2 && /\d\.?\s?[-–]\s?\d/.test(w.text)) ? Array.from({ length: nums[1] - nums[0] + 1 }, (_, i) => nums[0] + i) : nums
    bars.forEach((b, i) => {
      const overlap = Math.min(x1, b.x1) - Math.max(x0, b.x0)
      if (overlap > 0.5 * (b.x1 - b.x0) && Math.abs(b.top - home.top) < 1) out[i].volta = list
    })
  }
  return out
}
