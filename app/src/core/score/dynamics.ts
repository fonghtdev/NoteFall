// Dynamic markings printed with music-font letters (p, m, f, r, s, z) -> loudness, the same scale the composer uses.
export const DYN_BY_TEXT: Record<string, number> = {
  pppp: 20, ppp: 28, pp: 36, p: 49, mp: 64, mf: 80, f: 96, ff: 112, fff: 124, ffff: 127,
  sf: 108, sfz: 110, fp: 90, sfp: 102, rfz: 108, sff: 118, sffz: 118,
}
export const L_P = 0xf130, L_M = 0xf131, L_F = 0xf132, L_R = 0xf133, L_S = 0xf134, L_Z = 0xf135
export const dynText = (codes: number[]) => codes.map((c) => 'pmfrsz'[c - L_P]).join('')
