import { describe, expect, it } from 'vitest'
import { THEMES, mix, rgb } from './theme'

describe('themes', () => {
  it('has exactly the three looks: crystal, black and your own picture', () => {
    expect(Object.keys(THEMES).sort()).toEqual(['black', 'crystal', 'image'])
    expect(Object.values(THEMES).map((t) => t.kind).sort()).toEqual(['black', 'crystal', 'image'])
  })

  it('every theme gives the two hands clearly different colours', () => {
    for (const t of Object.values(THEMES)) {
      const d = Math.hypot(...t.right.map((c, i) => c - t.left[i]))
      expect(d, t.name).toBeGreaterThan(90)
    }
  })

  it('colour helpers', () => {
    expect(mix([0, 0, 0], [100, 200, 50], 0.5)).toEqual([50, 100, 25])
    expect(rgb([10, 20, 30], 1, 0.5)).toBe('rgba(10,20,30,0.5)')
    expect(rgb([200, 200, 200], 2)).toBe('rgba(255,255,255,1)')   // clamps
  })
})
