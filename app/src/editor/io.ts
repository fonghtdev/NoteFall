import { Midi } from '@tonejs/midi'
import { unzipSync, strFromU8 } from 'fflate'
import { parseMidi } from '../core/midi'
import type { Note } from '../core/models'
import { toNotes, unroll } from '../core/score/playback'
import { TPQ, barTicks, blankMeasure, contextAt, emptyScore, midiOf, newId, nominalTicks, notationOf, putNote, spell, splitLength, starts, validate, type Art, type Dyn, type Ev, type Measure, type Pitch, type Score, type StepName } from './model'
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
  const timed = toNotes(unroll(toPerformance(s)), s.tempo)
  const perf = unroll(toPerformance(s))
  const tracks = s.clefs.map((_, i) => { const t = midi.addTrack(); t.name = i === 0 ? 'Right hand' : 'Left hand'; return t })
  timed.forEach((n, i) => tracks[perf[i].staff]?.addNote({ midi: n.pitch, time: n.start, duration: n.duration, velocity: 0.7 }))
  return midi.toArray()
}
export const exportMidi = (s: Score) => download(fileName(s, 'mid'), scoreToMidi(s).slice().buffer as ArrayBuffer, 'audio/midi')

// ---- MusicXML export ------------------------------------------------------------------------------------
const XML_TYPE: Record<string, string> = { w: 'whole', h: 'half', q: 'quarter', '8': 'eighth', '16': '16th', '32': '32nd', '64': '64th' }
const esc = (t: string) => t.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)

