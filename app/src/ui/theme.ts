type RGB = [number, number, number]

/** The three looks of the falling-notes view. */
export type ThemeKind = 'crystal' | 'black' | 'image'

export interface Theme {
  name: string
  kind: ThemeKind
  bgTop: RGB; bgBottom: RGB
  right: RGB; left: RGB  // glass tint of the right and the left hand
  hot: RGB               // light colour of the moon and the keyboard flash
}

export const THEMES: Record<string, Theme> = {
  crystal: { name: 'Pha lê', kind: 'crystal', bgTop: [5, 8, 20], bgBottom: [11, 18, 40], right: [140, 200, 255], left: [255, 165, 195], hot: [255, 240, 210] },
  black: { name: 'Đen', kind: 'black', bgTop: [0, 0, 0], bgBottom: [5, 6, 9], right: [165, 215, 255], left: [255, 180, 205], hot: [255, 255, 255] },
  image: { name: 'Ảnh của bạn', kind: 'image', bgTop: [8, 10, 20], bgBottom: [8, 10, 20], right: [150, 215, 255], left: [255, 165, 195], hot: [255, 238, 196] },
}

export const rgb = (c: RGB, k = 1, a = 1) =>
  `rgba(${Math.min(255, c[0] * k)},${Math.min(255, c[1] * k)},${Math.min(255, c[2] * k)},${a})`

export const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
