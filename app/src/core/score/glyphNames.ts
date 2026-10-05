// Music fonts that name their symbols (LilyPond's Emmentaler, ...) have no fixed character codes: the same note head may be character 0, 5a or e6 from one file to the next.
// What stays the same is the glyph name in the font's encoding, so symbols are told apart by it and given their SMuFL code, which the reader already understands.
const BY_NAME: Record<string, number> = {
  'noteheads.s0': 0xe0a2, 'noteheads.s1': 0xe0a3, 'noteheads.s2': 0xe0a4,
  'clefs.G': 0xe050, 'clefs.F': 0xe062, 'clefs.C': 0xe05c, 'clefs.G_change': 0xe050, 'clefs.F_change': 0xe062, 'clefs.C_change': 0xe05c,
  'accidentals.sharp': 0xe262, 'accidentals.natural': 0xe261, 'accidentals.flat': 0xe260, 'accidentals.doublesharp': 0xe263, 'accidentals.flatflat': 0xe264,
  'rests.0': 0xe4e3, 'rests.1': 0xe4e4, 'rests.2': 0xe4e5, 'rests.3': 0xe4e6, 'rests.4': 0xe4e7,
  'dots.dot': 0xe1e7,
  'flags.u3': 0xe240, 'flags.d3': 0xe241, 'flags.u4': 0xe242, 'flags.d4': 0xe243, 'flags.u5': 0xe244, 'flags.d5': 0xe245,
  'timesig.C44': 0xe08a, 'timesig.C22': 0xe08b,
  'scripts.staccato': 0xe4a2, 'scripts.tenuto': 0xe4a4, 'scripts.sforzato': 0xe4a0, 'scripts.umarcato': 0xe4ac, 'scripts.dmarcato': 0xe4ad, 'scripts.staccatissimo': 0xe4a6,
  'scripts.ufermata': 0xe4c0, 'scripts.dfermata': 0xe4c1, 'scripts.trill': 0xe566, 'scripts.turn': 0xe567, 'scripts.prall': 0xe56c, 'scripts.mordent': 0xe56d,
}
;['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'].forEach((n, d) => { BY_NAME[n] = 0xe080 + d })
const DYNAMIC_LETTERS = 'pmfrsz' // Emmentaler spells dynamics with these letters from its own music font: SMuFL e520..e525

export const smuflOfName = (name: string | undefined, fontName = ''): number | undefined =>
  name === undefined ? undefined : BY_NAME[name] ?? (/emmentaler/i.test(fontName) && name.length === 1 && DYNAMIC_LETTERS.includes(name) ? 0xe520 + DYNAMIC_LETTERS.indexOf(name) : undefined)
