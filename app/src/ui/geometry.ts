export const LOW = 21, HIGH = 108, WHITE_KEYS = 52
const BLACK = new Set([1, 3, 6, 8, 10]) // pitch % 12 of black keys
const BLACK_W = 0.6                     // black key width, in white-key widths

export const isBlack = (pitch: number) => BLACK.has(pitch % 12)

// white keys strictly below each pitch (counting from A0)
const whiteBelow: number[] = []
for (let p = LOW, n = 0; p <= HIGH; p++) { whiteBelow[p] = n; if (!isBlack(p)) n++ }

/** [x, w] of a key for a keyboard `width` px wide. */
export function keyRect(pitch: number, width: number): [number, number] {
  const w = width / WHITE_KEYS
  const i = whiteBelow[pitch]
  return isBlack(pitch) ? [i * w - (BLACK_W * w) / 2, BLACK_W * w] : [i * w, w]
}
