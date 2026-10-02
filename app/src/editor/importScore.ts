import type { Score as Omr } from '../core/score/omr'
import { TPQ, emptyScore, newId, splitLength, type Ev, type Measure, type Pitch, type Score, type StepName } from './model'

/** Result of reading a sheet-music PDF -> something the composer can edit. Rests, voices, ties, ornaments and grace notes are kept. */
export function scoreFromOmr(o: Omr, title: string): { score: Score; warnings: string[] } {
  const warnings: string[] = []
  const bar = Math.round(((o.beatsPerBar * 4) / o.beatUnit) * TPQ)
  const s = emptyScore(0, { beats: o.beatsPerBar, unit: o.beatUnit }, o.keyFifths ?? 0)
  s.title = o.title || title
  s.clefs = [o.clefs?.[0] ?? 'treble', o.clefs?.[1] ?? 'bass']
  const rests = (n: number): Ev[] => splitLength(0, n, { dots: false, bar }).map((t) => ({ id: newId(s), ticks: t, pitches: [] }))
  let trimmed = 0
  s.measures = o.measures.map((m) => {
    const me: Measure = { staves: [] }
    for (let si = 0; si < 2; si++) {
      const w = m.written?.find((x) => x.staff === si)
      const voices: Ev[][] = (w?.voices ?? []).slice(0, 4).map((v) => {
        const evs: Ev[] = v.map((e) => ({
          id: newId(s), ticks: e.ticks, tie: e.tie,
          pitches: e.pitches.map((p): Pitch => ({ step: p.step as StepName, alter: p.alter, octave: p.octave })),
          hidden: e.hidden, orn: e.orn, graces: e.graces?.map((p): Pitch => ({ step: p.step as StepName, alter: p.alter, octave: p.octave })),
        }))
        let sum = evs.reduce((a, e) => a + e.ticks, 0)
        while (sum > bar && evs.length) { const last = evs[evs.length - 1]; const cut = Math.min(last.ticks, sum - bar); last.ticks -= cut; sum -= cut; if (!last.ticks) evs.pop(); trimmed++ }
        if (sum < bar) evs.push(...splitLength(sum, bar - sum, { dots: false, bar }).map((t) => ({ id: newId(s), ticks: t, pitches: [] as Pitch[] })))
        return evs
      })
      me.staves.push(voices.length ? voices : [rests(bar)])
    }
    if (m.startRepeat) me.startRepeat = true
    if (m.endRepeat) me.endRepeat = true
    if (m.volta) me.volta = m.volta
    if (m.segno) me.segno = true
    if (m.coda) me.coda = true
    if (m.toCoda) me.toCoda = true
    if (m.fine) me.fine = true
    if (m.jump) me.jump = m.jump
    return me
  })
  if (trimmed) warnings.push(`${trimmed} chỗ trong PDF dài hơn ô nhịp nên đã bị cắt bớt`)
  const bad = o.measures.filter((m) => m.suspect).map((m) => m.index)
  if (bad.length) warnings.push(`ô nhịp ${bad.join(', ')} không cộng đủ phách: nên kiểm tra`)
  return { score: s, warnings: [...warnings, ...o.warnings] }
}
