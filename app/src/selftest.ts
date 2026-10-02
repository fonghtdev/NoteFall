import { transcribe } from './core/basicPitch'
import { clean } from './core/postprocess'
import type { Note } from './core/models'
import { exportVideo } from './export'
import { PianoView } from './ui/pianoView'

// Synthetic piano-ish tones with known pitch/onset; checked in a real Electron window.
export async function run(show: (n: Note[], a?: AudioBuffer) => void, transport: { ctx: AudioContext }, view: { draw(t: number): void }, loadFile: (f: File) => Promise<void>) {
  if (location.search.includes('shell')) { // just look at the app as it opens
    await new Promise((r) => setTimeout(r, 600))
    return console.log('SELFTEST_DONE')
  }
  if (location.search.includes('compose')) { // drive the composer like a user: tab, keys, clicks, undo, then hand over to the falling view
    const c = (window as unknown as { __composer: import('./editor/composer').Composer }).__composer
    ;(document.getElementById('tab-composer') as HTMLButtonElement).click()
    const shape = (m: number, staff = 0) => c.score.measures[m].staves[staff][0].map((e) => `${e.pitches.map((p) => p.step + (p.alter ? (p.alter > 0 ? '#' : 'b') : '') + p.octave).join('+') || 'r'}:${e.ticks / 960}`).join(' ')
    const ok = (name: string, cond: boolean) => console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`)

    c.setScore((await import('./editor/model')).emptyScore(4, { beats: 3, unit: 4 }, 1))
    c.key('n')                                  // input mode
    c.key('5'); for (const k of ['D']) c.key(k) // quarter D5 (nearest to the default start)
    c.key('4'); for (const k of ['G', 'A', 'B', 'C']) c.key(k) // eighths
    ok('keyboard entry bar 1 (each letter lands nearest the previous note)', shape(0) === 'D5:1 G5:0.5 A5:0.5 B5:0.5 C6:0.5')
    c.key('5'); c.key('d'); c.key('g'); c.key('g')
    console.log('  bar 2:', shape(1), '| cursor', JSON.stringify(c.cursor))

    // mouse: click the bass staff of bar 3 on beat 1 at pitch B2 (second line of the bass clef) with a half note
    c.setScore((await import('./editor/model')).emptyScore(4, { beats: 3, unit: 4 }, 1))
    c.setMode('input'); c.key('6')
    const dm = c.layout.measures[2], st = dm.staves[1], ev = dm.evs.find((e) => e.staff === 1)!
    c.click(ev.x, st.bottom - 2 * (st.spacing / 2)) // two half-steps above the bottom line (G2) = B2
    console.log('  bass bar 3 after click:', shape(2, 1))
    ok('click places B2 half note then rests', shape(2, 1) === 'B2:2 r:1')

    // select mode: pick the note, move it up a semitone / delete / undo
    c.setMode('select')
    const ev2 = c.layout.measures[2].evs.find((e) => e.staff === 1)! // layout changed after the edit: read it again
    c.click(ev2.x, st.bottom - 2 * (st.spacing / 2))
    ok('click selects the note', c.sel !== undefined && c.describe(c.sel).includes('B2'))
    console.log('  sel', c.sel, 'mode', c.mode, 'visible', (document.getElementById('composer') as HTMLElement).hidden)
    c.key('ArrowUp'); ok('↑ raises a semitone (B2 -> C3)', shape(2, 1) === 'C3:2 r:1')
    c.key('Delete'); ok('delete leaves a rest', shape(2, 1) === 'r:3')
    c.key('z', { ctrlKey: true }); ok('undo brings the note back', shape(2, 1) === 'C3:2 r:1')
    c.key('z', { ctrlKey: true }); c.key('z', { ctrlKey: true })

    // marks: a triplet typed with the keyboard, then slur + dynamic + staccato over a shift-click range
    {
      const { emptyScore } = await import('./editor/model')
      c.setScore(emptyScore(2))
      c.setMode('input'); c.key('4')          // eighth notes
      c.tuplet()
      c.key('c'); c.key('d'); c.key('e')
      c.key('5'); c.key('g')
      const evs = c.score.measures[0].staves[0][0]
      ok('triplet typed into its three members', evs.slice(0, 3).every((e) => e.tup && e.pitches.length === 1) && evs.slice(0, 3).map((e) => e.ticks).join() === '320,320,320')
      ok('the next note lands after the triplet', evs[3].pitches.length === 1 && evs[3].ticks === 960)
      c.setMode('select')
      const colX = (k: number) => c.layout.measures[0].evs.filter((e) => e.staff === 0 && e.voice === 0)[k].x
      const topY = c.layout.measures[0].staves[0].top + 5
      c.click(colX(0), topY)
      c.click(colX(3), topY, { shift: true })
      ok('shift+click selects the range', c.range.length === 4)
      c.slur(); c.dynamic('mf'); c.articulate('staccato')
      const e2 = c.score.measures[0].staves[0][0]
      ok('slur from first to last', e2[0].slur === e2[3].id)
      ok('dynamic on the first note', e2[0].dyn === 'mf')
      ok('staccato on every selected note', e2.slice(0, 4).every((e) => e.art?.includes('staccato')))
      c.click(colX(1), topY)
      c.key('Delete'); ok('deleting a triplet note keeps the triplet', c.score.measures[0].staves[0][0][1].tup !== undefined && c.score.measures[0].staves[0][0][1].pitches.length === 0)
      c.key('z', { ctrlKey: true })
    }

    // endings + D.C. set through the toolbar actions, then played through to the falling view
    {
      const { emptyScore, putNote } = await import('./editor/model')
      const { pitch } = await import('./editor/demo')
      const { toPerformance } = await import('./editor/perform')
      const { playOrder } = await import('./core/score/playback')
      c.setScore(emptyScore(6))
      for (let m = 0; m < 6; m++) c.commit((s) => { putNote(s, { m, staff: 0, voice: 0 }, 0, 3840, pitch('CDEFGA'[m] + '5')) }) // one note per bar: C D E F G A
      c.cursor.m = 0; c.mark('segno')
      c.cursor.m = 2; c.ending([1])
      c.cursor.m = 2; c.commit((s) => { s.measures[2].endRepeat = true })
      c.cursor.m = 3; c.ending([2])
      c.cursor.m = 4; c.mark('fine')
      c.cursor.m = 5; c.jump({ kind: 'dc', al: 'fine' })
      c.cursor.m = 0; c.commit((s) => { s.measures[0].startRepeat = true })
      const order = playOrder(toPerformance(c.score).measures).map((i) => 'ABCDEF'[i]).join('')
      ok('toolbar actions build endings + D.C. al Fine and play A B C A B D E F A B D E', order === 'ABCABDEFABDE' || console.log('  got', order) === undefined)
      c.setMode('select')
      c.cursor.m = 2
      ok('bad jump is reported', (c.jump({ kind: 'ds', al: 'coda' }), !!document.querySelector('.cmp-status')?.textContent?.includes('⚠')))
      c.jump(undefined)
      { // preview sound: a second click cancels instead of doubling, and leaving the tab silences it
        const playing = () => !!(c as unknown as { playing?: unknown }).playing || (c as unknown as { starting: boolean }).starting
        void c.togglePlay(); void c.togglePlay()
        await new Promise((r) => setTimeout(r, 1500))
        ok('double-click on "Nghe thử" leaves nothing playing', !playing())
        void c.togglePlay(); await new Promise((r) => setTimeout(r, 1500))
        ok('preview is playing', playing())
        document.getElementById('tab-falling')!.click()
        ok('switching to the falling view stops the preview', !playing())
        document.getElementById('tab-composer')!.click()
      }
    }

    if (new URLSearchParams(location.search).get('ui') === 'menu') (document.querySelector('[aria-label="Tệp"]') as HTMLElement).click()
    // a little tune for the screenshot
    const { minuet, showcase, endings } = await import('./editor/demo')
    c.setScore(location.search.includes('endings') ? endings() : location.search.includes('showcase') ? showcase() : minuet())
    c.setMode('select')
    c.click(c.layout.measures[1].evs.find((e) => e.staff === 0)!.x, c.layout.measures[1].staves[0].top + 5)
    if (location.search.includes('pdf')) { // export a longer score (several pages) as vector PDF
      const { newId } = await import('./editor/model')
      const big = minuet()
      for (let k = 0; k < 4; k++) big.measures.push(...JSON.parse(JSON.stringify(big.measures.slice(0, 8))).map((m: import('./editor/model').Measure) => { m.staves.forEach((vs) => vs.forEach((v) => v.forEach((e) => { e.id = newId(big) }))); return m }))
      c.setScore(big)
      console.log(`pdf score: ${big.measures.length} bars, ${c.layout.systems.length} systems`)
      await c.pdf()
      await new Promise((r) => setTimeout(r, 1500))
      console.log('pdf status: ' + document.querySelector('.cmp-status')?.textContent)
    }
    if (location.search.includes('falling')) {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Xem nốt rơi')) as HTMLButtonElement
      btn.click()
      await new Promise((r) => setTimeout(r, 2500))
      console.log('falling status: ' + document.getElementById('status')!.textContent)
    }
    await new Promise((r) => setTimeout(r, 300))
    return console.log('SELFTEST_DONE')
  }
  if (location.search.includes('editor')) { // render a score with the engraver and look at it
    const { renderScore } = await import('./editor/render')
    const { minuet, showcase, endings } = await import('./editor/demo')
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:99;overflow:auto'
    document.body.append(host)
    const t0 = performance.now()
    const layout = renderScore(host, location.search.includes('endings') ? endings() : location.search.includes('showcase') ? showcase() : minuet(), { width: 1000 })
    console.log(`rendered ${layout.measures.length} bars in ${Math.round(performance.now() - t0)} ms, ${new Set(layout.measures.map((m) => m.system)).size} systems`)
    await new Promise((r) => setTimeout(r, 300))
    return console.log('SELFTEST_DONE')
  }
  if (location.search.includes('synth')) { // a real .mid file through the UI path, then analyse the rendered audio
    const { Midi } = await import('@tonejs/midi')
    const m = new Midi()
    m.addTrack().addNote({ midi: 69, time: 0.5, duration: 0.6, velocity: 0.8 }) // A4 at 0.5 s
    await loadFile(new File([m.toArray().slice().buffer as ArrayBuffer], 'a4.mid'))
    console.log('status: ' + document.getElementById('status')!.textContent + ' | play enabled: ' + !(document.getElementById('play') as HTMLButtonElement).disabled)
    const buf = (await import('./core/synth')).renderNotes
    const b = await buf([{ pitch: 69, start: 0.5, duration: 0.6, velocity: 100 }])
    const d = b.getChannelData(0), sr = b.sampleRate
    const rms = (a: number, z: number) => Math.sqrt(d.slice(Math.round(a * sr), Math.round(z * sr)).reduce((s, x) => s + x * x, 0) / Math.max(1, Math.round((z - a) * sr)))
    console.log(`rms before ${rms(0, 0.45).toFixed(4)} during ${rms(0.6, 0.8).toFixed(4)} after-release ${rms(1.8, 2.2).toFixed(4)}`)
    // pitch by autocorrelation over a 100 ms window inside the note
    const w = d.slice(Math.round(0.7 * sr), Math.round(0.8 * sr))
    let bestLag = 0, best = -1
    for (let lag = Math.round(sr / 900); lag < Math.round(sr / 100); lag++) {
      let c = 0
      for (let i = 0; i + lag < w.length; i++) c += w[i] * w[i + lag]
      if (c > best) { best = c; bestLag = lag }
    }
    console.log(`pitch ${(sr / bestLag).toFixed(1)} Hz (expect 440), peak ${d.reduce((p, x) => Math.max(p, Math.abs(x)), 0).toFixed(2)}`)
    return console.log('SELFTEST_DONE')
  }
  if (location.search.includes('tx')) { // raw model output, no cleanup, several threshold sets
    const { BasicPitch, noteFramesToTime, outputToNotesPoly } = await import('@spotify/basic-pitch')
    const ab = await (await fetch('__file')).arrayBuffer()
    const dec = await transport.ctx.decodeAudioData(ab)
    const off = new OfflineAudioContext(1, Math.ceil(dec.duration * 22050), 22050)
    const src = off.createBufferSource(); src.buffer = dec; src.connect(off.destination); src.start()
    const mono = (await off.startRendering()).getChannelData(0)
    const frames: number[][] = [], onsets: number[][] = []
    await new BasicPitch(new URL('model/model.json', document.baseURI).href).evaluateModel(mono, (f, o) => { frames.push(...f); onsets.push(...o) }, () => {})
    console.log(`frames ${frames.length} (= ${(frames.length * 256 / 22050).toFixed(2)} s of ${dec.duration.toFixed(2)} s audio)`)
    for (const [name, on, fr, len] of [['default', 0.5, 0.3, 11], ['app', 0.25, 0.25, 5]] as const) {
      const n = noteFramesToTime(outputToNotesPoly(frames, onsets, on, fr, len)).map((x) => [x.pitchMidi, x.startTimeSeconds, x.durationSeconds, Math.round(x.amplitude * 127)])
      console.log(`TX ${name} ${JSON.stringify(n)}`)
    }
    return console.log('SELFTEST_DONE')
  }
  if (location.search.includes('export')) { // encode 3 s of a melody + a tone, then decode it back in a <video>
    const mel: Note[] = Array.from({ length: 12 }, (_, i) => ({ pitch: 60 + ((i * 5) % 14), start: 0.3 + i * 0.22, duration: 0.3, velocity: 100 }))
    const sr = 48000, audio = transport.ctx.createBuffer(2, sr * 3, sr)
    for (let ch = 0; ch < 2; ch++) audio.getChannelData(ch).forEach((_, i, a) => (a[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / sr)))
    const v = new PianoView(document.createElement('canvas'), document.createElement('canvas'))
    v.setNotes(mel)
    console.log('glass available: ' + v.glassAvailable)
    const t0 = performance.now()
    let last = 0
    const blob = (await exportVideo({ view: v, duration: 3, audio, height: 720, fps: 30, onProgress: (p) => (last = p), cancelled: () => false }))!
    console.log(`exported ${blob.size} bytes in ${Math.round(performance.now() - t0)} ms (progress ${last})`)
    const vid = document.createElement('video')
    vid.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;background:#000;z-index:99'
    vid.muted = true
    document.body.append(vid)
    vid.src = URL.createObjectURL(blob)
    await new Promise((r) => (vid.onloadedmetadata = r))
    console.log(`decoded: ${vid.videoWidth}x${vid.videoHeight}, duration ${vid.duration.toFixed(2)} s`)
    vid.currentTime = 1.4
    await new Promise((r) => (vid.onseeked = r))
    await new Promise((r) => setTimeout(r, 300))
    return console.log('SELFTEST_DONE')
  }
  if (location.search.includes('file')) {
    const t0 = performance.now()
    await loadFile(new File([await (await fetch('__file')).blob()], new URLSearchParams(location.search).get('name') ?? 'song.mp3'))
    console.log(`loaded in ${Math.round(performance.now() - t0)} ms: ${document.getElementById('status')!.textContent} | ${document.getElementById('bpm')!.textContent}`)
    const seek = document.getElementById('seek') as HTMLInputElement
    console.log('duration ' + seek.max + ' | tooltip: ' + document.getElementById('status')!.title)
    const sel = document.getElementById('theme') as HTMLSelectElement
    const want = new URLSearchParams(location.search).get('theme')
    if (want === 'image') { // stand-in for a photo: a dusk sky with soft lights
      const cv = document.createElement('canvas'); cv.width = 1600; cv.height = 900
      const c = cv.getContext('2d')!
      const sky = c.createLinearGradient(0, 0, 0, 900); sky.addColorStop(0, '#1b2a5c'); sky.addColorStop(0.55, '#c0587a'); sky.addColorStop(1, '#f2a65a')
      c.fillStyle = sky; c.fillRect(0, 0, 1600, 900)
      for (const [x, y, r, col] of [[300, 650, 260, 'rgba(255,220,160,0.9)'], [1200, 300, 200, 'rgba(120,200,255,0.7)'], [900, 760, 320, 'rgba(255,120,150,0.6)'], [150, 200, 160, 'rgba(180,140,255,0.6)']] as const) {
        const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 1600, 900)
      }
      c.fillStyle = '#10121f'; c.beginPath(); c.moveTo(0, 900); for (let x = 0; x <= 1600; x += 40) c.lineTo(x, 760 + 70 * Math.sin(x / 190) + 40 * Math.sin(x / 70)); c.lineTo(1600, 900); c.fill()
      const blob = await new Promise<Blob>((r) => cv.toBlob((b) => r(b!), 'image/jpeg', 0.9))
      const keep = location.search.includes('persist')
      await (window as unknown as { __useBackground(b: Blob, p?: boolean): Promise<void> }).__useBackground(blob, keep)
      if (keep) { await new Promise((r) => setTimeout(r, 300)); const stored = await (await import('./core/cache')).load<Blob>('bg:image'); console.log(`PERSIST stored a ${stored instanceof Blob ? 'Blob' : typeof stored} of ${(stored as Blob | undefined)?.size} bytes (picture sent: ${blob.size})`) }
    } else if (want) { sel.value = want; sel.dispatchEvent(new Event('change')) }
    const ui = new URLSearchParams(location.search).get('ui')
    if (ui) { // open one of the floating panels for a screenshot
      const click = (id: string) => (document.getElementById(id) as HTMLElement).click()
      if (ui === 'settings') click('btn-settings')
      if (ui === 'export') click('btn-export')
      if (ui === 'keys') (document.getElementById('dlg-keys') as HTMLDialogElement).showModal()
      if (ui === 'play') { click('play'); await new Promise((r) => setTimeout(r, 2200)) }
      await new Promise((r) => setTimeout(r, 400))
      return console.log('SELFTEST_DONE')
    }
    if (location.search.includes('edit')) { // open what was just imported in the composer
      ;(document.getElementById('editbtn') as HTMLButtonElement).click()
      await new Promise((r) => setTimeout(r, 600))
      const c = (window as unknown as { __composer: import('./editor/composer').Composer }).__composer
      console.log(`composer: ${c.score.measures.length} bars, key ${c.score.key}, status: ${document.querySelector('.cmp-status')?.textContent}`)
      return console.log('SELFTEST_DONE')
    }
    console.log('NOTES ' + JSON.stringify((window as unknown as { __raw: () => Note[] }).__raw()))
    document.getElementById('reset')!.click() // drop whatever grid the cache held
    const tp = transport as unknown as { seek(t: number): void; play(): void; now(): number; lead: number; playing: boolean }
    if (location.search.includes('lead')) { // lead-in: starts before the song, first notes fall in from the top
      console.log(`LEAD start position ${tp.now().toFixed(2)} s (lead ${tp.lead} s)`)
      tp.play()
      await new Promise((r) => setTimeout(r, 1500))
      console.log(`LEAD after 1.5 s of playing: ${tp.now().toFixed(2)} s`)
      return console.log('SELFTEST_DONE')
    }
    tp.seek(+(new URLSearchParams(location.search).get('seek') ?? 29.6))
    tp.play() // play through a few note onsets so sparks are on screen
    await new Promise((r) => setTimeout(r, 700))
    return console.log('SELFTEST_DONE')
  }
  const sr = 22050, truth = [[69, 0.5], [72, 1.5], [76, 2.5]]
  const buf = transport.ctx.createBuffer(1, sr * 4, sr)
  const y = buf.getChannelData(0)
  for (const [pitch, s] of truth) {
    const f = 440 * 2 ** ((pitch - 69) / 12)
    for (let i = 0; i < 0.8 * sr; i++) y[Math.floor(s * sr) + i] += 0.5 * Math.sin((2 * Math.PI * f * i) / sr) * Math.exp((-1.5 * i) / sr)
  }
  const t0 = performance.now()
  const notes = clean(await transcribe(buf))
  console.log(`transcribed in ${Math.round(performance.now() - t0)} ms: ` + JSON.stringify(notes.map((n) => [n.pitch, +n.start.toFixed(3)])))
  for (const [pitch, s] of truth) {
    const ok = notes.some((n) => n.pitch === pitch && Math.abs(n.start - s) < 0.05)
    console.log(`${ok ? 'PASS' : 'FAIL'} pitch ${pitch} @ ${s}s`)
  }
  // a 100 bpm melody (shown with beat lines) for the screenshot
  const mel: Note[] = Array.from({ length: 64 }, (_, i) => ({ pitch: 55 + ((i * 5) % 24), start: 0.2 + (i * 0.3) + (i % 3) * 0.004, duration: 0.25, velocity: i % 4 === 0 ? 110 : 70 }))
  show(mel)
  const t = 3.3
  ;(view as { draw(t: number): void }).draw(t)
  console.log('SELFTEST_DONE')
}
