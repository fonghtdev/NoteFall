import { TPQ, moveEv, addGrace, emptyScore, makeTuplet, putInTuplet, putNote, setBarline, setBreak, setClef, setDyn, setKey, setRehearsal, setTempoMark, setText, toggleArt, toggleEv, toggleSpan, type Pitch, type Score, type StepName } from './model'

/** "F#4" -> Pitch */
export const pitch = (s: string): Pitch => {
  const m = /^([A-G])(#{1,2}|b{1,2})?(-?\d)$/.exec(s)!
  return { step: m[1] as StepName, alter: m[2] ? (m[2][0] === '#' ? m[2].length : -m[2].length) : 0, octave: +m[3] }
}

/** Build a score from text: one string per bar and staff, "D5:1 G4:0.5 …" (length in quarter notes; "+" joins chord notes). */
export function fromText(bars: { rh: string; lh: string }[], opts: { beats?: number; unit?: number; key?: number; title?: string; tempo?: number } = {}): Score {
  const s = emptyScore(bars.length, { beats: opts.beats ?? 4, unit: opts.unit ?? 4 }, opts.key ?? 0)
  s.title = opts.title ?? 'Không tên'
  s.tempo = opts.tempo ?? 100
  bars.forEach((b, m) => [b.rh, b.lh].forEach((txt, staff) => {
    let at = 0
    for (const tok of txt.split(/\s+/).filter(Boolean)) {
      const [ps, len] = tok.split(':')
      const ticks = Math.round(+len * TPQ)
      if (ps !== 'r') ps.split('+').forEach((p, i) => putNote(s, { m, staff, voice: 0 }, at, ticks, pitch(p), i > 0))
      at += ticks
    }
  }))
  return s
}

/** Bach, Minuet in G, bars 1-8 (the melody the OMR test checks, plus a simple left hand). */
export const minuet = () => fromText([
  { rh: 'D5:1 G4:0.5 A4:0.5 B4:0.5 C5:0.5', lh: 'G3+B3+D4:2 A3:1' },
  { rh: 'D5:1 G4:1 G4:1', lh: 'B3:3' },
  { rh: 'E5:1 C5:0.5 D5:0.5 E5:0.5 F#5:0.5', lh: 'C4:3' },
  { rh: 'G5:1 G4:1 G4:1', lh: 'B3:3' },
  { rh: 'C5:1 D5:0.5 C5:0.5 B4:0.5 A4:0.5', lh: 'A3:3' },
  { rh: 'B4:1 C5:0.5 B4:0.5 A4:0.5 G4:0.5', lh: 'G3:3' },
  { rh: 'F#4:1 G4:0.5 A4:0.5 B4:0.5 G4:0.5', lh: 'D4:1 B3:1 G3:1' },
  { rh: 'A4:3', lh: 'D4:1 D3:0.5 C4:0.5 B3:0.5 A3:0.5' },
], { beats: 3, unit: 4, key: 1, title: 'Minuet in G', tempo: 120 })

/** A little piece that uses every mark the composer knows: triplets, dynamics, hairpin, slur, articulations. */
export function showcase(): Score {
  const s = fromText([
    { rh: 'C5:1 r:1 r:2', lh: 'C3+G3:2 C3+G3:2' },
    { rh: 'G5:1 F5:1 E5:2', lh: 'C3:1 G3:1 C3:2' },
    { rh: 'D5:2 C5:2', lh: 'G2+D3:4' },
    { rh: 'C5:4', lh: 'C3+G3+E4:4' },
  ], { title: 'Ký hiệu', tempo: 90 })
  const L = { m: 0, staff: 0, voice: 0 }
  const ids = makeTuplet(s, L, TPQ, TPQ / 2)                // eighth-note triplet on beat 2
  ;['D5', 'E5', 'F5'].forEach((p, i) => putInTuplet(s, ids[i], pitch(p)))
  const ev = (m: number, k: number, staff = 0) => s.measures[m].staves[staff][0][k]
  setDyn(s, ev(0, 0).id, 'p')
  toggleArt(s, ev(0, 0).id, 'staccato')
  toggleSpan(s, 'cresc', ev(0, 0).id, ev(1, 0).id)
  setDyn(s, ev(1, 0).id, 'f')
  toggleArt(s, ev(1, 0).id, 'accent')
  toggleSpan(s, 'slur', ev(1, 0).id, ev(1, 2).id)
  toggleSpan(s, 'dim', ev(1, 2).id, ev(2, 0).id)
  setDyn(s, ev(2, 0).id, 'mp')
  toggleArt(s, ev(2, 0).id, 'tenuto')
  toggleArt(s, ev(3, 0).id, 'fermata')
  toggleArt(s, ev(2, 1).id, 'marcato')
  return s
}


/** Endings, a repeat, a segno and D.C. al Fine: |: A B [1. C :|] [2. D] E(Fine) F(D.C. al Fine) */
export function endings(): Score {
  const s = fromText([
    { rh: 'C5:1 D5:1 E5:1 F5:1', lh: 'C3:4' },
    { rh: 'G5:2 E5:2', lh: 'C3:2 G2:2' },
    { rh: 'D5:1 E5:1 D5:2', lh: 'G2:4' },
    { rh: 'D5:4', lh: 'G2:4' },
    { rh: 'C5:4', lh: 'C3:4' },
    { rh: 'E5:2 C5:2', lh: 'C3:4' },
  ], { title: 'Ô nhịp tạm và D.C.', tempo: 120 })
  s.measures[0].startRepeat = true
  s.measures[0].segno = true
  s.measures[2].volta = [1]; s.measures[2].endRepeat = true
  s.measures[3].volta = [2]
  s.measures[4].fine = true
  s.measures[5].jump = { kind: 'dc', al: 'fine' }
  return s
}


/** One of everything the palettes can place: used to look at the engraving and to test playback and export. */
export function palette(): Score {
  const s = fromText([
    { rh: 'C5:1 D5:1 E5:1 F5:1', lh: 'C3+E3+G3:2 C3+G3:2' },
    { rh: 'G5:2 E5:2', lh: 'C3:4' },
    { rh: 'C6:1 D6:1 E6:1 F6:1', lh: 'G2:2 D3:2' },
    { rh: 'G5:4', lh: 'G2+D3:4' },
    { rh: 'D5:2 B4:2', lh: 'G3:2 D3:2' },
    { rh: 'E5:1 F#5:1 G5:2', lh: 'E3:4' },
    { rh: 'A5:2 F#5:2', lh: 'D3:4' },
    { rh: 'G5:4', lh: 'G2+D3+G3:4' },
  ], { title: 'Bảng ký hiệu', tempo: 100 })
  const ev = (m: number, k: number, staff = 0) => s.measures[m].staves[staff][0][k]
  toggleEv(s, ev(0, 0).id, 'orn', 'trill')
  toggleEv(s, ev(0, 1).id, 'orn', 'turn')
  toggleEv(s, ev(0, 2).id, 'orn', 'mordent')
  toggleArt(s, ev(0, 3).id, 'staccatissimo')
  toggleEv(s, ev(0, 0, 1).id, 'arp', 'up')
  setText(s, ev(0, 0).id, 'chord', 'C'); setText(s, ev(0, 0).id, 'lyric', 'la'); setText(s, ev(0, 1).id, 'lyric', 'la')
  setText(s, ev(0, 2).id, 'expr', 'dolce')
  toggleEv(s, ev(1, 0).id, 'trem', 2)
  addGrace(s, ev(1, 1).id, 'acc')
  toggleEv(s, ev(1, 0).id, 'gliss', 'wavy')
  toggleSpan(s, 'o8', ev(2, 0).id, ev(2, 3).id)
  toggleSpan(s, 'pedal', ev(2, 0, 1).id, ev(3, 0, 1).id)
  setText(s, ev(3, 0).id, 'staffText', 'pesante')
  ev(3, 0).breath = 'caesura'
  setBarline(s, 3, 'double')
  setTempoMark(s, 4, 80, 'Andante'); setRehearsal(s, 4, 'B')
  setClef(s, 4, 1, 'tenor')
  setKey(s, 4, 1)
  setDyn(s, ev(4, 0).id, 'sfz'); setDyn(s, ev(5, 0).id, 'fp')
  toggleEv(s, ev(6, 0).id, 'gliss', 'straight')
  setBreak(s, 5, 'system')
  setBarline(s, 6, 'dashed')
  s.measures[7].barline = 'final'
  return s
}


/** Two voices in one staff, as in a piano texture: a melody above, a moving line below, rests that step aside. */
export function voices(): Score {
  const s = fromText([
    { rh: 'E5:1.5 D5:0.5 C5:1 r:1', lh: 'C3:1 G3+C4+E4:1 G3+C4+E4:2' },
    { rh: 'D5:2 r:2', lh: 'G2:1 G3+B3+D4:1 G3+B3+D4:2' },
    { rh: 'C5:1 D5:1 E5:1 F5:1', lh: 'C3:1 G3+C4+E4:1 G3+C4+E4:2' },
  ], { title: 'Hai giọng', tempo: 90 })
  const v = (m: number, k: number) => s.measures[m].staves[0][0][k]
  // lower voice in the same staff, from the same beats
  moveEv(s, v(0, 0).id, { m: 0, staff: 0, voice: 0, at: 0 }, 0)
  const lower = (m: number, at: number, pitch: string, ticks: number) => { const id = putNote(s, { m, staff: 0, voice: 1 }, at, ticks, pitch.length ? pitchOf(pitch) : pitchOf('C4')); return id }
  lower(0, 0, 'G4', TPQ * 2); lower(0, 2 * TPQ, 'E4', TPQ * 2)
  lower(1, 0, 'B4', TPQ); lower(1, TPQ, 'G4', TPQ)
  return s
}
const pitchOf = pitch
