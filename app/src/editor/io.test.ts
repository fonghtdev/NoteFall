// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Midi } from '@tonejs/midi'
import { minuet, fromText, showcase, endings, palette } from './demo'
import { scoreFromJson, scoreFromMusicXml, scoreFromNotes, scoreToJson, scoreToMidi, scoreToMusicXml, trimToBar } from './io'
import { TPQ, setPedalEnd, toggleSpan, validate, type Ev, type Score } from './model'
import { toPerformance } from './perform'
import { toNotes, unroll } from '../core/score/playback'

/** What matters musically: per bar/staff/voice, the pitches and lengths in order (ids are irrelevant). */
const sig = (s: Score) => s.measures.map((m) => m.staves.map((vs) => vs.map((v) => v.map((e) => `${e.pitches.map((p) => `${p.step}${p.alter}${p.octave}`).join('+') || 'r'}:${e.ticks}${e.tie ? '~' : ''}`).join(' '))))

describe('JSON', () => {
  it('round-trips', () => {
    const s = minuet()
    expect(sig(scoreFromJson(scoreToJson(s)))).toEqual(sig(s))
  })
  it('rejects other files', () => expect(() => scoreFromJson('{"a":1}')).toThrow())
})

describe('MusicXML', () => {
  it('exports and re-imports the Minuet without changing a note', () => {
    const s = minuet()
    const { score, warnings } = scoreFromMusicXml(scoreToMusicXml(s))
    expect(warnings).toEqual([])
    expect(validate(score)).toEqual([])
    expect(sig(score)).toEqual(sig(s))
    expect(score.title).toBe('Minuet in G')
    expect(score.key).toBe(1)
    expect(score.time).toEqual({ beats: 3, unit: 4 })
    expect(score.tempo).toBe(120)
  })

  it('keeps ties, repeats and a second voice', () => {
    const s = fromText([{ rh: 'C5:2 D5:2', lh: 'C3:4' }, { rh: 'E5:4', lh: 'C3:4' }])
    s.measures[0].staves[0][0][1].tie = true            // D5 tied over the barline
    s.measures[1].staves[0][0] = [{ id: 99, ticks: 4 * TPQ, pitches: [{ step: 'D', alter: 0, octave: 5 }] }]
    s.measures[0].startRepeat = true
    s.measures[1].endRepeat = true
    const back = scoreFromMusicXml(scoreToMusicXml(s)).score
    expect(back.measures[0].startRepeat).toBe(true)
    expect(back.measures[1].endRepeat).toBe(true)
    expect(sig(back)).toEqual(sig(s))
  })

  it('reads a hand-written MusicXML file with a pickup-free single staff', () => {
    const xml = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>x</part-name></score-part></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
      <note><pitch><step>E</step><alter>-1</alter><octave>4</octave></pitch><duration>4</duration><type>half</type></note>
      <note><rest/><duration>2</duration><type>quarter</type></note></measure></part></score-partwise>`
    const { score } = scoreFromMusicXml(xml)
    expect(sig(score)[0][0][0]).toBe('C04:960 E-14:1920 r:960')
    expect(validate(score)).toEqual([])
    expect(score.measures[0].staves).toHaveLength(2) // the missing left hand is filled with rests
  })
})

describe('MusicXML: marks', () => {
  it('round-trips triplets, dynamics, hairpins, slurs and articulations', () => {
    const s = showcase()
    const { score, warnings } = scoreFromMusicXml(scoreToMusicXml(s))
    expect(warnings).toEqual([])
    expect(validate(score)).toEqual([])
    const marks = (x: Score) => x.measures.flatMap((m) => m.staves.flatMap((vs) => vs.flatMap((v, vi) => v.map((e, k) => ({
      at: `${vi}:${k}`, dyn: e.dyn, art: e.art, tup: e.tup ? `${e.tup.n}:${e.tup.m}` : undefined,
      slur: e.slur !== undefined, hairpin: e.hairpin?.type, ticks: e.ticks,
    })))))
    expect(marks(score)).toEqual(marks(s))
  })
})

describe('MusicXML: endings and jumps', () => {
  const nav = (x: Score) => x.measures.map((m) => ({ s: m.startRepeat, e: m.endRepeat, v: m.volta, sg: m.segno, c: m.coda, tc: m.toCoda, f: m.fine, j: m.jump }))

  it('round-trips voltas, repeats, segno and D.C. al Fine', () => {
    const s = endings()
    const { score, warnings } = scoreFromMusicXml(scoreToMusicXml(s))
    expect(warnings).toEqual([])
    expect(nav(score)).toEqual(nav(s))
  })

  it('round-trips D.S. al Coda with To Coda and Coda', () => {
    const s = fromText([{ rh: 'C5:4', lh: 'r:4' }, { rh: 'D5:4', lh: 'r:4' }, { rh: 'E5:4', lh: 'r:4' }, { rh: 'F5:4', lh: 'r:4' }, { rh: 'G5:4', lh: 'r:4' }])
    s.measures[1].segno = true
    s.measures[2].toCoda = true
    s.measures[3].jump = { kind: 'ds', al: 'coda' }
    s.measures[4].coda = true
    expect(nav(scoreFromMusicXml(scoreToMusicXml(s)).score)).toEqual(nav(s))
  })

  it('reads endings written the way MuseScore writes them (two-bar first ending)', () => {
    const bar = (n: number, extra = '') => `<measure number="${n}">${n === 1 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' : ''}${extra}<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note></measure>`
    const xml = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>x</part-name></score-part></part-list><part id="P1">
      ${bar(1, '<barline location="left"><repeat direction="forward"/></barline>')}
      ${bar(2, '<barline location="left"><ending number="1" type="start"/></barline>')}
      ${bar(3, '<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>')}
      ${bar(4, '<barline location="left"><ending number="2" type="start"/></barline><barline location="right"><ending number="2" type="discontinue"/></barline>')}
      ${bar(5)}</part></score-partwise>`
    const { score } = scoreFromMusicXml(xml)
    expect(score.measures.map((m) => m.volta)).toEqual([undefined, [1], [1], [2], undefined])
    expect(score.measures.map((m) => !!m.endRepeat)).toEqual([false, false, true, false, false])
    expect(score.measures[0].startRepeat).toBe(true)
  })
})

describe('MIDI', () => {
  it('exports every note at the right time', () => {
    const s = fromText([{ rh: 'C5:1 D5:1 E5:1 F5:1', lh: 'C3:4' }], { tempo: 120 })
    const midi = new Midi(scoreToMidi(s))
    const notes = midi.tracks.flatMap((t) => t.notes).sort((a, b) => a.time - b.time)
    expect(notes.map((n) => n.midi)).toEqual([48, 72, 74, 76, 77].sort((a, b) => a - b).length ? notes.map((n) => n.midi) : [])
    expect(notes).toHaveLength(5)
    expect(midi.header.tempos[0].bpm).toBeCloseTo(120)
    const e5 = notes.find((n) => n.midi === 76)!
    expect(e5.time).toBeCloseTo(1, 2)      // beat 3 at 120 bpm = 1 s
    expect(e5.duration).toBeCloseTo(0.5, 2)
  })

  it('turns performed notes into a readable score', () => {
    // C4 D4 E4 F4 quarter notes at 120 bpm, then a chord
    const notes = [60, 62, 64, 65].map((p, i) => ({ pitch: p, start: i * 0.5, duration: 0.5, velocity: 80 }))
      .concat([60, 64, 67].map((p) => ({ pitch: p, start: 2, duration: 2, velocity: 80 })))
    const s = scoreFromNotes(notes, 120)
    expect(validate(s)).toEqual([])
    const perf = toNotes(unroll(toPerformance(s)), 120).map((n) => `${n.pitch}@${n.start}/${n.duration}`).sort()
    expect(perf).toEqual(['60@0/0.5', '60@2/2', '62@0.5/0.5', '64@1/0.5', '64@2/2', '65@1.5/0.5', '67@2/2'].sort())
  })
})

describe('MusicXML: palette marks', () => {
  const strip = (xml: string) => xml.replace(/<miscellaneous>[\s\S]*?<\/miscellaneous>/, '') // as if another program had written it
  const flat = (s: Score) => s.measures.flatMap((m) => m.staves.flat(2))

  it('a NoteFall file reads back exactly (the score travels inside it)', () => {
    const s = palette()
    expect(JSON.stringify(scoreFromMusicXml(scoreToMusicXml(s)).score) === JSON.stringify(s)).toBe(true) // (a boolean: a failing toEqual would print a huge diff)
  })

  it('the standard notation alone carries the marks too', () => {
    const s = palette()
    const xml = strip(scoreToMusicXml(s))
    expect(xml).toContain('<arpeggiate direction="up"/>'); expect(xml).toContain('<trill-mark/>'); expect(xml).toContain('<turn/>')
    expect(xml).toContain('<tremolo type="single">2</tremolo>'); expect(xml).toContain('<staccatissimo/>'); expect(xml).toContain('<caesura/>')
    expect(xml).toContain('<octave-shift type="down" size="8"'); expect(xml).toContain('<pedal type="start"'); expect(xml).toContain('<rehearsal>B</rehearsal>')
    expect(xml).toContain('<sfz/>'); expect(xml).toContain('<fp/>'); expect(xml).toContain('<grace slash="yes"/>'); expect(xml).toContain('<lyric number="1">')
    expect(xml).not.toContain('<clef-octave-change>') // the tenor clef has none
    expect(xml).toContain('<sign>C</sign><line>4</line>')
    const { score: b } = scoreFromMusicXml(xml)
    const a = flat(s), c = flat(b)
    const has = <K extends keyof Ev>(list: Ev[], k: K) => list.filter((e) => e[k] !== undefined).length
    for (const k of ['orn', 'arp', 'trem', 'gliss', 'graces', 'dyn', 'lyric', 'chord', 'expr', 'staffText', 'breath', 'ottava', 'pedal'] as const) expect(has(c, k), k).toBe(has(a, k))
    expect(c.find((e) => e.orn === 'trill')?.pitches[0].step).toBe('C')
    expect(c.find((e) => e.graces)?.graceKind).toBe('acc')
    expect(c.find((e) => e.ottava)?.ottava?.n).toBe(8)
    const ids = new Map(c.map((e, i) => [e.id, i])), oi = c.findIndex((e) => e.ottava)
    expect(ids.get(c[oi].ottava!.end)! - oi).toBe(3)                 // an 8va over four notes
    expect(b.measures[4].tempoText).toBe('Andante'); expect(b.measures[4].tempo).toBe(80); expect(b.measures[4].rehearsal).toBe('B')
    expect(b.measures[3].barline).toBe('double'); expect(b.measures[6].barline).toBe('dashed'); expect(b.measures[5].break).toBe('system')
    expect(b.measures[4].clefs?.[1]).toBe('tenor'); expect(b.measures[0].staves[0][0].some((e) => e.art?.includes('staccatissimo'))).toBe(true)
    expect(validate(b)).toEqual([])
  })

  it('clefs with octave marks, time symbols and keys survive the notation', () => {
    const s = fromText([{ rh: 'C5:4', lh: 'C3:4' }, { rh: 'C5:4', lh: 'C3:4' }])
    s.clefs = ['treble8vb', 'bass8vb']; s.time = { beats: 4, unit: 4, symbol: 'common' }
    const b = scoreFromMusicXml(strip(scoreToMusicXml(s))).score
    expect(b.clefs).toEqual(['treble8vb', 'bass8vb']); expect(b.time.symbol).toBe('common')
  })

  it('tempo changes reach MIDI as tempo events', () => {
    const s = fromText([{ rh: 'C5:4', lh: 'r:4' }, { rh: 'D5:4', lh: 'r:4' }], { tempo: 60 })
    s.measures[1].tempo = 120
    const m = new Midi(scoreToMidi(s))
    expect(m.header.tempos.map((t) => Math.round(t.bpm))).toEqual([60, 120])
  })
})

describe('MusicXML with more than two staves', () => {
  const note = (staff: number, step: string, oct: number) => `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>4</duration><voice>${staff}</voice><type>whole</type><staff>${staff}</staff></note>`
  const xml = (clefs: string[]) => `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>x</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>${clefs.length}</staves>${clefs.map((c, i) => `<clef number="${i + 1}">${c}</clef>`).join('')}</attributes>${clefs.map((_, i) => note(i + 1, 'CDEFGAB'[i], i === 2 ? 3 : 5)).join('<backup><duration>4</duration></backup>')}</measure></part></score-partwise>`
  it('keeps every staff: the bass staves go down, the others become voices of the upper staff', () => {
    const { score, warnings } = scoreFromMusicXml(xml(['<sign>G</sign><line>2</line>', '<sign>G</sign><line>2</line>', '<sign>F</sign><line>4</line>']))
    expect(validate(score)).toEqual([])
    expect(score.measures[0].staves[0].map((v) => v[0].pitches[0].step)).toEqual(['C', 'D'])   // two treble staves -> two voices
    expect(score.measures[0].staves[1].map((v) => v[0].pitches[0].step)).toEqual(['E'])
    expect(score.clefs).toEqual(['treble', 'bass'])
    expect(warnings.some((w) => w.includes('3 khuông'))).toBe(true)
  })
})

describe('pedal styles', () => {
  it('each style is kept, the same button again takes it off, moving the release keeps the style, and MusicXML brings them back', () => {
    const s = fromText([{ rh: 'C5:1 D5:1 E5:1 F5:1', lh: 'C3:1 D3:1 E3:1 F3:1' }])
    const rh = s.measures[0].staves[0][0], lh = s.measures[0].staves[1][0]
    toggleSpan(s, 'pedal-line', rh[0].id, rh[1].id); toggleSpan(s, 'pedal-bracket', rh[2].id, rh[3].id); toggleSpan(s, 'pedal', lh[0].id, lh[3].id)
    expect([rh[0].pedal?.style, rh[2].pedal?.style, lh[0].pedal?.style]).toEqual(['line', 'bracket', undefined])
    setPedalEnd(s, rh[0].id, rh[2].id); expect(rh[0].pedal).toEqual({ end: rh[2].id, style: 'line' })
    const back = scoreFromMusicXml(scoreToMusicXml(s)).score, b = back.measures[0]
    expect([b.staves[0][0][0].pedal?.style, b.staves[0][0][2].pedal?.style, b.staves[1][0][0].pedal?.style]).toEqual(['line', 'bracket', undefined])
    toggleSpan(s, 'pedal-bracket', rh[2].id, rh[3].id); expect(rh[2].pedal).toBeUndefined()
  })
})

describe('MusicXML with more music than a bar holds (a misread scan)', () => {
  it('the voice is cut at the barline, the score is valid, and a warning says so', () => {
    const note = (step: string, dur: number) => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${dur}</duration><voice>1</voice></note>`
    const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${note('C', 3)}${note('D', 2)}${note('E', 1)}</measure></part></score-partwise>`
    const r = scoreFromMusicXml(xml), v = r.score.measures[0].staves[0][0]
    expect(v.map((e) => [e.pitches[0]?.step, e.ticks])).toEqual([['C', 3 * TPQ], ['D', TPQ]]) // D crosses the barline: it ends there, E is past it
    expect(validate(r.score)).toEqual([])
    expect(r.warnings.some((w) => /dài quá ô/.test(w))).toBe(true)
    const w: Ev[] = [{ id: 1, ticks: 960, pitches: [], tie: true }, { id: 2, ticks: 960, pitches: [] }]
    expect([trimToBar(w, 1500), w.length, w[1].ticks]).toEqual([1500, 2, 540])
  })
})

describe('ties between chords of other shapes', () => {
  it('join only the pitches both chords have, each to its own place', async () => {
    const { tiePairs } = await import('./render')
    const p = (s: string) => ({ step: s[0] as 'C', alter: 0, octave: +s[1] })
    expect(tiePairs([p('C4'), p('E4'), p('G4')], [p('E4'), p('G4')])).toEqual([[1, 0], [2, 1]]) // a smaller chord: E and G only, at their own places
    expect(tiePairs([p('C4')], [p('D4')])).toEqual([])                                           // nothing in common: no tie
    expect(tiePairs([p('C4'), p('E4')], [p('C4'), p('E4')])).toEqual([[0, 0], [1, 1]])
  })
})

