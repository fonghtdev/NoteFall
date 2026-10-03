import './ui/app.css'
import { paintIcons } from './ui/icons'
import { popover } from './ui/popover'
import { PianoView } from './ui/pianoView'
import { Transport } from './ui/transport'
import { parseMidi } from './core/midi'
import { transcribe } from './core/basicPitch'
import { renderNotes } from './core/synth'
import { clean } from './core/postprocess'
import { end, type Note } from './core/models'
import { beatTimes, estimateGrid, gridForSignature, quantize, scaleTempo, shiftOffset, type BeatGrid } from './core/beats'
import { DEFAULT_CLICK, Follower, Practice, SOUNDS, playClick, type ClickSettings, type ClickSound, type ClickSource } from './core/metronome'
import * as cache from './core/cache'
import { readPdfScore } from './core/score/pdf'
import { scoreClicks, tempoRatios, toNotes, unroll } from './core/score/playback'
import { setGraceBeats } from './core/score/realize'
import type { Score } from './core/score/omr'
import { THEMES } from './ui/theme'
import { exportVideo } from './export'
import { Composer } from './editor/composer'
import { minuet } from './editor/demo'
import { toPerformance } from './editor/perform'
import { scoreFromOmr } from './editor/importScore'
import { scoreFromNotes } from './editor/io'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const view = new PianoView($('view') as HTMLCanvasElement, $('gl') as HTMLCanvasElement)
const transport = new Transport()
const playBtn = $<HTMLButtonElement>('play'), seek = $<HTMLInputElement>('seek')
const exportBtn = $<HTMLButtonElement>('export'), exportOpen = $<HTMLButtonElement>('btn-export'), editBtn = $<HTMLButtonElement>('editbtn')
const status = $('status'), progress = $<HTMLProgressElement>('progress')
paintIcons()
popover($('btn-settings'), $('pop-settings'))
popover($('btn-export'), $('pop-export'))
popover($('btn-met'), $('pop-met'))