export function scoreToMusicXml(s: Score): string {
  const o: string[] = []
  o.push('<?xml version="1.0" encoding="UTF-8"?>')
  o.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">')
  o.push('<score-partwise version="3.1">')
  o.push(`<work><work-title>${esc(s.title)}</work-title></work>`)
  o.push(`<identification><creator type="composer">${esc(s.composer)}</creator><encoding><software>NoteFall</software></encoding></identification>`)
  o.push('<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>')
  o.push('<part id="P1">')
  // spans end on a different event than they start on: remember which events close what
  const slurEnd = new Map<number, number[]>(), wedgeEnd = new Map<number, number[]>()
  let spanNo = 0
  const slurNo = new Map<number, number>(), wedgeNo = new Map<number, number>()
  s.measures.forEach((m) => m.staves.forEach((vs) => vs.forEach((v) => v.forEach((e) => {
    if (e.slur !== undefined) { const n = (spanNo++ % 6) + 1; slurNo.set(e.id, n); slurEnd.set(e.slur, [...(slurEnd.get(e.slur) ?? []), n]) }
    if (e.hairpin) { const n = (spanNo++ % 6) + 1; wedgeNo.set(e.id, n); wedgeEnd.set(e.hairpin.end, [...(wedgeEnd.get(e.hairpin.end) ?? []), n]) }
  }))))
  s.measures.forEach((m, i) => {
    const ctx = contextAt(s, i), bar = barTicks(ctx.time)
    o.push(`<measure number="${i + 1}">`)
    const first = i === 0
    if (first || m.key !== undefined || m.time) {
      o.push('<attributes>')
      if (first) o.push(`<divisions>${TPQ}</divisions>`)
      if (first || m.key !== undefined) o.push(`<key><fifths>${ctx.key}</fifths></key>`)
      if (first || m.time) o.push(`<time><beats>${ctx.time.beats}</beats><beat-type>${ctx.time.unit}</beat-type></time>`)
      if (first) {
        o.push(`<staves>${s.clefs.length}</staves>`)
        s.clefs.forEach((c, si) => o.push(`<clef number="${si + 1}"><sign>${c === 'treble' ? 'G' : 'F'}</sign><line>${c === 'treble' ? 2 : 4}</line></clef>`))
      }
      o.push('</attributes>')
    }
    if (first || m.tempo) o.push(`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${ctx.tempo}</per-minute></metronome></direction-type><sound tempo="${ctx.tempo}"/></direction>`)
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
        if (e.dyn) dirs.push(`<dynamics><${e.dyn}/></dynamics>`)
        if (e.hairpin) dirs.push(`<wedge type="${e.hairpin.type === 'cresc' ? 'crescendo' : 'diminuendo'}" number="${wedgeNo.get(e.id)}"/>`)
        for (const n of wedgeEnd.get(e.id) ?? []) dirs.push(`<wedge type="stop" number="${n}"/>`)
        dirs.forEach((d) => o.push(`<direction placement="below"><direction-type>${d}</direction-type><staff>${si + 1}</staff></direction>`))
        const pieces = rest ? [null] : e.pitches
        if (e.graces?.length) e.graces.forEach((g) => o.push(`<note><grace slash="no"/><pitch><step>${g.step}</step>${g.alter ? `<alter>${g.alter}</alter>` : ''}<octave>${g.octave}</octave></pitch><voice>${si * 4 + vi + 1}</voice><type>eighth</type><staff>${si + 1}</staff></note>`))
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
          if (!rest && e.orn && last) bits.push(`<ornaments>${e.orn === 'mordent' ? '<mordent/>' : '<inverted-mordent/>'}</ornaments>`)
          if (e.art?.length && (pi === 0 || rest)) {
            const ARTS: Partial<Record<Art, string>> = { staccato: '<staccato/>', accent: '<accent/>', tenuto: '<tenuto/>', marcato: '<strong-accent/>' }
            const list = e.art.map((a) => ARTS[a]).filter(Boolean).join('')
            if (list) bits.push(`<articulations>${list}</articulations>`)
            if (e.art.includes('fermata')) bits.push('<fermata/>')
          }
          if (bits.length) o.push(`<notations>${bits.join('')}</notations>`)
          o.push('</note>')
        })
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
    if (m.endRepeat || endingStop) {
      o.push(`<barline location="right">${m.endRepeat ? '<bar-style>light-heavy</bar-style>' : ''}${endingStop ? `<ending number="${m.volta!.join(',')}" type="${m.endRepeat ? 'stop' : 'discontinue'}"/>` : ''}${m.endRepeat ? '<repeat direction="backward"/>' : ''}</barline>`)
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
  const warnings: string[] = []
  const parts = [...root.querySelectorAll(':scope > part')]
  if (!parts.length) throw new Error('không có phần nhạc nào')
  if (parts.length > 1) warnings.push(`file có ${parts.length} phần nhạc, chỉ lấy khuông của các phần đầu (tối đa 2 khuông)`)

  // (part, staff) pairs become our staves
  const lanes: { part: Element; staffNo: number }[] = []
  parts.forEach((part) => {
    const n = Math.max(1, ...[...part.querySelectorAll('attributes > staves')].map((e) => Number(e.textContent)))
    for (let k = 1; k <= n; k++) lanes.push({ part, staffNo: k })
  })
  if (lanes.length > 2) warnings.push(`có ${lanes.length} khuông, chỉ lấy 2 khuông đầu`)
  const used = lanes.slice(0, 2)

  const s = emptyScore(0)
  s.title = root.querySelector('work > work-title, movement-title')?.textContent?.trim() || 'Không tên'
  s.composer = root.querySelector('creator[type="composer"]')?.textContent?.trim() ?? ''
  s.clefs = used.length === 1 ? ['treble', 'bass'] : used.map(() => 'treble' as const)
  s.measures = []
  let divisions = 1
  const clefOf: ('treble' | 'bass')[] = ['treble', 'bass']
  let time = { beats: 4, unit: 4 }, key = 0, tempo: number | undefined
  let tied: Record<string, boolean> = {}
  let unsupported = 0

  // marks that run across bars (slurs, wedges, tuplets) are tracked per staff
  const laneState = used.map(() => ({ slurs: new Map<string, Ev>(), wedge: undefined as { ev: Ev; type: 'cresc' | 'dim' } | undefined, wedgeStart: undefined as 'cresc' | 'dim' | undefined, wedgeStop: false, dyn: undefined as Dyn | undefined, tupGroup: 0, tupCount: 0, tupN: 0 }))
  const DYNS: Dyn[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff']
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
      if (me) {
        for (const el of [...me.children]) {
          if (el.tagName === 'attributes') {
            divisions = num(el, 'divisions', divisions) || divisions
            const f = el.querySelector('key > fifths'); if (f && si === 0) { key = Number(f.textContent); if (mi === 0) s.key = key; else m.key = key }
            const b = el.querySelector('time > beats'), u = el.querySelector('time > beat-type')
            if (b && u && si === 0) { time = { beats: Number(b.textContent), unit: Number(u.textContent) }; if (mi === 0) s.time = time; else m.time = time }
            el.querySelectorAll('clef').forEach((c) => {
              const no = Number(c.getAttribute('number') ?? 1)
              if (no === lane.staffNo) { const sign = c.querySelector('sign')?.textContent; clefOf[si] = sign === 'F' ? 'bass' : 'treble'; if (sign && !'GF'.includes(sign)) warnings.push(`khoá ${sign} được hiển thị như khoá Sol`) }
            })
          } else if (el.tagName === 'direction') {
            const t = el.querySelector('sound')?.getAttribute('tempo'); if (t && si === 0) { tempo = Math.round(Number(t)); if (mi === 0) s.tempo = tempo; else m.tempo = tempo }
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
              const wt = el.querySelector('wedge')?.getAttribute('type')
              if (wt === 'crescendo') st.wedgeStart = 'cresc'
              else if (wt === 'diminuendo') st.wedgeStart = 'dim'
              else if (wt === 'stop') st.wedgeStop = true
            }
          } else if (el.tagName === 'barline' && si === 0) {
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
              if (gp) pendingGraces.push(readPitch(gp))
              continue
            }
            const voice = el.querySelector('voice')?.textContent ?? '1'
            const chord = !!el.querySelector('chord')
            const ticks = Math.round((num(el, 'duration') * TPQ) / divisions)
            const arr = voices.get(voice) ?? []
            if (!voices.has(voice)) voices.set(voice, arr)
            const pitchEl = el.querySelector('pitch')
            if (chord && last) {
              if (pitchEl) last.ev.pitches.push(readPitch(pitchEl))
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
            if (pitchEl && pendingGraces.length) { ev.graces = pendingGraces.splice(0) }
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
              const ART: Record<string, Art> = { staccato: 'staccato', accent: 'accent', tenuto: 'tenuto', 'strong-accent': 'marcato' }
              const arts = [...el.querySelectorAll('articulations')].flatMap((g) => [...g.children]).map((a) => ART[a.tagName]).filter(Boolean)
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
  s.clefs = [clefOf[0], used.length > 1 ? clefOf[1] : 'bass']
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
type PageLayout = { width: number; height: number; systems: { y0: number; y1: number }[] }

/** Split the drawn score into A4 pages: each page shows a slice of the same SVG. */
export function pdfPages(svg: SVGElement, layout: PageLayout): string {
  const pageH = (layout.width * (297 - 20)) / (210 - 20) // A4 text area, in the SVG's own units
  const pages: [number, number][] = []
  let from = 0, cut = 0
  layout.systems.forEach((sys, i) => {
    if (i && sys.y1 - from > pageH) { pages.push([from, cut]); from = layout.systems[i - 1].y1 }
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
