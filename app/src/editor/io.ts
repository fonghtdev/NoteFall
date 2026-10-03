import { Midi } from '@tonejs/midi'
import { unzipSync, strFromU8 } from 'fflate'
import { parseMidi } from '../core/midi'
import type { Note } from '../core/models'
import { tempoRatios, toNotes, unroll } from '../core/score/playback'
import { CLEFS, TPQ, barTicks, blankMeasure, clefAt, type BarlineKind, type ClefName, type Orn, contextAt, emptyScore, midiOf, newId, nominalTicks, notationOf, putNote, spell, splitLength, starts, validate, type Art, type Dyn, type Ev, type Measure, type Pitch, type Score, type StepName } from './model'
import { toPerformance } from './perform'

const download = (name: string, data: BlobPart, type: string) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([data], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 60000)
}
const fileName = (s: Score, ext: string) => `${(s.title || 'bản nhạc').replace(/[\\/:*?"<>|]+/g, '-')}.${ext}`

// ---- JSON (the app's own format) ------------------------------------------------------------------------
export const scoreToJson = (s: Score) => JSON.stringify({ format: 'notefall-score', version: 1, score: s }, null, 1)
export function scoreFromJson(text: string): Score {
  const d = JSON.parse(text)
  if (d?.format !== 'notefall-score' || !d.score?.measures) throw new Error('không phải file bản soạn của NoteFall')
  const s = d.score as Score
  const bad = validate(s)
  if (bad.length) throw new Error('bản soạn bị lỗi nhịp: ' + bad[0])
  return s
}
export const saveJson = (s: Score) => download(fileName(s, 'notefall.json'), scoreToJson(s), 'application/json')

// ---- MIDI export ----------------------------------------------------------------------------------------
export function scoreToMidi(s: Score): Uint8Array {
  const midi = new Midi()
  midi.header.setTempo(s.tempo)
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [s.time.beats, s.time.unit] })
  midi.header.name = s.title
  const pf = toPerformance(s), changes = tempoRatios(pf)
  for (const c of changes) midi.header.tempos.push({ ticks: Math.round(c.at * midi.header.ppq), bpm: s.tempo * c.ratio })
  midi.header.update() // works out each tempo's time in seconds; without it the library cannot convert times and never returns
  const timed = toNotes(unroll(pf), s.tempo, 85, changes)
  const perf = unroll(pf)
  const tracks = s.clefs.map((_, i) => { const t = midi.addTrack(); t.name = i === 0 ? 'Right hand' : 'Left hand'; return t })
  timed.forEach((n, i) => tracks[perf[i].staff]?.addNote({ midi: n.pitch, time: n.start, duration: n.duration, velocity: 0.7 }))
  return midi.toArray()
}
export const exportMidi = (s: Score) => download(fileName(s, 'mid'), scoreToMidi(s).slice().buffer as ArrayBuffer, 'audio/midi')

// ---- MusicXML export ------------------------------------------------------------------------------------
const XML_TYPE: Record<string, string> = { w: 'whole', h: 'half', q: 'quarter', '8': 'eighth', '16': '16th', '32': '32nd', '64': '64th' }
const esc = (t: string) => t.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)

const CLEF_XML: Record<ClefName, { sign: string; line: number; oct: number }> = {
  treble: { sign: 'G', line: 2, oct: 0 }, bass: { sign: 'F', line: 4, oct: 0 }, alto: { sign: 'C', line: 3, oct: 0 }, tenor: { sign: 'C', line: 4, oct: 0 },
  treble8vb: { sign: 'G', line: 2, oct: -1 }, treble8va: { sign: 'G', line: 2, oct: 1 }, bass8vb: { sign: 'F', line: 4, oct: -1 }, bass8va: { sign: 'F', line: 4, oct: 1 },
}
const ORN_XML: Record<Orn, string> = { mordent: '<mordent/>', inverted: '<inverted-mordent/>', trill: '<trill-mark/>', turn: '<turn/>' }
const BAR_XML: Record<BarlineKind, string> = { single: 'regular', double: 'light-light', final: 'light-heavy', dashed: 'dashed', dotted: 'dotted', none: 'none' }