/** Status line in the dock; errors get the danger colour. */
const say = (text: string, kind: '' | 'error' = '') => { status.textContent = text; status.title = text; status.style.color = kind === 'error' ? 'var(--danger)' : '' }
const setPlayState = () => {
  const on = transport.playing
  playBtn.dataset.state = on ? 'playing' : 'paused'
  playBtn.setAttribute('aria-label', on ? 'Tạm dừng' : 'Phát')
}
const fmt = (t: number) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`
/** Fill the track of a range input up to its thumb. */
const fill = (el: HTMLInputElement) => el.style.setProperty('--fill', `${((+el.value - +el.min) / (+el.max - +el.min || 1)) * 100}%`)

// bump when transcription settings change, so stale cached notes are never reused
const CACHE_V = ':v2'

const isMidi = (name: string) => /\.midi?$/i.test(name)
const isPdf = (name: string) => /\.pdf$/i.test(name)

// raw = what the transcriber produced; the view shows quantize(raw) if asked. key = cache key (audio only).
let raw: Note[] = [], shown: Note[] = [], grid: BeatGrid | undefined, key: string | undefined
let audioBuf: AudioBuffer | undefined, songName = 'notefall'
let score: Score | undefined // set while a sheet-music PDF is open: notes are re-timed from it when the tempo changes
const ctl = { box: $('beatctl'), bpm: $('bpm'), show: $<HTMLInputElement>('showbeats'), quant: $<HTMLInputElement>('quant') }

function refresh() {
  shown = ctl.quant.checked && grid ? quantize(raw, grid) : raw
  view.setNotes(shown)
  view.beats = ctl.show.checked ? grid : undefined
  ctl.box.hidden = !grid
  if (grid) ctl.bpm.textContent = `${grid.bpm.toFixed(1)} BPM`
}

function setGrid(g: BeatGrid) {
  grid = g
  if (key) void cache.save(key + CACHE_V + ':grid', g)
  refresh()
}

/** Title chip + which colour is which hand (follows the theme). */
function paintLegend() {
  const box = $('nowplaying')
  if (!raw.length) { box.innerHTML = ''; return }
  const dot = (c: number[]) => `<i class="dot" style="background:rgb(${c.map(Math.round)})"></i>`
  const th = view.theme
  const how = raw.some((n) => n.hand !== undefined) ? 'Theo khuông của bản nhạc: khuông trên là tay phải, khuông dưới là tay trái' : 'Bản ghi âm không cho biết tay nào: từ Đô giữa (C4) trở lên tính là tay phải'
  box.innerHTML = `<span class="chip" id="np-title"></span><span class="chip" title="${how}">${dot(th.left)}Tay trái</span><span class="chip" title="${how}">${dot(th.right)}Tay phải</span>`
  $('np-title').textContent = songName
}

// metronome clicks of the open song: from its beat grid, or (sheet music) from the bars themselves
const gridClicks: ClickSource = (a, b) => (grid ? beatTimes(grid, a, b).map((x) => ({ t: x.t, accent: x.bar })) : [])
let clickSource: ClickSource | undefined = gridClicks

/** Show a finished song: notes drawn, audio (if any) ready to play. */
export function show(notes: Note[], audio?: AudioBuffer, g?: BeatGrid, k?: string) {
  raw = notes; key = k; audioBuf = audio
  clickSource = gridClicks
  grid = g ?? estimateGrid(notes)
  if (key && grid && !g) void cache.save(key + CACHE_V + ':grid', grid)
  const duration = Math.max(audio?.duration ?? 0, ...notes.map(end)) + 1
  refresh()
  transport.load(duration, audio)
  seek.min = String(-transport.lead)
  seek.max = String(duration)
  seek.value = String(-transport.lead)
  playBtn.disabled = exportBtn.disabled = exportOpen.disabled = editBtn.disabled = notes.length === 0
  setPlayState()
  say(`${notes.length} nốt` + (audio ? '' : ' · MIDI (tiếng piano tổng hợp)'))
  $('empty').hidden = notes.length > 0
  paintLegend()
  fill(seek)
}

/** Sheet music -> notes at the chosen tempo (quarter notes per minute), with an exact beat grid. */
async function showScore() {
  if (!score) return
  const bpm = Math.min(300, Math.max(30, +$<HTMLInputElement>('tempo').value || 120))
  const repeats = $<HTMLInputElement>('repeats').checked, ratios = tempoRatios(score, repeats)
  const notes = toNotes(unroll(score, repeats), bpm, 85, ratios)
  say('Đang tổng hợp tiếng piano…')
  const audio = await renderNotes(notes)
  document.body.classList.add('score'); $('scorectl').hidden = false
  show(notes, audio, gridForSignature(bpm, score.beatsPerBar, score.beatUnit))
  const list = scoreClicks(score, repeats, bpm, ratios)
  clickSource = (a, b) => { // the clicks between a and b (the list is sorted)
    let lo = 0, hi = list.length
    while (lo < hi) { const m = (lo + hi) >> 1; list[m].t <= a ? (lo = m + 1) : (hi = m) }
    const out = []
    for (let i = lo; i < list.length && list[i].t <= b; i++) out.push(list[i])
    return out
  }
  const barLen0 = score.measures[0]?.length
  if (ratios.length || score.measures.some((m) => m.length !== barLen0)) { grid = undefined; refresh() } // tempo or time signature changes along the way: one fixed beat grid would drift, so the beat lines are left out
  const bad = score.measures.filter((m) => m.suspect)
  say(`${notes.length} nốt · ${score.measures.length} ô nhịp ${score.beatsPerBar}/${score.beatUnit}` + (bad.length || score.warnings.length ? ` · ⚠ ${bad.length + score.warnings.length} chỗ cần kiểm tra` : ' · mọi ô nhịp đều đủ phách'))
  const notes_ = [...bad.map((m) => `Ô ${m.index}: ${m.suspect}`), ...score.warnings]
  if (notes_.length) status.title = notes_.join('\n')
}
$('tempo').onchange = $('repeats').onchange = () => void showScore()

function openTab(which: 'falling' | 'composer') {
  $('falling').hidden = which !== 'falling'
  $('composer').hidden = which !== 'composer'
  for (const t of ['falling', 'composer'] as const) {
    const b = $('tab-' + t)
    b.classList.toggle('on', t === which)
    b.setAttribute('aria-selected', String(t === which))
  }
  $('open').hidden = which !== 'falling' // the composer has its own file menu
  if (which === 'falling') { composer.stop(); transportPauseForTab() } // one thing sounds at a time
  else if (transport.playing) { transport.pause(); setPlayState() }
}
const transportPauseForTab = () => { if (transport.ctx.state === 'suspended') void transport.ctx.resume() }
$('tab-falling').onclick = () => openTab('falling')
$('tab-composer').onclick = () => openTab('composer')

/** Composer -> falling notes: the score becomes a performance at its own tempo, with an exact beat grid. */
$('editbtn').onclick = () => {
  if (score) { // sheet music: keep rests, voices, ornaments, repeats
    const r = scoreFromOmr(score, songName)
    composer.setScore(r.score)
    composer.say(r.warnings.length ? `Đã mở PDF để sửa · ${r.warnings.join(' · ')}` : 'Đã mở PDF để sửa')
  } else { // audio or MIDI: quantise the notes onto the detected beat
    const g = grid
    const shift = g ? Math.max(0, g.offset + (g.barStart * 60) / g.bpm) : 0
    const sc = scoreFromNotes(raw.map((n) => ({ ...n, start: Math.max(0, n.start - shift) })), g?.bpm ?? 100)
    sc.title = songName
    composer.setScore(sc)
    composer.say('Đã chuyển các nốt đã nhận được sang bản nhạc: nốt được làm tròn về 1/16, bạn có thể sửa từng nốt')
  }
  openTab('composer')
}

/** Show a composed score in the falling view. */
async function playComposed(sc: import('./editor/model').Score) {
  score = toPerformance(sc)
  songName = sc.title || 'notefall'
  $<HTMLInputElement>('tempo').value = String(sc.tempo)
  openTab('falling')
  await showScore()
}

const composer = new Composer($('composer'), { toFalling: playComposed })
;(window as unknown as { __composer: Composer }).__composer = composer


;(window as unknown as { __raw: () => Note[] }).__raw = () => raw // test hook: selftest reads the notes back

export async function loadFile(file: File) {
  playBtn.disabled = exportBtn.disabled = exportOpen.disabled = editBtn.disabled = true
  songName = file.name.replace(/\.[^.]+$/, '')
  say(`Đang phân tích ${file.name}…`)
  progress.hidden = false; progress.value = 0
  try {
    const data = await file.arrayBuffer()
    if (isPdf(file.name)) {
      score = await readPdfScore(data)
      if (score.tempo) $<HTMLInputElement>('tempo').value = String(score.tempo) // the "♩ = 93" printed at the top
      return await showScore()
    }
    score = undefined
    document.body.classList.remove('score'); $('scorectl').hidden = true
    if (isMidi(file.name)) {
      const notes = parseMidi(data)
      say('Đang tổng hợp tiếng piano…')
      return show(notes, await renderNotes(notes))
    }

    const audio = await transport.ctx.decodeAudioData(data.slice(0)) // slice: decode detaches its input
    const k = await cache.fileKey(data)
    let notes = await cache.load<Note[]>(k + CACHE_V + ':notes')
    if (!notes) {
      notes = clean(await transcribe(audio, (p) => (progress.value = p)))
      void cache.save(k + CACHE_V + ':notes', notes)
    }
    show(notes, audio, await cache.load<BeatGrid>(k + CACHE_V + ':grid'), k)
  } catch (e) {
    say(`Lỗi: ${e instanceof Error ? e.message : e}`, 'error')
  } finally {
    progress.hidden = true
  }
}

$('open').onclick = $('empty-open').onclick = () => $('file').click()
$('empty-compose').onclick = () => openTab('composer')
const keysDlg = $<HTMLDialogElement>('dlg-keys')
$('btn-keys').onclick = () => keysDlg.showModal()
document.addEventListener('keydown', (e) => { // ? opens the shortcut list
  if (e.key === '?' && !/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName) && !keysDlg.open) { e.preventDefault(); keysDlg.showModal() }
})
$('empty-demo').onclick = () => void playComposed(minuet())
$<HTMLInputElement>('file').onchange = (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) void loadFile(f)
}
const stage = $('stage')
document.addEventListener('dragover', (e) => { e.preventDefault(); if (!$('falling').hidden) stage.classList.add('dragging') })
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) stage.classList.remove('dragging') })
document.addEventListener('drop', (e) => {
  e.preventDefault()
  stage.classList.remove('dragging')
  const f = e.dataTransfer?.files[0]
  if (f) void (f.type.startsWith('image/') ? useBackground(f) : loadFile(f))
})
// ---- metronome: clicks along the song, and a free-standing one for practice
type MetState = ClickSettings & { follow: boolean; bpm: number; beats: number }
const met: MetState = { ...DEFAULT_CLICK, follow: false, bpm: 80, beats: 4 }
try { Object.assign(met, JSON.parse(localStorage.getItem('notefall.met') ?? '{}')) } catch { /* defaults */ }
const saveMet = () => { try { localStorage.setItem('notefall.met', JSON.stringify(met)) } catch { /* best effort */ } }
const follower = new Follower(transport.ctx, () => transport.now(), () => clickSource, () => met)
const dots = $('met-dots'), runBtn = $('met-run')
const practice = new Practice(transport.ctx, () => met, (i, accent) => {
  const el = dots.children[i] as HTMLElement | undefined
  if (!el) return
  el.classList.add('on'); el.classList.toggle('acc', accent && met.accent)
  setTimeout(() => el.classList.remove('on'), 110)
})
const sound = $<HTMLSelectElement>('met-sound'), vol = $<HTMLInputElement>('met-vol'), beatsSel = $<HTMLSelectElement>('met-beats')
const bpmNum = $<HTMLInputElement>('met-bpm'), bpmRange = $<HTMLInputElement>('met-bpm-range')
for (const [k, label] of Object.entries(SOUNDS)) sound.add(new Option(label, k))
for (let n = 1; n <= 9; n++) beatsSel.add(new Option(String(n), String(n)))
const drawDots = () => { dots.innerHTML = ''; for (let i = 0; i < met.beats; i++) dots.appendChild(document.createElement('span')) }
const applyMet = () => {
  met.bpm = Math.min(240, Math.max(30, Math.round(met.bpm || 80)))
  $<HTMLInputElement>('met-follow').checked = met.follow
  $('btn-met').setAttribute('aria-pressed', String(met.follow || practice.running))
  sound.value = met.sound; vol.value = String(Math.round(met.volume * 100)); fill(vol)
  $<HTMLInputElement>('met-accent').checked = met.accent
  bpmNum.value = String(met.bpm); bpmRange.value = String(met.bpm); fill(bpmRange)
  beatsSel.value = String(met.beats)
  practice.bpm = met.bpm; practice.beats = met.beats
  runBtn.textContent = practice.running ? 'Dừng' : 'Bắt đầu'
  saveMet()
}
const stopPractice = () => { practice.stop(); dots.querySelectorAll('.on').forEach((e) => e.classList.remove('on')); applyMet() }
const setFollow = (on: boolean) => { met.follow = on; if (on && practice.running) stopPractice(); applyMet() }
$<HTMLInputElement>('met-follow').onchange = (e) => setFollow((e.target as HTMLInputElement).checked)
sound.onchange = () => { met.sound = sound.value as ClickSound; applyMet(); playClick(transport.ctx, transport.ctx.currentTime + 0.02, false, met) }
vol.oninput = () => { met.volume = +vol.value / 100; applyMet() }
vol.onchange = () => playClick(transport.ctx, transport.ctx.currentTime + 0.02, true, met)
$<HTMLInputElement>('met-accent').onchange = (e) => { met.accent = (e.target as HTMLInputElement).checked; applyMet() }
$('met-test').onclick = () => { void transport.ctx.resume(); const t = transport.ctx.currentTime + 0.05; playClick(transport.ctx, t, true, met); playClick(transport.ctx, t + 0.5, false, met); playClick(transport.ctx, t + 1, false, met); playClick(transport.ctx, t + 1.5, false, met) }
bpmNum.onchange = () => { met.bpm = +bpmNum.value; applyMet() }
bpmRange.oninput = () => { met.bpm = +bpmRange.value; applyMet() }
$('met-minus').onclick = () => { met.bpm -= 1; applyMet() }
$('met-plus').onclick = () => { met.bpm += 1; applyMet() }
beatsSel.onchange = () => { met.beats = +beatsSel.value; drawDots(); applyMet() }
let taps: number[] = []
$('met-tap').onclick = () => {
  const now = performance.now()
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = []
  taps.push(now); taps = taps.slice(-6)
  if (taps.length >= 2) { met.bpm = 60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)); applyMet() }
}
runBtn.onclick = () => {
  if (practice.running) { stopPractice(); return }
  if (transport.playing) { transport.pause(); setPlayState() } // one thing at a time
  met.follow = false; drawDots(); applyMet(); practice.start(); applyMet()
}
$('met-song').onclick = () => { const bpm = +$<HTMLInputElement>('tempo').value || grid?.bpm; if (bpm) { met.bpm = bpm; applyMet() } }
drawDots(); applyMet()
;(window as unknown as { __metronome: unknown }).__metronome = { playClick, SOUNDS, met }
let lastFrameT = 0
const syncMetronome = (t: number) => { // called every frame
  if (met.follow && transport.playing) { if (!follower.running) follower.start(); else if (Math.abs(t - lastFrameT) > 0.4) follower.reset() }
  else if (follower.running) follower.stop()
  if (transport.playing && practice.running) stopPractice() // the song started: the practice click gives way
  lastFrameT = t
}

playBtn.onclick = () => {
  transport.playing ? transport.pause() : transport.play()
  setPlayState()
}
seek.oninput = () => { transport.seek(+seek.value); fill(seek) }
document.addEventListener('keydown', (e) => { // M switches the metronome along the song on and off
  if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey && !$('falling').hidden && !/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) { setFollow(!met.follow); say(met.follow ? 'Metronome theo bài: bật' : 'Metronome theo bài: tắt') }
})
document.addEventListener('keydown', (e) => { // Space plays / pauses the falling view
  const t = e.target as HTMLElement
  if (e.key === ' ' && !$('falling').hidden && !playBtn.disabled && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName)) { e.preventDefault(); playBtn.click() }
})
// settings, remembered between runs (best-effort: storage may be unavailable)
const bgDim = $<HTMLInputElement>('bg-dim'), bgBlur = $<HTMLInputElement>('bg-blur'), graceSel = $<HTMLSelectElement>('grace'), speed = $<HTMLInputElement>('speed'), sparks = $<HTMLInputElement>('sparks'), glass = $<HTMLInputElement>('glass'), themeSel = $<HTMLSelectElement>('theme')
for (const id of ['black', 'crystal', 'image']) themeSel.add(new Option(THEMES[id].name, id)) // black / crystal / your own picture
function applySettings() {
  view.lookahead = 10 - +speed.value // slider right = faster = fewer seconds on screen
  fill(speed)
  transport.setLead(view.lookahead)
  seek.min = String(-transport.lead)
  if (!transport.playing) { seek.value = String(transport.now()); fill(seek) }
  view.sparks = sparks.checked
  view.glass = glass.checked
  setGraceBeats(+graceSel.value)
  view.theme = THEMES[themeSel.value] ?? THEMES.crystal
  view.bgDim = +bgDim.value / 100; view.bgBlur = +bgBlur.value
  fill(bgDim); fill(bgBlur)
  $('bgctl').hidden = themeSel.value !== 'image'
  paintLegend()
  try { localStorage.setItem('notefall', JSON.stringify({ bgDim: bgDim.value, bgBlur: bgBlur.value, grace: graceSel.value, speed2: speed.value, sparks: sparks.checked, glass: glass.checked, theme: themeSel.value, beats: ctl.show.checked, quant: ctl.quant.checked })) } catch { /* ignore */ }
}
try {
  const s = JSON.parse(localStorage.getItem('notefall') ?? '{}')
  if (s.speed2) speed.value = s.speed2
  if (s.grace) graceSel.value = s.grace
  if (s.bgDim) bgDim.value = s.bgDim
  if (s.bgBlur) bgBlur.value = s.bgBlur
  if (s.sparks !== undefined) sparks.checked = s.sparks
  if (s.glass !== undefined) glass.checked = s.glass
  if (s.theme in THEMES) themeSel.value = s.theme
  if (s.beats !== undefined) ctl.show.checked = s.beats
  if (s.quant !== undefined) ctl.quant.checked = s.quant
} catch { /* ignore */ }
glass.disabled = !view.glassAvailable
if (glass.disabled) glass.checked = false
speed.oninput = sparks.onchange = glass.onchange = themeSel.onchange = applySettings
/** Use a picture from the user's computer as the background (kept between runs in the app's own storage). */
async function useBackground(blob: Blob, persist = true) {
  if (blob.size > 40 * 1024 * 1024) return say('Ảnh quá lớn (tối đa 40 MB)', 'error')
  try {
    view.setBackground(await createImageBitmap(blob))
  } catch { return say('Không đọc được ảnh này. Hãy thử JPG, PNG hoặc WebP.', 'error') }
  if (persist) void cache.save('bg:image', blob)
  themeSel.value = 'image'
  applySettings()
  say('Đã đặt ảnh nền')
}
;(window as unknown as { __useBackground: typeof useBackground }).__useBackground = useBackground
$('bg-pick').onclick = () => $('bg-file').click()
$<HTMLInputElement>('bg-file').onchange = (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (f) void useBackground(f)
}
$('bg-clear').onclick = () => { view.setBackground(undefined); void cache.save('bg:image', undefined); say('Đã gỡ ảnh nền') }
bgDim.oninput = bgBlur.oninput = applySettings
themeSel.addEventListener('change', () => { if (themeSel.value === 'image' && !view.bgImage) $('bg-file').click() }) // picking "your picture" asks for one
void cache.load<Blob>('bg:image').then((b) => { if (b) void createImageBitmap(b).then((bmp) => { view.setBackground(bmp) }).catch(() => undefined) })

graceSel.onchange = () => { applySettings(); if (score) void showScore() } // grace notes are part of the sound: rebuild the notes
applySettings()
refresh()
$('half').onclick = () => grid && setGrid(scaleTempo(grid, 0.5))
$('double').onclick = () => grid && setGrid(scaleTempo(grid, 2))
/** A second PianoView with the on-screen settings, rendered offscreen at video size. */
export function makeExportView(): PianoView {
  const v = new PianoView(document.createElement('canvas'), document.createElement('canvas'))
  v.setNotes(shown)
  Object.assign(v, { beats: view.beats, theme: view.theme, lookahead: view.lookahead, sparks: view.sparks, glass: view.glass, bgImage: view.bgImage, bgDim: view.bgDim, bgBlur: view.bgBlur })
  return v
}

let cancelExport = false
exportBtn.onclick = async () => {
  if (progress.hidden === false && exportBtn.textContent === 'Huỷ') { cancelExport = true; return }
  transport.pause(); setPlayState()
  stopPractice() // the video's sound is the song alone: the metronome never goes into it (and stays quiet while it is made)
  cancelExport = false
  exportBtn.textContent = 'Huỷ'
  playBtn.disabled = true
  progress.hidden = false; progress.value = 0
  say('Đang xuất video…')
  try {
    const blob = await exportVideo({
      view: makeExportView(), duration: transport.duration, lead: transport.lead, audio: audioBuf,
      height: +$<HTMLSelectElement>('res').value as 720 | 1080, fps: 60,
      onProgress: (p) => { progress.value = p; say(`Đang xuất video… ${Math.round(p * 100)}%`) },
      cancelled: () => cancelExport,
    })
    if (blob) {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = `${songName}.mp4`; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 60000)
      say('Đã xuất xong')
    } else say('Đã huỷ xuất video')
  } catch (e) {
    say(`Lỗi xuất video: ${e instanceof Error ? e.message : e}`, 'error')
  } finally {
    progress.hidden = true
    exportBtn.textContent = 'Xuất video'
    playBtn.disabled = false
  }
}

$('reset').onclick = () => { const g = estimateGrid(raw); if (g) setGrid(g) }
$('offm').onclick = () => grid && setGrid(shiftOffset(grid, -0.01))
$('offp').onclick = () => grid && setGrid(shiftOffset(grid, 0.01))
ctl.show.onchange = ctl.quant.onchange = () => { refresh(); applySettings() }

function frame() {
  if ($('falling').hidden) { requestAnimationFrame(frame); return } // composer tab: nothing to draw (and a 0×0 canvas makes WebGL complain)
  const t = transport.now()
  if (transport.playing && t >= transport.duration) { transport.pause(); setPlayState() }
  view.draw(t)
  syncMetronome(t)
  if (document.activeElement !== seek) { seek.value = String(t); fill(seek) }
  $('time').textContent = `${fmt(t)} / ${fmt(transport.duration)}`
  requestAnimationFrame(frame)
}
frame()

if (location.search.includes('selftest')) void import('./selftest').then((m) => m.run(show, transport, view, loadFile))
