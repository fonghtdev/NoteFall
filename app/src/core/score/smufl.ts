import type { Glyph, PagePrims } from './primitives'

// Music fonts that follow the SMuFL layout (Bravura, Leland, Petaluma, … : MuseScore, Dorico, LilyPond) put their symbols at U+E000.. .
// The reader was written against the Sonata-style layout (U+F0xx), so SMuFL symbols are renamed to their Sonata twin before reading.
export const SMUFL_TO_SONATA: Record<number, number> = {
  0xe0a4: 0xf0cf, 0xe0a3: 0xf0fa, 0xe0a2: 0xf0fa,                       // notehead black / half / whole
  0xe262: 0xf023, 0xe261: 0xf06e, 0xe260: 0xf062,                       // sharp / natural / flat
  0xe050: 0xf026, 0xe052: 0xf026, 0xe053: 0xf026, 0xe062: 0xf03f, 0xe064: 0xf03f, 0xe065: 0xf03f, // treble / bass clefs (with 8va/8vb marks)
  0xe1e7: 0xf0aa,                                                       // augmentation dot
  0xe4e3: 0xf0b7, 0xe4e4: 0xf0ee, 0xe4e5: 0xf0ce, 0xe4e6: 0xf0e4, 0xe4e7: 0xf0c5, // rests: whole, half, quarter, 8th, 16th
  0xe56d: 0xf04d, 0xe56c: 0xf06d,                                       // mordent / inverted mordent
  0xe4c0: 0xf055, 0xe4c1: 0xf055,                                       // fermata
}
for (let d = 0; d <= 9; d++) SMUFL_TO_SONATA[0xe080 + d] = 0xf030 + d                // time-signature digits
// flags count once per beam: an 8th flag is one, a 16th flag two, a 32nd flag three
const FLAGS: Record<number, number> = { 0xe240: 1, 0xe241: 1, 0xe242: 2, 0xe243: 2, 0xe244: 3, 0xe245: 3 }

export const isSmufl = (p: PagePrims) => p.glyphs.some((g) => g.code === 0xe0a4 || g.code === 0xe0a3 || g.code === 0xe0a2 || g.code === 0xe050)

export function fromSmufl(p: PagePrims): PagePrims {
  const glyphs: Glyph[] = []
  for (const g of p.glyphs) {
    const flags = FLAGS[g.code]
    if (flags) for (let k = 0; k < flags; k++) glyphs.push({ ...g, code: 0xf06a })
    else glyphs.push(SMUFL_TO_SONATA[g.code] ? { ...g, code: SMUFL_TO_SONATA[g.code] } : g)
  }
  return { ...p, glyphs }
}
