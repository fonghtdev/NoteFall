import type { Glyph, PagePrims } from './primitives'

// Music fonts that follow the SMuFL layout (Bravura, Leland, Petaluma, … : MuseScore, Dorico, LilyPond) put their symbols at U+E000.. .
// The reader was written against the Sonata-style layout (U+F0xx), so SMuFL symbols are renamed to their Sonata twin before reading.
export const SMUFL_TO_SONATA: Record<number, number> = {
  0xe0a4: 0xf0cf, 0xe0a3: 0xf0fa, 0xe0a2: 0xf0fa,                       // notehead black / half / whole
  0xe262: 0xf023, 0xe261: 0xf06e, 0xe260: 0xf062,                       // sharp / natural / flat
  0xe050: 0xf026, 0xe062: 0xf03f,                                       // treble / bass clefs
  0xe052: 0xf102, 0xe053: 0xf103, 0xe064: 0xf104, 0xe065: 0xf105, 0xe05c: 0xf106, // treble 8vb / 8va, bass 8vb / 8va, C clef (alto or tenor: told apart by height)
  0xe263: 0xf100, 0xe264: 0xf101,                                       // double sharp / double flat
  0xe1e7: 0xf0aa,                                                       // augmentation dot
  0xe4e3: 0xf0b7, 0xe4e4: 0xf0ee, 0xe4e5: 0xf0ce, 0xe4e6: 0xf0e4, 0xe4e7: 0xf0c5, // rests: whole, half, quarter, 8th, 16th
  0xe56d: 0xf04d, 0xe56c: 0xf06d,                                       // mordent / inverted mordent
  0xe4c0: 0xf055, 0xe4c1: 0xf055,                                       // fermata
}
for (let d = 0; d <= 9; d++) { SMUFL_TO_SONATA[0xe080 + d] = 0xf030 + d; SMUFL_TO_SONATA[0xe880 + d] = 0xf110 + d } // time-signature digits, tuplet digits
// ornaments, tremolo strokes, arpeggio wiggles, repeat-bar sign, multi-measure rest bars, common / cut time
Object.assign(SMUFL_TO_SONATA, { 0xe566: 0xf140, 0xe567: 0xf141, 0xe220: 0xf150, 0xe221: 0xf151, 0xe222: 0xf152, 0xe63c: 0xf160, 0xe63d: 0xf160, 0xe63f: 0xf161, 0xe640: 0xf162, 0xe500: 0xf170, 0xe4ee: 0xf180, 0xe4ef: 0xf180, 0xe4f0: 0xf180, 0xe08a: 0xf190, 0xe08b: 0xf191 })
// articulations (above and below variants), the letters dynamics are spelled with, ottava labels
for (const [smufl, code] of [[0xe4a2, 0xf120], [0xe4a0, 0xf121], [0xe4a4, 0xf122], [0xe4ac, 0xf123], [0xe4a6, 0xf124]] as const) { SMUFL_TO_SONATA[smufl] = code; SMUFL_TO_SONATA[smufl + 1] = code }
for (let k = 0; k < 6; k++) SMUFL_TO_SONATA[0xe520 + k] = 0xf130 + k       // p m f r s z
// flags count once per beam: an 8th flag is one, a 16th flag two, a 32nd flag three
const FLAGS: Record<number, number> = { 0xe240: 1, 0xe241: 1, 0xe242: 2, 0xe243: 2, 0xe244: 3, 0xe245: 3 }

export const isSmufl = (p: PagePrims) => p.glyphs.some((g) => g.code === 0xe0a4 || g.code === 0xe0a3 || g.code === 0xe0a2 || g.code === 0xe050)

const isDigit = (c: number) => c >= 0x30 && c <= 0x39
export function fromSmufl(p: PagePrims): PagePrims {
  const glyphs: Glyph[] = []
  for (const g of p.glyphs) {
    const flags = FLAGS[g.code]
    // MuseScore writes a tuplet number as a plain digit of its text font: a lone digit 2-9 (a tempo like "62" is two digits side by side) is read as a tuplet number
    const lone = g.code >= 0x32 && g.code <= 0x39 && !p.glyphs.some((o) => o !== g && isDigit(o.code) && Math.abs(o.y - g.y) < 2 && Math.abs(o.x - g.x) < 9)
    if (flags) for (let k = 0; k < flags; k++) glyphs.push({ ...g, code: 0xf06a })
    else if (lone) glyphs.push({ ...g, code: 0xf110 + g.code - 0x30 })
    else glyphs.push(SMUFL_TO_SONATA[g.code] ? { ...g, code: SMUFL_TO_SONATA[g.code] } : g)
  }
  return { ...p, glyphs }
}
