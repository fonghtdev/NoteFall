import type { Score as Omr } from '../core/score/omr'
import type { Dyn } from './model'
import { DYN_VELOCITY } from './perform'
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
  const lastVel: (number | undefined)[] = [undefined, undefined]  // loudness per staff, so a dynamic marking appears where it changes
  const dynOf = (v: number) => (Object.entries(DYN_VELOCITY) as [Dyn, number][]).reduce((a, b) => (Math.abs(b[1] - v) < Math.abs(a[1] - v) ? b : a))[0]
  if (o.tempo) s.tempo = o.tempo
  let prevTempo = o.tempo
  s.measures = o.measures.map((m, mi) => {
    const me: Measure = { staves: [] }
    for (let si = 0; si < 2; si++) {
      const w = m.written?.find((x) => x.staff === si)
      const voices: Ev[][] = (w?.voices ?? []).slice(0, 4).map((v) => {
        const groups = new Map<number, number>()
        const evs: Ev[] = v.map((e) => {
          const ev: Ev = {
            id: newId(s), ticks: e.ticks, tie: e.tie,
            pitches: e.pitches.map((p): Pitch => ({ step: p.step as StepName, alter: p.alter, octave: p.octave })),
            hidden: e.hidden, orn: e.orn, graces: e.graces?.map((p): Pitch => ({ step: p.step as StepName, alter: p.alter, octave: p.octave })),
            arp: e.arp, trem: e.trem,
          }
          if (e.art?.length) ev.art = e.art as Ev['art']
          if (e.tup) { if (!groups.has(e.tup.group)) groups.set(e.tup.group, newId(s)); ev.tup = { n: e.tup.n, m: e.tup.m, group: groups.get(e.tup.group)! } }
          if (e.vel !== undefined && e.pitches.length && e.vel !== lastVel[si]) { if (lastVel[si] !== undefined || e.vel !== 85) ev.dyn = dynOf(e.vel); lastVel[si] = e.vel }
          return ev
        })
        let sum = evs.reduce((a, e) => a + e.ticks, 0)
        while (sum > bar && evs.length) { const last = evs[evs.length - 1]; const cut = Math.min(last.ticks, sum - bar); last.ticks -= cut; sum -= cut; if (!last.ticks) evs.pop(); trimmed++ }
        if (sum < bar) evs.push(...splitLength(sum, bar - sum, { dots: false, bar }).map((t) => ({ id: newId(s), ticks: t, pitches: [] as Pitch[] })))
        return evs
      })
      me.staves.push(voices.length ? voices : [rests(bar)])
    }
    if (m.tempo && (mi > 0 && m.tempo !== prevTempo)) me.tempo = m.tempo
    if (m.tempo) prevTempo = m.tempo
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