export function scoreToMusicXml(s: Score): string {
  const o: string[] = []
  o.push('<?xml version="1.0" encoding="UTF-8"?>')
  o.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">')
  o.push('<score-partwise version="3.1">')
  o.push(`<work><work-title>${esc(s.title)}</work-title></work>`)
  o.push(`<identification><creator type="composer">${esc(s.composer)}</creator><encoding><software>NoteFall</software></encoding><miscellaneous><miscellaneous-field name="notefall-score">${esc(JSON.stringify(s))}</miscellaneous-field></miscellaneous></identification>`) // the whole score, so opening it again here loses nothing
  o.push('<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>')
  o.push('<part id="P1">')
  // spans end on a different event than they start on: remember which events close what
  const slurEnd = new Map<number, number[]>(), wedgeEnd = new Map<number, number[]>()
  let spanNo = 0
  const slurNo = new Map<number, number>(), wedgeNo = new Map<number, number>()
  const ottEnd = new Map<number, { no: number; size: number }[]>(), pedEnd = new Map<number, number[]>(), glissEnd = new Map<number, number>(), glissStart = new Map<number, number>(), hyph = new Map<number, string>()
  s.measures.forEach((m) => m.staves.forEach((vs) => vs.forEach((v) => v.forEach((e, k, arr) => {
    if (e.ottava) ottEnd.set(e.ottava.end, [...(ottEnd.get(e.ottava.end) ?? []), { no: (spanNo++ % 6) + 1, size: Math.abs(e.ottava.n) }])
    if (e.pedal) pedEnd.set(e.pedal.end, [...(pedEnd.get(e.pedal.end) ?? []), (spanNo++ % 6) + 1])
    void k; void arr
  }))))
  s.clefs.forEach((_, si) => { for (let vi = 0; vi < 8; vi++) { // glissando and lyrics follow the notes of one voice across bars
    const chain = s.measures.flatMap((m) => m.staves[si]?.[vi] ?? [])
    chain.forEach((e, k) => {
      if (e.gliss && chain[k + 1]?.pitches.length) { const n = (spanNo++ % 6) + 1; glissEnd.set(chain[k + 1].id, n); glissStart.set(e.id, n) }
      if (e.lyric) { const prev = chain.slice(0, k).reverse().find((x) => x.lyric); hyph.set(e.id, e.lyric.endsWith('-') ? (prev?.lyric?.endsWith('-') ? 'middle' : 'begin') : prev?.lyric?.endsWith('-') ? 'end' : 'single') }
    })
  } })
  s.measures.forEach((m) => m.staves.forEach((vs) => vs.forEach((v) => v.forEach((e) => {
    if (e.slur !== undefined) { const n = (spanNo++ % 6) + 1; slurNo.set(e.id, n); slurEnd.set(e.slur, [...(slurEnd.get(e.slur) ?? []), n]) }
    if (e.hairpin) { const n = (spanNo++ % 6) + 1; wedgeNo.set(e.id, n); wedgeEnd.set(e.hairpin.end, [...(wedgeEnd.get(e.hairpin.end) ?? []), n]) }
  }))))
  s.measures.forEach((m, i) => {
    const ctx = contextAt(s, i), bar = barTicks(ctx.time)
    o.push(`<measure number="${i + 1}">`)
    const first = i === 0
    const brk = s.measures[i - 1]?.break
    if (brk) o.push(brk === 'page' ? '<print new-page="yes"/>' : '<print new-system="yes"/>')
    const clefXml = (c: ClefName, si: number) => { const { sign, line, oct } = CLEF_XML[c]; return `<clef number="${si + 1}"><sign>${sign}</sign><line>${line}</line>${oct ? `<clef-octave-change>${oct}</clef-octave-change>` : ''}</clef>` }
    if (first || m.key !== undefined || m.time || m.clefs?.some(Boolean)) {
      o.push('<attributes>')
      if (first) o.push(`<divisions>${TPQ}</divisions>`)
      if (first || m.key !== undefined) o.push(`<key><fifths>${ctx.key}</fifths></key>`)
      if (first || m.time) o.push(`<time${ctx.time.symbol ? ` symbol="${ctx.time.symbol === 'cut' ? 'cut' : 'common'}"` : ''}><beats>${ctx.time.beats}</beats><beat-type>${ctx.time.unit}</beat-type></time>`)
      if (first) o.push(`<staves>${s.clefs.length}</staves>`)
      s.clefs.forEach((_, si) => { if (first || m.clefs?.[si]) o.push(clefXml(clefAt(s, i, si), si)) })
      o.push('</attributes>')
    }
    if (m.rehearsal) o.push(`<direction placement="above"><direction-type><rehearsal>${esc(m.rehearsal)}</rehearsal></direction-type></direction>`)
    if (first || (m.tempo || m.tempoText) && !m.tempoAt) {
      const bpm = first ? s.tempo : m.tempo
      o.push(`<direction placement="above">${m.tempoText ? `<direction-type><words>${esc(m.tempoText)}</words></direction-type>` : ''}${bpm ? `<direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/>` : ''}</direction>`)
    }
    const prevVolta = JSON.stringify(s.measures[i - 1]?.volta), thisVolta = JSON.stringify(m.volta)
    const endingStart = m.volta?.length && prevVolta !== thisVolta
    if (m.startRepeat || endingStart) {
      o.push(`<barline location="left">${m.startRepeat ? '<bar-style>heavy-light</bar-style>' : ''}${endingStart ? `<ending number="${m.volta!.join(',')}" type="start"/>` : ''}${m.startRepeat ? '<repeat direction="forward"/>' : ''}</barline>`)
    }
    // navigation marks live in directions: segno/coda/fine/to-coda and the D.C./D.S. jump
    const sounds: string[] = []
    if (m.segno) sounds.push('<direction placement="above"><direction-type><segno/></direction-type><sound segno="segno"/></direction>')
    if (m.coda) sounds.push('<direction placement="above"><direction-type><coda/></direction-type><sound coda="coda"/></direction>')
    sounds.forEach((d) => o.push(d))
    let wrote = 0
    m.staves.forEach((voices, si) => voices.forEach((events, vi) => {
      if (wrote) o.push(`<backup><duration>${bar}</duration></backup>`)
      wrote++
      events.forEach((e, k) => {
        const prev = events[k - 1] ?? (i > 0 ? s.measures[i - 1].staves[si]?.[vi]?.slice(-1)[0] : undefined)
        const stop = !!prev?.tie && prev.pitches.length > 0 && e.pitches.length > 0
        const nt = notationOf(nominalTicks(e))
        const rest = e.pitches.length === 0
        const dirs: string[] = []
        if (si === 0 && vi === 0 && m.tempoAt && starts(events)[k] === m.tempoAt && (m.tempo || m.tempoText)) o.push(`<direction placement="above">${m.tempoText ? `<direction-type><words>${esc(m.tempoText)}</words></direction-type>` : ''}${m.tempo ? `<direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${m.tempo}</per-minute></metronome></direction-type><sound tempo="${m.tempo}"/>` : ''}</direction>`)
        if (e.dyn) dirs.push(`<dynamics><${e.dyn}/></dynamics>`)
        if (e.staffText) dirs.push(`<words>${esc(e.staffText)}</words>`)
        if (e.expr) dirs.push(`<words font-style="italic">${esc(e.expr)}</words>`)
        if (e.ottava) { const n = ottEnd.get(e.ottava.end)?.[0].no ?? 1; dirs.push(`<octave-shift type="${e.ottava.n > 0 ? 'down' : 'up'}" size="${Math.abs(e.ottava.n)}" number="${n}"/>`) } // 8va: written lower than it sounds
        if (e.pedal) dirs.push(`<pedal type="start" line="yes" number="${pedEnd.get(e.pedal.end)?.[0] ?? 1}"/>`)

        if (e.hairpin) dirs.push(`<wedge type="${e.hairpin.type === 'cresc' ? 'crescendo' : 'diminuendo'}" number="${wedgeNo.get(e.id)}"/>`)
        for (const n of wedgeEnd.get(e.id) ?? []) dirs.push(`<wedge type="stop" number="${n}"/>`)
        dirs.forEach((d) => o.push(`<direction placement="below"><direction-type>${d}</direction-type><staff>${si + 1}</staff></direction>`))
        const pieces = rest ? [null] : e.pitches
        if (e.chord) { const mm = /^([A-G])([#b♯♭]?)(.*)$/.exec(e.chord); o.push(mm ? `<harmony><root><root-step>${mm[1]}</root-step>${mm[2] ? `<root-alter>${mm[2] === '#' || mm[2] === '♯' ? 1 : -1}</root-alter>` : ''}</root><kind text="${esc(mm[3])}">other</kind></harmony>` : `<direction placement="above"><direction-type><words>${esc(e.chord)}</words></direction-type><staff>${si + 1}</staff></direction>`) }
        if (e.graces?.length) e.graces.forEach((g) => o.push(`<note><grace slash="${e.graceKind === 'acc' ? 'yes' : 'no'}"/><pitch><step>${g.step}</step>${g.alter ? `<alter>${g.alter}</alter>` : ''}<octave>${g.octave}</octave></pitch><voice>${si * 4 + vi + 1}</voice><type>eighth</type><staff>${si + 1}</staff></note>`))
        pieces.forEach((p, pi) => {
          o.push(rest && e.hidden ? '<note print-object="no">' : '<note>')
          if (pi > 0) o.push('<chord/>')
          if (rest) o.push(e.ticks === bar && voices.length === 1 ? '<rest measure="yes"/>' : '<rest/>')
          else o.push(`<pitch><step>${p!.step}</step>${p!.alter ? `<alter>${p!.alter}</alter>` : ''}<octave>${p!.octave}</octave></pitch>`)
          o.push(`<duration>${e.ticks}</duration>`)
          if (!rest && stop) o.push('<tie type="stop"/>')
          if (!rest && e.tie) o.push('<tie type="start"/>')
          o.push(`<voice>${si * 4 + vi + 1}</voice>`)
          if (nt) { o.push(`<type>${XML_TYPE[nt.name]}</type>`); for (let d = 0; d < nt.dots; d++) o.push('<dot/>') }
          if (e.tup) o.push(`<time-modification><actual-notes>${e.tup.n}</actual-notes><normal-notes>${e.tup.m}</normal-notes></time-modification>`)
          o.push(`<staff>${si + 1}</staff>`)
          const last = pi === pieces.length - 1
          const bits: string[] = []
          if (!rest && stop) bits.push('<tied type="stop"/>')
          if (!rest && e.tie) bits.push('<tied type="start"/>')
          if (e.tup) {
            const idx = events.filter((x) => x.tup?.group === e.tup!.group)
            if (idx[0] === e && pi === 0) bits.push('<tuplet type="start"/>')
            if (idx[idx.length - 1] === e && pi === 0) bits.push('<tuplet type="stop"/>')
          }
          if (pi === 0 && slurNo.has(e.id)) bits.push(`<slur type="start" number="${slurNo.get(e.id)}"/>`)
          if (pi === 0) for (const n of slurEnd.get(e.id) ?? []) bits.push(`<slur type="stop" number="${n}"/>`)
          const orns = (!rest && e.orn && last ? [ORN_XML[e.orn]] : []).concat(!rest && e.trem && pi === 0 ? [`<tremolo type="single">${e.trem}</tremolo>`] : [])
          if (orns.length) bits.push(`<ornaments>${orns.join('')}</ornaments>`)
          if (!rest && e.arp && e.pitches.length > 1) bits.push(`<arpeggiate${e.arp === 'plain' ? '' : ` direction="${e.arp}"`}/>`)
          if (!rest && pi === 0 && glissStart.has(e.id)) bits.push(`<glissando type="start" line-type="${e.gliss === 'wavy' ? 'wavy' : 'solid'}" number="${glissStart.get(e.id)}"/>`)
          if (!rest && pi === 0 && glissEnd.has(e.id)) bits.push(`<glissando type="stop" number="${glissEnd.get(e.id)}"/>`)
          if (e.art?.length && (pi === 0 || rest)) {
            const ARTS: Partial<Record<Art, string>> = { staccato: '<staccato/>', accent: '<accent/>', tenuto: '<tenuto/>', marcato: '<strong-accent/>', staccatissimo: '<staccatissimo/>' }
            const list = e.art.map((a) => ARTS[a]).filter(Boolean).join('') + (pi === 0 && e.breath ? (e.breath === 'breath' ? '<breath-mark/>' : '<caesura/>') : '')
            if (list) bits.push(`<articulations>${list}</articulations>`)
            const tech = e.art.map((a) => (a === 'upbow' ? '<up-bow/>' : a === 'downbow' ? '<down-bow/>' : '')).join('')
            if (tech) bits.push(`<technical>${tech}</technical>`)
            if (e.art.includes('fermata')) bits.push('<fermata/>')
          } else if (pi === 0 && e.breath) bits.push(`<articulations>${e.breath === 'breath' ? '<breath-mark/>' : '<caesura/>'}</articulations>`)
          if (bits.length) o.push(`<notations>${bits.join('')}</notations>`)
          if (pi === 0 && e.lyric) o.push(`<lyric number="1"><syllabic>${hyph.get(e.id) ?? 'single'}</syllabic><text>${esc(e.lyric.replace(/-$/, ''))}</text></lyric>`)
          o.push('</note>')
        })
        const stops = [...(ottEnd.get(e.id) ?? []).map((q) => `<octave-shift type="stop" size="${q.size}" number="${q.no}"/>`), ...(pedEnd.get(e.id) ?? []).map((n) => `<pedal type="stop" line="yes" number="${n}"/>`)]
        stops.forEach((d) => o.push(`<direction placement="below"><direction-type>${d}</direction-type><staff>${si + 1}</staff></direction>`))
      })
    }))
    // marks that act at the END of the bar
    if (m.fine) o.push('<direction placement="above"><direction-type><words>Fine</words></direction-type><sound fine="yes"/></direction>')
    if (m.toCoda) o.push('<direction placement="above"><direction-type><words>To Coda</words></direction-type><sound tocoda="coda"/></direction>')
    if (m.jump) {
      const al = m.jump.al === 'fine' ? ' al Fine' : m.jump.al === 'coda' ? ' al Coda' : ''
      o.push(`<direction placement="above"><direction-type><words>${m.jump.kind === 'dc' ? 'D.C.' : 'D.S.'}${al}</words></direction-type><sound ${m.jump.kind === 'dc' ? 'dacapo="yes"' : 'dalsegno="segno"'}/></direction>`)
    }
    const endingStop = m.volta?.length && JSON.stringify(s.measures[i + 1]?.volta) !== thisVolta
    if (m.endRepeat || endingStop || m.barline) {
      o.push(`<barline location="right">${m.endRepeat ? '<bar-style>light-heavy</bar-style>' : m.barline ? `<bar-style>${BAR_XML[m.barline]}</bar-style>` : ''}${endingStop ? `<ending number="${m.volta!.join(',')}" type="${m.endRepeat ? 'stop' : 'discontinue'}"/>` : ''}${m.endRepeat ? '<repeat direction="backward"/>' : ''}</barline>`)
    }
    o.push('</measure>')
  })
  o.push('</part>', '</score-partwise>')
  return o.join('\n')
}
export const exportMusicXml = (s: Score) => download(fileName(s, 'musicxml'), scoreToMusicXml(s), 'application/vnd.recordare.musicxml+xml')

// ---- MusicXML import ------------------------------------------------------------------------------------
const num = (el: Element | null | undefined, sel: string, def = 0) => { const t = el?.querySelector(sel)?.textContent; return t ? Number(t) : def }

export function scoreFromMusicXml(xml: string): { score: Score; warnings: string[] } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('XML không hợp lệ')
  const root = doc.documentElement
  if (root.tagName !== 'score-partwise') throw new Error('chỉ đọc được MusicXML dạng score-partwise')
  const own = root.querySelector('miscellaneous-field[name="notefall-score"]')?.textContent // a file NoteFall wrote itself carries the whole score
  if (own) { try { const sc = JSON.parse(own) as Score; if (sc?.measures?.length && !validate(sc).length) return { score: sc, warnings: [] } } catch { /* fall through to the notation */ } }
  const warnings: string[] = []
  const parts = [...root.querySelectorAll(':scope > part')]
  if (!parts.length) throw new Error('không có phần nhạc nào')

  // (part, staff) pairs become our staves
  const lanes: { part: Element; staffNo: number }[] = []
  parts.forEach((part) => {
    const n = Math.max(1, ...[...part.querySelectorAll('attributes > staves')].map((e) => Number(e.textContent)))
    for (let k = 1; k <= n; k++) lanes.push({ part, staffNo: k })
  })
  if (lanes.length > 8) warnings.push(`có ${lanes.length} khuông, chỉ lấy 8 khuông đầu`)
  const used = lanes.slice(0, 8)
  if (used.length > 2) warnings.push(`có ${used.length} khuông: khuông khoá Fa/bass vào khuông dưới, các khuông còn lại vào khuông trên (mỗi khuông thành một giọng)`)

  const s = emptyScore(0)
  s.title = root.querySelector('work > work-title, movement-title')?.textContent?.trim() || 'Không tên'
  s.composer = root.querySelector('creator[type="composer"]')?.textContent?.trim() ?? ''
  s.clefs = ['treble', 'bass']
  s.measures = []
  let divisions = 1
  const clefOf: ClefName[] = used.map((_, i) => (i === 1 && used.length === 2 ? 'bass' : 'treble')), curClef: ClefName[] = [...clefOf]
  let time = { beats: 4, unit: 4 }, key = 0, tempo: number | undefined
  let tied: Record<string, boolean> = {}
  let unsupported = 0

  // marks that run across bars (slurs, wedges, tuplets) are tracked per staff
  const laneState = used.map(() => ({ words: [] as { text: string; italic: boolean }[], ott: new Map<string, Ev>(), ottPending: [] as { n: 8 | -8 | 15 | -15; no: string }[], ped: new Map<string, Ev>(), pedPending: [] as string[], gliss: new Map<string, { ev: Ev; wavy: boolean }>(), harmony: undefined as string | undefined, lastEv: undefined as Ev | undefined, slurs: new Map<string, Ev>(), wedge: undefined as { ev: Ev; type: 'cresc' | 'dim' } | undefined, wedgeStart: undefined as 'cresc' | 'dim' | undefined, wedgeStop: false, dyn: undefined as Dyn | undefined, tupGroup: 0, tupCount: 0, tupN: 0 }))
  const DYNS: Dyn[] = ['pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'sf', 'sfz', 'fp', 'sfp', 'rfz']
  const TEMPO_WORDS = /^(rit|ritard|rall|accel|a tempo|largo|lento|grave|adagio|andante|moderato|allegretto|allegro|vivace|presto)/i
  const nMeasures = Math.max(...used.map((u) => u.part.querySelectorAll(':scope > measure').length))
  let endingOpen: number[] | undefined, endingClose = false
  for (let mi = 0; mi < nMeasures; mi++) {
    const m: Measure = { staves: [] }
    used.forEach((lane_, si) => {
      const lane = lane_
      const st = laneState[si]
      const me = lane.part.querySelectorAll(':scope > measure')[mi]
      const voices = new Map<string, Ev[]>()
      let pos = 0, last: { ev: Ev; voice: string } | undefined
      const pendingGraces: Pitch[] = []
      let graceKind: 'acc' | 'app' = 'app'
      if (me) {
        for (const el of [...me.children]) {
          if (el.tagName === 'attributes') {
            divisions = num(el, 'divisions', divisions) || divisions
            const f = el.querySelector('key > fifths'); if (f && si === 0) { key = Number(f.textContent); if (mi === 0) s.key = key; else m.key = key }
            const b = el.querySelector('time > beats'), u = el.querySelector('time > beat-type')
            if (b && u && si === 0) { const sym = el.querySelector('time')?.getAttribute('symbol'); time = { beats: Number(b.textContent), unit: Number(u.textContent), ...(sym === 'common' ? { symbol: 'common' as const } : sym === 'cut' ? { symbol: 'cut' as const } : {}) }; if (mi === 0) s.time = time; else m.time = time }
            el.querySelectorAll('clef').forEach((c) => {
              const no = Number(c.getAttribute('number') ?? 1)
              if (no === lane.staffNo) {
                const sign = c.querySelector('sign')?.textContent ?? 'G', line = num(c, 'line', sign === 'F' ? 4 : sign === 'C' ? 3 : 2), oct = num(c, 'clef-octave-change')
                const name = (Object.keys(CLEF_XML) as ClefName[]).find((k) => CLEF_XML[k].sign === sign && CLEF_XML[k].line === line && CLEF_XML[k].oct === oct)
                if (!name) warnings.push(`khoá ${sign}${line} chưa hỗ trợ, hiển thị như khoá ${sign === 'F' ? 'Fa' : 'Sol'}`)
                const c2: ClefName = name ?? (sign === 'F' ? 'bass' : 'treble')
                if (mi === 0) clefOf[si] = c2
                else if (c2 !== curClef[si]) { m.clefs = m.clefs ?? used.map(() => undefined); m.clefs[si] = c2 }
                curClef[si] = c2
              }
            })
          } else if (el.tagName === 'direction') {
            const t = el.querySelector('sound')?.getAttribute('tempo') ?? el.querySelector('metronome > per-minute')?.textContent; if (t && si === 0) { tempo = Math.round(Number(t)); if (mi === 0) s.tempo = tempo; else m.tempo = tempo }
            if (t && si === 0 && pos > 0 && mi > 0) m.tempoAt = pos // after some music of the bar: a change in the middle of it
            const rh = el.querySelector('rehearsal')?.textContent; if (rh && si === 0) m.rehearsal = rh.trim()
            const dirWords = el.querySelector('words')?.textContent?.trim()
            if (dirWords && si === 0 && (t || (!el.querySelector('sound') && !voices.size && TEMPO_WORDS.test(dirWords)))) m.tempoText = dirWords
            const snd = el.querySelector('sound')
            if (snd && si === 0) { // navigation
              if (snd.getAttribute('segno')) m.segno = true
              if (snd.getAttribute('coda')) m.coda = true
              if (snd.getAttribute('tocoda')) m.toCoda = true
              if (snd.getAttribute('fine')) m.fine = true
              const words = (el.querySelector('words')?.textContent ?? '').toLowerCase()
              const al = /al\s+fine/.test(words) ? 'fine' : /al\s+coda/.test(words) ? 'coda' : 'end'
              if (snd.getAttribute('dacapo')) m.jump = { kind: 'dc', al }
              if (snd.getAttribute('dalsegno')) m.jump = { kind: 'ds', al }
            }
            if (num(el, 'staff', 1) === lane.staffNo) {
              const dn = el.querySelector('dynamics')?.firstElementChild?.tagName as Dyn | undefined
              if (dn && DYNS.includes(dn)) st.dyn = dn
              if (dirWords && !t && !el.querySelector('sound') && !(!voices.size && si === 0 && TEMPO_WORDS.test(dirWords))) st.words.push({ text: dirWords, italic: el.querySelector('words')?.getAttribute('font-style') === 'italic' })
              const os = el.querySelector('octave-shift')
              if (os) {
                const ty = os.getAttribute('type'), no = os.getAttribute('number') ?? '1', size = Number(os.getAttribute('size') ?? 8) >= 15 ? 15 : 8
                if (ty === 'down' || ty === 'up') st.ottPending.push({ n: (ty === 'down' ? size : -size) as 8 | -8 | 15 | -15, no }) // 8va: written lower than it sounds
                else if (ty === 'stop') { const a = st.ott.get(no); if (a?.ottava && st.lastEv) { a.ottava.end = st.lastEv.id; st.ott.delete(no) } }
              }
              const pd = el.querySelector('pedal')
              if (pd) {
                const ty = pd.getAttribute('type'), no = pd.getAttribute('number') ?? '1'
                if (ty === 'start') st.pedPending.push(no)
                else if (ty === 'stop') { const a = st.ped.get(no); if (a?.pedal && st.lastEv) { a.pedal.end = st.lastEv.id; st.ped.delete(no) } }
              }
              const wt = el.querySelector('wedge')?.getAttribute('type')
              if (wt === 'crescendo') st.wedgeStart = 'cresc'
              else if (wt === 'diminuendo') st.wedgeStart = 'dim'
              else if (wt === 'stop') st.wedgeStop = true
            }
          } else if (el.tagName === 'print' && si === 0 && mi > 0) {
            if (el.getAttribute('new-page') === 'yes') s.measures[mi - 1].break = 'page'
            else if (el.getAttribute('new-system') === 'yes') s.measures[mi - 1].break = 'system'
          } else if (el.tagName === 'harmony') {
            let nx = el.nextElementSibling
            while (nx && nx.tagName !== 'note') nx = nx.nextElementSibling
            if (nx && num(nx, 'staff', 1) === lane.staffNo) {
              const alter = num(el, 'root-alter')
              st.harmony = `${el.querySelector('root-step')?.textContent ?? ''}${alter > 0 ? '#' : alter < 0 ? 'b' : ''}${el.querySelector('kind')?.getAttribute('text') ?? ''}`
            }
          } else if (el.tagName === 'barline' && si === 0) {
            const bs = el.querySelector('bar-style')?.textContent
            if (el.getAttribute('location') !== 'left' && bs && !el.querySelector('repeat')) { const k = (Object.keys(BAR_XML) as BarlineKind[]).find((b) => BAR_XML[b] === bs); if (k && k !== 'single') m.barline = k }
            const r = el.querySelector('repeat')?.getAttribute('direction')
            if (r === 'forward') m.startRepeat = true
            if (r === 'backward') m.endRepeat = true
            const end = el.querySelector('ending')
            if (end) {
              const type = end.getAttribute('type')
              const nums = (end.getAttribute('number') ?? '1').split(/[,\s]+/).map(Number).filter((n) => n > 0)
              if (type === 'start') endingOpen = nums
              else if (type === 'stop' || type === 'discontinue') endingClose = true
            }
          } else if (el.tagName === 'backup') pos -= num(el, 'duration')
          else if (el.tagName === 'forward') pos += num(el, 'duration')
          else if (el.tagName === 'note') {
            const staffNo = num(el, 'staff', 1)
            if (staffNo !== lane.staffNo) continue
            if (el.querySelector('grace')) {
              const gp = el.querySelector('pitch')
              if (gp) { pendingGraces.push(readPitch(gp)); graceKind = el.querySelector('grace')?.getAttribute('slash') === 'yes' ? 'acc' : 'app' }
              continue
            }
            const voice = el.querySelector('voice')?.textContent ?? '1'
            const chord = !!el.querySelector('chord')
            const ticks = Math.round((num(el, 'duration') * TPQ) / divisions)
            const arr = voices.get(voice) ?? []
            if (!voices.has(voice)) voices.set(voice, arr)
            const pitchEl = el.querySelector('pitch')
            if (chord && last) {
              if (pitchEl) { last.ev.pitches.push(readPitch(pitchEl)); const ar = el.querySelector('arpeggiate'); if (ar && !last.ev.arp) last.ev.arp = ar.getAttribute('direction') === 'down' ? 'down' : ar.getAttribute('direction') === 'up' ? 'up' : 'plain' }
              continue
            }
            // anything between the end of the previous event and `pos` is silence
            const have = arr.reduce((a, e) => a + e.ticks, 0)
            if (pos > have) arr.push({ id: newId(s), ticks: pos - have, pitches: [] })
            const ev: Ev = { id: newId(s), ticks, pitches: pitchEl ? [readPitch(pitchEl)] : [] }
            if (!pitchEl && el.getAttribute('print-object') === 'no') ev.hidden = true
            if (pitchEl && el.querySelector('tie[type="start"]')) ev.tie = true
            if (pitchEl && el.querySelector('ornaments > mordent')) ev.orn = 'mordent'
            if (pitchEl && el.querySelector('ornaments > inverted-mordent')) ev.orn = 'inverted'
            if (pitchEl && el.querySelector('ornaments > trill-mark')) ev.orn = 'trill'
            if (pitchEl && el.querySelector('ornaments > turn')) ev.orn = 'turn'
            const tr = pitchEl && el.querySelector('ornaments > tremolo[type="single"]'); if (tr) ev.trem = Math.min(3, Math.max(1, Math.round(Number(tr.textContent) || 1))) as 1 | 2 | 3
            const ar0 = pitchEl && el.querySelector('arpeggiate'); if (ar0) ev.arp = ar0.getAttribute('direction') === 'down' ? 'down' : ar0.getAttribute('direction') === 'up' ? 'up' : 'plain'
            const ly = el.querySelector('lyric'); if (ly && pitchEl) { const sy = ly.querySelector('syllabic')?.textContent; ev.lyric = (ly.querySelector('text')?.textContent ?? '') + (sy === 'begin' || sy === 'middle' ? '-' : '') }
            if (pitchEl && st.harmony) { ev.chord = st.harmony; st.harmony = undefined }
            for (const w of st.words.splice(0)) { if (w.italic) ev.expr = w.text; else ev.staffText = w.text }
            for (const o_ of st.ottPending.splice(0)) { ev.ottava = { n: o_.n, end: ev.id }; st.ott.set(o_.no, ev) }
            for (const no of st.pedPending.splice(0)) { ev.pedal = { end: ev.id }; st.ped.set(no, ev) }
            el.querySelectorAll('glissando').forEach((g_) => {
              const no = g_.getAttribute('number') ?? '1', ty = g_.getAttribute('type')
              if (ty === 'start') st.gliss.set(no, { ev, wavy: g_.getAttribute('line-type') === 'wavy' })
              else if (ty === 'stop') { const a = st.gliss.get(no); if (a) { a.ev.gliss = a.wavy ? 'wavy' : 'straight'; st.gliss.delete(no) } }
            })
            if (pitchEl && el.querySelector('breath-mark')) ev.breath = 'breath'
            if (pitchEl && el.querySelector('caesura')) ev.breath = 'caesura'
            if (pitchEl && pendingGraces.length) { ev.graces = pendingGraces.splice(0); ev.graceKind = graceKind }
            const tm = el.querySelector('time-modification')
            if (tm) {
              const n = num(tm, 'actual-notes'), mm = num(tm, 'normal-notes')
              if (!st.tupGroup || st.tupCount >= st.tupN || el.querySelector('tuplet[type="start"]')) { st.tupGroup = newId(s); st.tupCount = 0; st.tupN = n }
              ev.tup = { n, m: mm, group: st.tupGroup }
              st.tupCount++
            } else st.tupGroup = 0
            if (pitchEl) {
              if (st.dyn) { ev.dyn = st.dyn; st.dyn = undefined }
              if (st.wedgeStop && st.wedge) { st.wedge.ev.hairpin = { type: st.wedge.type, end: ev.id }; st.wedge = undefined }
              st.wedgeStop = false
              if (st.wedgeStart) { st.wedge = { ev, type: st.wedgeStart }; st.wedgeStart = undefined }
              const ART: Record<string, Art> = { staccato: 'staccato', accent: 'accent', tenuto: 'tenuto', 'strong-accent': 'marcato', staccatissimo: 'staccatissimo', 'up-bow': 'upbow', 'down-bow': 'downbow' }
              const arts = [...el.querySelectorAll('articulations, technical')].flatMap((g) => [...g.children]).map((a) => ART[a.tagName]).filter(Boolean)
              if (el.querySelector('fermata')) arts.push('fermata')
              if (arts.length) ev.art = arts
              el.querySelectorAll('slur').forEach((sl) => {
                const no = sl.getAttribute('number') ?? '1', type = sl.getAttribute('type')
                if (type === 'start') st.slurs.set(no, ev)
                else if (type === 'stop') { const a = st.slurs.get(no); if (a) { a.slur = ev.id; st.slurs.delete(no) } }
              })
            }
            if (ticks && !notationOf(nominalTicks(ev))) unsupported++
            arr.push(ev)
            st.lastEv = ev
            last = { ev, voice }
            pos += ticks
          }
        }
      }
      const bar = barTicks(time)
      const list = [...voices.values()].filter((v) => v.length)
      if (!list.length) list.push([])
      list.forEach((v) => {
        const sum = v.reduce((a, e) => a + e.ticks, 0)
        if (sum < bar) v.push(...splitLength(sum, bar - sum, { dots: false, bar }).map((t) => ({ id: newId(s), ticks: t, pitches: [] as Pitch[] })))
        for (const e of v) e.pitches.sort((a, b) => midiOf(a) - midiOf(b))
      })
      m.staves.push(list.slice(0, 4))
    })
    if (endingOpen) { m.volta = endingOpen; if (endingClose) { endingOpen = undefined; endingClose = false } }
    s.measures.push(m)
  }
  if (used.length > 2) { // more than two staves: gather them into the composer's two (bass-like clefs = lower staff)
    const low = (c: ClefName) => c === 'bass' || c === 'bass8vb' || c === 'bass8va' || c === 'tenor'
    const lower = used.map((_, i) => i).filter((i) => low(clefOf[i])), upper = used.map((_, i) => i).filter((i) => !low(clefOf[i]))
    if (!upper.length) upper.push(0)
    s.measures.forEach((m) => { const lanes_ = m.staves; m.staves = [upper.flatMap((i) => lanes_[i] ?? []).slice(0, 4), lower.flatMap((i) => lanes_[i] ?? []).slice(0, 4)] })
    s.clefs = [clefOf[upper[0]], lower.length ? clefOf[lower[0]] : 'bass']
    if (!lower.length) s.measures.forEach((m) => { m.staves[1] = blankMeasure(s, contextAt(s, s.measures.indexOf(m)).time).staves[1] })
  } else s.clefs = [clefOf[0], used.length > 1 ? clefOf[1] : 'bass'] as ClefName[]
  if (used.length === 1) fillSecondStaff(s)
  if (tempo === undefined) s.tempo = 100
  if (unsupported) warnings.push(`${unsupported} nốt có độ dài chưa hỗ trợ hiển thị (bộ ba…): nhịp vẫn đúng nhưng hình có thể sai`)
  return { score: s, warnings: [...new Set(warnings)] }
}

function fillSecondStaff(s: Score) {
  s.measures.forEach((m, i) => { m.staves.push(blankMeasure(s, contextAt(s, i).time).staves[1]) })
}

function readPitch(el: Element): Pitch {
  return { step: (el.querySelector('step')?.textContent ?? 'C') as StepName, alter: Math.round(num(el, 'alter')), octave: num(el, 'octave', 4) }
}

async function unzipMxl(buf: ArrayBuffer): Promise<string> {
  const files = unzipSync(new Uint8Array(buf))
  const container = files['META-INF/container.xml']
  let path = Object.keys(files).find((p) => /\.(musicxml|xml)$/i.test(p) && !p.startsWith('META-INF'))
  if (container) {
    const d = new DOMParser().parseFromString(strFromU8(container), 'application/xml')
    path = d.querySelector('rootfile')?.getAttribute('full-path') ?? path
  }
  if (!path || !files[path]) throw new Error('không tìm thấy bản nhạc trong file .mxl')
  return strFromU8(files[path])
}

// ---- MIDI import: quantise notes into bars --------------------------------------------------------------
/** Turn performed notes into an editable score: 16th-note grid, hands split at middle C, chords for simultaneous onsets. */
export function scoreFromNotes(notes: Note[], bpm = 100, time = { beats: 4, unit: 4 }, key = 0): Score {
  const grid = 0.25 // quarter notes per 16th
  const spb = 60 / bpm
  const q = notes
    .map((n) => ({ pitch: n.pitch, s: Math.round(n.start / spb / grid), e: Math.max(Math.round(n.start / spb / grid) + 1, Math.round((n.start + n.duration) / spb / grid)) }))
    .sort((a, b) => a.s - b.s || a.pitch - b.pitch)
  const unitsPerBar = (barTicks(time) / TPQ) / grid
  const lastEnd = Math.max(0, ...q.map((n) => n.e))
  const s = emptyScore(Math.max(1, Math.ceil(lastEnd / unitsPerBar)), time, key)
  s.tempo = Math.round(bpm)
  s.title = 'Từ MIDI'
  const staffOf = (p: number) => (p >= 60 ? 0 : 1)
  for (let staff = 0; staff < 2; staff++) {
    const mine = q.filter((n) => staffOf(n.pitch) === staff)
    const onsets = [...new Set(mine.map((n) => n.s))].sort((a, b) => a - b)
    onsets.forEach((t, i) => {
      const group = mine.filter((n) => n.s === t)
      const next = onsets[i + 1] ?? Infinity
      const end = Math.min(next, Math.max(...group.map((n) => n.e)))
      let from = t
      while (from < end) { // never cross a barline: split into tied pieces
        const m = Math.floor(from / unitsPerBar), barEnd = (m + 1) * unitsPerBar
        const to = Math.min(end, barEnd)
        const at = (from - m * unitsPerBar) * grid * TPQ
        const len = (to - from) * grid * TPQ
        const tiePieces = splitLength(at, len)
        let pos = at
        tiePieces.forEach((piece, pi) => {
          group.forEach((n, gi) => putNote(s, { m, staff, voice: 0 }, pos, piece, spell(n.pitch, key), gi > 0))
          const ev = s.measures[m].staves[staff][0].find((e, k) => starts(s.measures[m].staves[staff][0])[k] === pos)
          const lastOfRun = pi === tiePieces.length - 1 && to === end
          if (ev && !lastOfRun) ev.tie = true
          pos += piece
        })
        from = to
      }
    })
  }
  return s
}

/** Open any file the composer understands, with the things a reader had doubts about. A sheet-music PDF is read the same way the falling view reads it. */
export async function importFileFull(f: File): Promise<{ score: Score; warnings: string[] }> {
  if (f.name.toLowerCase().endsWith('.pdf')) {
    const { readPdfScore } = await import('../core/score/pdf')
    const { scoreFromOmr } = await import('./importScore')
    return scoreFromOmr(await readPdfScore(await f.arrayBuffer()), f.name.replace(/\.[^.]+$/, ''))
  }
  const name = f.name.toLowerCase()
  if (name.endsWith('.mxl')) return scoreFromMusicXml(await unzipMxl(await f.arrayBuffer()))
  if (name.endsWith('.musicxml') || name.endsWith('.xml')) return scoreFromMusicXml(await f.text())
  return { score: await importFile(f), warnings: [] }
}

export async function importFile(f: File): Promise<Score> {
  const name = f.name.toLowerCase()
  if (name.endsWith('.json')) return scoreFromJson(await f.text())
  if (name.endsWith('.mid') || name.endsWith('.midi')) {
    const buf = await f.arrayBuffer()
    const mid = new Midi(buf)
    const bpm = mid.header.tempos[0]?.bpm ?? 100
    const ts = mid.header.timeSignatures[0]?.timeSignature
    return scoreFromNotes(parseMidi(buf), bpm, ts ? { beats: ts[0], unit: ts[1] } : undefined)
  }
  if (name.endsWith('.mxl')) return scoreFromMusicXml(await unzipMxl(await f.arrayBuffer())).score
  if (name.endsWith('.musicxml') || name.endsWith('.xml')) return scoreFromMusicXml(await f.text()).score
  throw new Error('định dạng chưa được hỗ trợ')
}


// ---- PDF export (vector, one engraved system at a time so a page break never cuts a staff) ---------------
type PageLayout = { width: number; height: number; systems: { y0: number; y1: number; pageBreakAfter?: boolean }[] }

/** Split the drawn score into A4 pages: each page shows a slice of the same SVG. */
export function pdfPages(svg: SVGElement, layout: PageLayout): string {
  const pageH = (layout.width * (297 - 20)) / (210 - 20) // A4 text area, in the SVG's own units
  const pages: [number, number][] = []
  let from = 0, cut = 0
  layout.systems.forEach((sys, i) => {
    if (i && layout.systems[i - 1].pageBreakAfter) { pages.push([from, cut]); from = sys.y0 - 30 } // the user asked for a new page here
    else if (i && sys.y1 - from > pageH) { pages.push([from, cut]); from = layout.systems[i - 1].y1 }
    cut = sys.y1
  })
  pages.push([from, Math.max(cut, from + 10)])
  return pages.map(([y0, y1]) => {
    const copy = svg.cloneNode(true) as SVGElement
    copy.setAttribute('viewBox', `0 ${y0} ${layout.width} ${y1 - y0}`)
    copy.setAttribute('style', 'width:100%;height:auto;display:block')
    return `<div class="page">${copy.outerHTML}</div>`
  }).join('')
}

const PRINT_CSS = `#print-root{display:none}
@page{size:A4;margin:0}
@media print{html,body{background:#fff!important;color:#000}body>:not(#print-root){display:none!important}
#print-root{display:block;background:#fff}
.page{box-sizing:border-box;width:210mm;height:297mm;padding:10mm;overflow:hidden;break-after:page;background:#fff}
.page:last-child{break-after:auto}}`

export async function exportPdf(s: Score, svg: SVGElement, layout: PageLayout) {
  const api = (window as unknown as { notefall?: { printPdf(): Promise<Uint8Array> } }).notefall
  if (!api) throw new Error('xuất PDF chỉ chạy được trong ứng dụng')
  const style = document.createElement('style'); style.textContent = PRINT_CSS
  const root = document.createElement('div'); root.id = 'print-root'; root.innerHTML = pdfPages(svg, layout)
  document.head.append(style); document.body.append(root)
  try {
    const bytes = await api.printPdf()
    download(fileName(s, 'pdf'), bytes.slice().buffer as ArrayBuffer, 'application/pdf')
  } finally { root.remove(); style.remove() }
}
