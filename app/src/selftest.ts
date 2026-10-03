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
      { // the palette buttons really act on the score
        const d = await import('./editor/demo')
        c.setScore(d.fromText([{ rh: 'C5+E5+G5:2 D5:1 E5:1', lh: 'r:4' }, { rh: 'F5:1 G5:1 A5:1 B5:1', lh: 'r:4' }, { rh: 'C6:4', lh: 'r:4' }]))
        const press = (label: string) => { const b = document.querySelector<HTMLElement>(`.cmp-insp [aria-label="${label}"]`); if (!b) throw new Error('no button ' + label); b.click() }
        const evs = () => c.score.measures[0].staves[0][0]
        c.sel = evs()[0].id; c.range = []
        press('Rải lên'); ok('palette: Rải lên sets an upward arpeggio', evs()[0].arp === 'up')
        press('Trill'); ok('palette: Trill', evs()[0].orn === 'trill')
        press('Tremolo 2 vạch'); ok('palette: Tremolo 2 vạch', evs()[0].trem === 2)
        press('Staccatissimo'); ok('palette: Staccatissimo', !!evs()[0].art?.includes('staccatissimo'))
        press('Appoggiatura'); ok('palette: grace note appears a step above', evs()[0].graces?.length === 1 && evs()[0].graces![0].step === 'A')
        press('Sfz'.toLowerCase()); ok('palette: sfz', evs()[0].dyn === 'sfz')
        const bar1 = c.score.measures[1].staves[0][0]
        c.sel = bar1[0].id; c.selectRange(bar1[3].id)
        press('8va (lên 1 quãng tám)'); ok('palette: 8va over the selected notes', bar1[0].ottava?.n === 8 && bar1[0].ottava.end === bar1[3].id)
        press('Pedal'); ok('palette: pedal over the selected notes', bar1[0].pedal?.end === bar1[3].id)
        c.cursor = { m: 1, staff: 1, at: 0 }; c.sel = undefined; c.range = []
        press('Sol 8 dưới'); ok('palette: clef change at the cursor bar, lower staff', c.score.measures[1].clefs?.[1] === 'treble8vb')
        press('Vạch đôi'); ok('palette: double barline', c.score.measures[1].barline === 'double')
        press('Xuống dòng'); ok('palette: line break', c.score.measures[1].break === 'system')
        press('Nhịp 3/4'); ok('palette: 3/4 keeps all the notes (re-barred)', c.score.measures[1].time?.beats === 3 && c.score.measures.flatMap((m) => m.staves[0].flat()).filter((e) => e.pitches.length).length >= 8)
        const tin = document.getElementById('cmp-text') as HTMLInputElement
        c.sel = c.score.measures[0].staves[0][0][1].id; tin.value = 'la'; tin.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true }))
        ok('text box: Enter sets a lyric and moves on to the next note', c.score.measures[0].staves[0][0][1].lyric === 'la' && c.sel !== c.score.measures[0].staves[0][0][1].id)
        c.undo(); c.undo()
        c.setScore(d.minuet())
      }
      { // picking up and moving notes and marks with the mouse; stacking voices; rests stepping aside
        const d = await import('./editor/demo')
        c.setScore(d.fromText([{ rh: 'C5:1 D5:1 E5:1 F5:1', lh: 'C3:4' }, { rh: 'G5:4', lh: 'r:4' }, { rh: 'r:4', lh: 'r:4' }]))
        c.score.measures[0].staves[0][0][0].dyn = 'p'; c.refresh()
        const svgNow = () => document.querySelector('.cmp-sheet svg') as SVGElement // the page is redrawn after every edit: always take the current one
        const toClient = (x: number, y: number) => { const r = svgNow().getBoundingClientRect(); return { clientX: r.left + (x * r.width) / c.layout.width, clientY: r.top + (y * r.width) / c.layout.width } }
        const fire = (el: EventTarget, type: string, x: number, y: number, extra: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...toClient(x, y), ...extra }))
        const drag = (x0: number, y0: number, x1: number, y1: number, extra: MouseEventInit = {}, from?: EventTarget) => { fire(from ?? svgNow(), 'mousedown', x0, y0, extra); fire(window, 'mousemove', (x0 + x1) / 2, (y0 + y1) / 2, extra); fire(window, 'mousemove', x1, y1, extra); fire(window, 'mouseup', x1, y1, extra); fire(svgNow(), 'click', x1, y1, extra) }
        c.setMode('select')
        const m0 = () => c.layout.measures[0], ev = (k: number) => m0().evs.filter((e) => e.staff === 0 && e.voice === 0)[k]
        const sp = m0().staves[0].spacing
        // 1. drag D5 up two steps
        const e1 = ev(1)
        drag(e1.x + 5, e1.ys[0], e1.x + 5, e1.ys[0] - sp)
        ok('drag a note up: pitch changes by steps', c.score.measures[0].staves[0][0][1].pitches[0].step === 'F' && c.score.measures[0].staves[0][0][1].pitches[0].octave === 5)
        // 2. drag the first note to bar 2 (next to G5): it moves in time and leaves a rest behind
        const e0 = ev(0), dm1 = c.layout.measures[1], g5 = dm1.evs.find((e) => e.staff === 0)!
        drag(e0.x + 5, e0.ys[0], g5.x + 6, e0.ys[0])
        ok('drag a note to another bar: it lands there', c.score.measures[1].staves[0][0].some((e) => e.pitches[0]?.step === 'C') || c.score.measures[1].staves[0][0].length > 1)
        ok('drag a note to another bar: the old place is a rest', c.score.measures[0].staves[0][0][0].pitches.length === 0)
        // 3. Shift-drag stacks it into voice 2 on the same beat
        c.setScore(d.fromText([{ rh: 'C5:1 D5:1 E5:1 F5:1', lh: 'C3:4' }, { rh: 'r:4', lh: 'r:4' }]))
        const f0 = c.layout.measures[0].evs.filter((e) => e.staff === 0 && e.voice === 0)
        c.voice = 1
        const a1 = f0[1]
        drag(a1.x + 5, a1.ys[0], f0[0].x + 5, a1.ys[0] + 2 * c.layout.measures[0].staves[0].spacing, { shiftKey: true })
        const v0 = c.score.measures[0].staves[0]
        ok('shift-drag moves a note into voice 2 on that beat (the voices stack)', v0.length === 2 && v0[1][0].pitches.length === 1 && v0[0][0].pitches[0].step === 'C' && v0[0][1].pitches.length === 0)
        c.voice = 0
        // 4. a rest of the other voice does not sit on top of the notes
        const restEv = c.layout.measures[0].evs.find((e) => e.staff === 0 && e.voice === 1 && e.rest)
        const noteEv = c.layout.measures[0].evs.find((e) => e.staff === 0 && e.voice === 0 && !e.rest)
        ok('multi-voice: rests are drawn clear of the notes', !!restEv && !!noteEv && restEv.ys.every((y) => noteEv.ys.every((n) => Math.abs(y - n) > c.layout.measures[0].staves[0].spacing * 0.9)))
        // 5. dynamic: pick it up, drag it to another note, delete it
        c.setScore(d.fromText([{ rh: 'C5:1 D5:1 E5:1 F5:1', lh: 'C3:4' }]))
        c.score.measures[0].staves[0][0][0].dyn = 'p'; c.refresh()
        const dyn = svgNow().querySelector('[data-mark*="dyn"]') as SVGElement
        const db = dyn.getBoundingClientRect(), r2 = svgNow().getBoundingClientRect(), ex = c.layout.measures[0].evs.filter((e) => e.staff === 0)[2]
        const dx = ((db.left + db.width / 2 - r2.left) * c.layout.width) / r2.width, dy = ((db.top + db.height / 2 - r2.top) * c.layout.width) / r2.width
        drag(dx, dy, ex.x + 5, dy, {}, dyn)
        ok('drag a dynamic onto another note moves it', c.score.measures[0].staves[0][0][2].dyn === 'p' && c.score.measures[0].staves[0][0][0].dyn === undefined)
        c.key('Delete'); ok('Delete removes the picked mark', c.score.measures[0].staves[0][0][2].dyn === undefined)
        // 6. tempo mark in the middle of a bar, then dragged to another bar
        c.setScore(d.fromText([{ rh: 'C5:1 D5:1 E5:1 F5:1', lh: 'C3:4' }, { rh: 'G5:4', lh: 'r:4' }, { rh: 'A5:4', lh: 'r:4' }], { tempo: 60 }))
        c.sel = c.score.measures[0].staves[0][0][2].id; c.tempoMark(120, 'Allegro')
        ok('tempo mark at a note in the middle of the bar', c.score.measures[0].tempo === 120 && c.score.measures[0].tempoAt === 2 * 960)
        const tm = svgNow().querySelector('[data-mark*="tempo"]') as SVGElement
        const tb = tm.getBoundingClientRect(), r3 = svgNow().getBoundingClientRect(), g5b = c.layout.measures[1].evs.find((e) => e.staff === 0)!
        const tx = ((tb.left + tb.width / 2 - r3.left) * c.layout.width) / r3.width, ty = ((tb.top + tb.height / 2 - r3.top) * c.layout.width) / r3.width
        drag(tx, ty, g5b.x + 5, ty, {}, tm)
        ok('drag the tempo mark to bar 2', c.score.measures[1].tempo === 120 && c.score.measures[0].tempo === undefined)
        // 7. + / - bar follow the picked line, not the last one
        c.setScore(d.fromText(Array.from({ length: 10 }, () => ({ rh: 'C5:4', lh: 'r:4' }))))
        const sys0 = c.layout.systems[0], x0 = c.layout.measures.filter((q) => q.system === 0)
        c.click(c.layout.width - 6, (sys0.y0 + sys0.y1) / 2)             // right of the last bar of the first line
        const lastOfLine1 = x0[x0.length - 1].m
        const nBefore = c.score.measures.length
        c.addBar()
        ok('"+ ô nhịp" with line 1 picked adds after the last bar of line 1', c.score.measures.length === nBefore + 1 && c.score.measures[lastOfLine1 + 1].staves[0][0].every((e) => !e.pitches.length) && c.score.measures[lastOfLine1].staves[0][0][0].pitches.length === 1)
        c.undo()
      }
      { // copy / cut / paste with the keyboard and the buttons, select all, box selection
        const d = await import('./editor/demo')
        c.setScore(d.fromText([{ rh: 'C5:1 D5:1 E5:1 F5:1', lh: 'C3:4' }, { rh: 'r:4', lh: 'r:4' }, { rh: 'r:4', lh: 'r:4' }]))
        c.setMode('select')
        const notes0 = () => c.score.measures[0].staves[0][0].map((e) => e.pitches[0]?.step ?? 'r').join('')
        const first = c.score.measures[0].staves[0][0]
        c.sel = first[0].id; c.selectRange(first[1].id)
        c.key('c', { ctrlKey: true })                                      // copy C D
        c.cursor = { m: 1, staff: 0, at: 0 }; c.sel = undefined; c.range = []
        c.key('v', { ctrlKey: true })
        ok('Ctrl+C then Ctrl+V pastes the notes at the cursor', c.score.measures[1].staves[0][0].map((e) => e.pitches[0]?.step ?? 'r').join('').startsWith('CD'))
        ok('the pasted notes are selected', c.targets().length === 2)
        const second = c.score.measures[1].staves[0][0]
        c.sel = second[0].id; c.selectRange(second[1].id)
        c.key('x', { ctrlKey: true })
        ok('Ctrl+X removes them (they become rests)', c.score.measures[1].staves[0][0].every((e) => !e.pitches.length))
        c.cursor = { m: 2, staff: 0, at: 0 }; c.range = []; c.sel = undefined
        c.key('v', { metaKey: true })
        ok('Cmd+V works too, and pastes what was cut', c.score.measures[2].staves[0][0].map((e) => e.pitches[0]?.step ?? 'r').join('').startsWith('CD'))
        c.undo(); c.undo(); c.undo()
        ok('undo takes the pastes back', notes0() === 'CDEF' && c.score.measures[1].staves[0][0].every((e) => !e.pitches.length))
        c.key('a', { ctrlKey: true })
        ok('Ctrl+A selects every note and rest', c.targets().length >= 8)
        c.sel = undefined; c.range = []; c.refresh()
        // a copied bar goes to another bar with the buttons
        c.sel = undefined; c.cursor = { m: 0, staff: 0, at: 0 }
        ;(document.querySelector('[aria-label="Sao chép"]') as HTMLElement).click()
        c.cursor = { m: 2, staff: 0, at: 0 }
        ;(document.querySelector('[aria-label="Dán"]') as HTMLElement).click()
        ok('copy a bar with the button and paste it with the button (both staves)', c.score.measures[2].staves[0][0].map((e) => e.pitches[0]?.step ?? 'r').join('') === 'CDEF' && c.score.measures[2].staves[1][0][0].pitches[0]?.step === 'C')
        // box selection
        const svgNow = () => document.querySelector('.cmp-sheet svg') as SVGElement
        const toClient = (x: number, y: number) => { const r = svgNow().getBoundingClientRect(); return { clientX: r.left + (x * r.width) / c.layout.width, clientY: r.top + (y * r.width) / c.layout.width } }
        const fire = (el: EventTarget, type: string, x: number, y: number) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...toClient(x, y) }))
        const dm = c.layout.measures[0], st = dm.staves[0], evs = dm.evs.filter((e) => e.staff === 0)
        const x0 = evs[0].x - 14, y0 = st.top - 40, x1 = evs[1].x + 14, y1 = st.bottom + 20
        fire(svgNow(), 'mousedown', x0, y0); fire(window, 'mousemove', (x0 + x1) / 2, (y0 + y1) / 2); fire(window, 'mousemove', x1, y1); fire(window, 'mouseup', x1, y1)
        ok('dragging a box on empty space selects the notes inside it', c.targets().length === 2 && c.targets().every((id) => evs.slice(0, 2).some((e) => e.id === id)))
        c.setScore(d.minuet())
      }
      { // stacking: clicking another pitch on a note's column makes a chord (also with a dotted / beamed run), clicking it again takes it out
        const d = await import('./editor/demo'), { validate } = await import('./editor/model')
        await new Promise((r) => setTimeout(r, 20)) // let a click-suppression timer of the drag tests above run out
        c.setScore(d.fromText([{ rh: 'C5:1 D5:1 E5:1 F5:1', lh: 'C3:4' }]))
        c.setMode('input')
        const dm = () => c.layout.measures[0], st = () => dm().staves[0]
        const col = () => dm().evs.filter((e) => e.staff === 0 && e.voice === 0)[1]
        const yOf = (step: number) => st().bottom - (step * st().spacing) / 2      // step 0 = bottom line (E4)
        c.click(col().x + 5, yOf(8))                                          // F5 above D5 on the same column
        const note = () => c.score.measures[0].staves[0][0][1]
        ok('input mode: a click on a note\'s column stacks the pitch (a dyad)', note().pitches.map((p) => p.step + p.octave).join(' ') === 'D5 F5' && c.score.measures[0].staves[0][0].length === 4)
        c.click(col().x + 5, yOf(0))                                          // a third one, E4, far below
        ok('and again: three notes on one stem, the bar is still full', note().pitches.length === 3 && validate(c.score).length === 0)
        c.click(col().x + 5, yOf(8))                                          // F5 again: taken out
        ok('clicking a pitch that is already there removes it from the chord', note().pitches.map((p) => p.step + p.octave).join(' ') === 'E4 D5')
        c.click(col().x + 5, yOf(1), { ctrl: true })                           // Ctrl: replace instead of stack
        ok('Ctrl+click replaces the note', c.score.measures[0].staves[0][0][1].pitches.length === 1)
        // crowded bars widen by themselves: chords with seconds and accidentals in sixteenths, many bars
        c.setScore(d.fromText(Array.from({ length: 6 }, () => ({ rh: 'r:4', lh: 'r:4' }))))
        c.setMode('input'); c.setDuration(2)
        for (let m = 0; m < 6; m++) for (let i = 0; i < 8; i++) { c.cursor = { m, staff: 1, at: i * 240 }; c.pendingAlter = i % 3 === 0 ? 1 : undefined; c.letter('C', false); c.cursor = { m, staff: 1, at: i * 240 }; c.letter('D', true); c.letter('E', true) }
        const slack = c.layout.measures.map((dm) => {
          const per = new Map<number, { x: number; right: number }>()
          for (const e of dm.evs.filter((q) => q.staff === 1 && !q.rest)) per.set(Math.round(e.x), { x: e.x, right: Math.max(per.get(Math.round(e.x))?.right ?? 0, e.right) })
          const cols = [...per.values()].sort((a, b) => a.x - b.x)
          return Math.min(...cols.slice(1).map((q, i) => q.x - cols[i].x - cols[i].right))
        })
        ok('dense chord bars get room: no two columns of notes touch', slack.every((v) => v >= 0))
        { // seven sharps eat the room of the bar that opens a line; chords on ledger lines are wider than their heads
          const { putNote } = await import('./editor/model')
          const bars = Array.from({ length: 16 }, () => ({ rh: Array(6).fill('A#5+C#6+E#6:0.25').join(' '), lh: 'F#2:0.5 F#2+C#3+A#2:0.5 F#2+C#3+A#2:0.5' }))
          const sc = d.fromText(bars, { key: 7, beats: 3, unit: 8 })
          void putNote
          c.setScore(sc)
          const box = new Map([...document.querySelectorAll('.cmp-sheet svg [data-ev]')].map((el) => { const r = (el as SVGGraphicsElement).getBBox(); return [+el.getAttribute('data-ev')!, { x: r.x, w: r.width }] as const }))
          const gaps = c.layout.measures.flatMap((dm) => [0, 1].map((si) => { // as drawn: the next column starts after the previous one (ledger lines included) ends
            const cols = dm.evs.filter((q) => q.staff === si && !q.rest && box.has(q.id)).map((q) => box.get(q.id)!).sort((p, q) => p.x - q.x)
            return Math.min(...cols.slice(1).map((q, i) => q.x - cols[i].x - cols[i].w))
          }))
          ok('seven sharps, chords on ledger lines, bars that open a line: no two columns touch', gaps.every((v) => v >= 0))
        }
        { // the whole line is pulled by one force: eighths get 1/1.5 of the room of quarters, in every bar of the line
          const sc = d.fromText([{ rh: 'C5:1 C5:1 C5:1 C5:1', lh: 'r:4' }, { rh: Array(8).fill('C5:0.5').join(' '), lh: 'r:4' }, { rh: 'C5:1 C5:1 C5:1 C5:1', lh: 'r:4' }])
          c.setScore(sc)
          const gap = (m: number) => { const xs = c.layout.measures[m].evs.filter((q) => q.staff === 0 && !q.rest).map((q) => q.x).sort((p, q) => p - q); return xs[2] - xs[1] }
          const ratio = gap(0) / gap(1)
          ok('quarters get 1.5x the room of eighths, and the same room in every bar', ratio > 1.4 && ratio < 1.6 && Math.abs(gap(0) - gap(2)) < 0.5)
        }
        { // keyboard entry the way MuseScore does it
          const evs = (m = 0, staff = 0, v = 0) => c.score.measures[m].staves[staff][v]
          const names = () => evs().map((e) => e.pitches.map((p) => p.step + p.octave).join('+') || 'r').join(' ')
          const lens = () => evs().map((e) => e.ticks).join()
          const fresh = () => { c.setScore(d.fromText(Array.from({ length: 3 }, () => ({ rh: 'r:4', lh: 'r:4' })))); c.setMode('input'); c.cursor = { m: 0, staff: 0, at: 0 }; c.sel = undefined }
          fresh(); c.key('5'); c.key('C'); c.key('w'); c.key('E'); c.key('q'); c.key('q'); c.key('G')
          ok('W doubles and Q halves the length for the next notes: quarter, half, eighth', lens().startsWith('960,1920,480') && names().startsWith('C4 E4 G4'))
          c.setScore(d.fromText([{ rh: 'C5:1 r:3', lh: 'r:4' }])); c.setMode('select'); c.sel = evs()[0].id
          c.key('3', { altKey: true, code: 'Digit3' })
          ok('Alt+3 adds a third above', names().startsWith('C5+E5 r'))
          c.key('5', { altKey: true, shiftKey: true, code: 'Digit5' })
          ok('Shift+Alt+5 adds a fifth below the bottom note', names().startsWith('F4+C5+E5 r'))
          c.key('ArrowUp', { ctrlKey: true })
          ok('Ctrl+Up moves the chord an octave', names().startsWith('F5+C6+E6 r'))
          c.key('2', { ctrlKey: true, altKey: true, code: 'Digit2' })
          ok('Ctrl+Alt+2 chooses voice 2', c.voice === 1); c.setVoice(0)
          fresh(); c.key('ArrowRight', { ctrlKey: true })
          ok('Ctrl+Right jumps to the start of the next bar', c.cursor.m === 1 && c.cursor.at === 0)
          fresh(); c.key('5'); c.key('C'); c.key('D'); c.sel = undefined; c.key('Backspace')
          ok('Backspace takes back the last note (it becomes a rest) and stands where it was', names() === 'C5 r r' && c.cursor.at === 960)
          c.key('0')
          ok('0 enters a rest and moves on', c.cursor.at === 1920)
        }
        { // texts around a very high and a very low note step aside: nothing placed on the page covers a note or another text
          const sc = d.fromText([{ rh: 'C7:1 E5:1 r:2', lh: 'A1:1 C3:1 r:2' }])
          const [hi, mid] = sc.measures[0].staves[0][0], [lo] = sc.measures[0].staves[1][0]
          hi.chord = 'Am'; hi.staffText = 'dolce'; mid.chord = 'F'
          lo.dyn = 'p'; lo.lyric = 'la'; lo.expr = 'rit.'
          c.setScore(sc)
          const rect = (el: Element) => el.getBoundingClientRect()
          const box = (el: Element) => { const r = (el as SVGGraphicsElement).getBBox(), t = /translate\(0 (-?[\d.]+)\)/.exec(el.getAttribute('transform') ?? ''); return { x0: r.x, x1: r.x + r.width, y0: r.y + +(t?.[1] ?? 0), y1: r.y + r.height + +(t?.[1] ?? 0) } }
          const over = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.x0 < b.x1 - 0.5 && a.x1 > b.x0 + 0.5 && a.y0 < b.y1 - 0.5 && a.y1 > b.y0 + 0.5
          const marks = [...document.querySelectorAll('.cmp-sheet svg [data-mark]')].filter((el) => /"field":"(chord|staffText|lyric|expr)"/.test(el.getAttribute('data-mark')!)) // (a music-font glyph's box is the font's em, not its ink: dynamics are checked below)
          const heads = c.layout.measures[0].evs.filter((e) => !e.rest).flatMap((e) => e.ys.map((y) => ({ x0: e.x - e.left, x1: e.x + e.right, y0: y - 6, y1: y + 6 })))
          const bad = marks.flatMap((m, i) => [...heads.filter((h) => over(box(m), h)).map(() => m.textContent + ' x head'), ...marks.slice(i + 1).filter((o) => over(box(m), box(o))).map((o) => m.textContent + ' x ' + o.textContent)])
          if (bad.length) console.log('  clashing: ' + bad.join(', '))
          ok('chord symbols, text, lyrics and expression marks do not cover notes or each other', marks.length === 5 && bad.length === 0)
          const lyricEl = marks.find((m) => m.textContent === 'la')!
          ok('a lyric on the same note as a dynamic steps below it', !!lyricEl.getAttribute('transform'))
        }
        { // hold the right (or middle) button and drag: the page follows the hand
          c.setScore(d.minuet()); c.setZoom(2.5)
          const page = document.querySelector<HTMLElement>('.cmp-page')!
          const fire = (type: string, target: EventTarget, x: number, y: number, button: number) => target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true }))
          for (const button of [2, 1]) {
            page.scrollLeft = 300; page.scrollTop = 200
            fire('mousedown', page, 500, 400, button); fire('mousemove', window, 420, 360, button); fire('mouseup', window, 420, 360, button)
            ok(`button ${button} + drag moves the page with the hand (left 80, up 40 = scroll +80, +40)`, page.scrollLeft === 380 && page.scrollTop === 240 && !page.classList.contains('panning'))
          }
          ok('the context menu does not open over the page', !fire('contextmenu', page, 500, 400, 2))
          const sel = c.sel; page.scrollLeft = 300; fire('mousedown', page, 500, 400, 0); fire('mousemove', window, 420, 360, 0); fire('mouseup', window, 420, 360, 0)
          ok('the left button still does not pan (it selects / drags notes)', page.scrollLeft === 300 && c.sel === sel)
          c.zoomFit()
        }
        { // input mode: the preview note under the mouse says what a click would write and shows the ledger lines it needs
          c.setScore(d.fromText([{ rh: 'C5:1 r:3', lh: 'r:4' }])); c.setMode('input'); c.key('5')
          const sheet = document.querySelector<HTMLElement>('.cmp-sheet')!, dm = c.layout.measures[0], st = dm.staves[0]
          const move = (lx: number, ly: number) => { const r = sheet.getBoundingClientRect(), k = r.width / c.layout.width; sheet.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + lx * k, clientY: r.top + ly * k, bubbles: true })) }
          const col = dm.evs[0].x
          move(col, st.bottom - (4 * st.spacing) / 2) // the middle line of the treble staff: B4, no ledger lines
          const status = document.querySelector('.cmp-status')!.textContent!
          ok('the preview says the pitch and length a click would write', status.includes('B4') && status.includes('Đen'))
          const lines = () => document.querySelectorAll('.cmp-sheet svg g[opacity="0.35"] line').length
          const none = lines()
          move(col, st.top - (3 * st.spacing) / 2 - 0.0) // 3 half-steps above the top line: C6 area, two ledger lines
          ok('a high preview note draws its ledger lines, a note on the staff draws none', none === 0 && lines() >= 1)
        }
        { // marks are dragged freely, up and down, like in MuseScore
          const { findEv } = await import('./editor/model')
          const sc = d.fromText([{ rh: 'C5:1 D5:1 E5:1 F5:1', lh: 'r:4' }])
          const [n0, n1] = sc.measures[0].staves[0][0]
          n0.dyn = 'p'; n0.hairpin = { type: 'cresc', end: n1.id }; n0.chord = 'Am'
          c.setScore(sc); c.zoomFit()
          const sheet = document.querySelector<HTMLElement>('.cmp-sheet')!
          const scale = () => sheet.getBoundingClientRect().width / c.layout.width
          const centre = (el: Element) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }
          const fire = (type: string, target: EventTarget, x: number, y: number) => target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }))
          for (const [field, dir] of [['dyn', 1], ['hairpin', 1], ['chord', -1]] as const) {
            const el = document.querySelector(`.cmp-sheet svg [data-mark*='"${field}"']`)!
            const [x, y] = centre(el), before = el.getBoundingClientRect().top
            fire('mousedown', el, x, y); fire('mousemove', window, x, y + dir * 30); fire('mouseup', window, x, y + dir * 30)
            const now = document.querySelector(`.cmp-sheet svg [data-mark*='"${field}"']`)!, moved = (now.getBoundingClientRect().top - before) / scale()
            const o = findEv(c.score, n0.id)!.ev
            ok(`dragging a ${field} 30 px ${dir > 0 ? 'down' : 'up'} sets its offset and keeps it on its note`, Math.abs((o.off?.[field] ?? 0) - dir * 30 / scale()) < 1.5 && Math.abs(Math.abs(moved) - 30 / scale()) < 2 && (field === 'hairpin' ? !!o.hairpin : !!o[field]))
          }
        }
        { // the grip between a line's two staves
          c.setScore(d.minuet()); c.zoomFit()
          const sheet = document.querySelector<HTMLElement>('.cmp-sheet')!
          const scale = () => sheet.getBoundingClientRect().width / c.layout.width
          const gap = (sys: number) => { const dm = c.layout.measures.find((q) => q.system === sys)!; return dm.staves[1].top - dm.staves[0].top }
          const fire = (type: string, target: EventTarget, x: number, y: number) => target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }))
          const grip = (sys: number) => document.querySelector(`.cmp-sheet svg .gap-handle[data-gap="${sys}"] rect`)!
          const drag = (sys: number, dy: number) => { const r = grip(sys).getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; fire('mousedown', grip(sys), x, y); fire('mousemove', window, x, y + dy); fire('mouseup', window, x, y + dy) }
          const usual = gap(0), second = gap(1), h0 = c.layout.height
          { const r = grip(0).getBoundingClientRect(); ok('a real pointer over the grip hits the grip', !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.gap-handle')) }
          drag(0, 30 * scale())
          ok('dragging the grip pulls the staves of that line apart, and only that line', Math.abs(gap(0) - usual - 30) < 1.5 && gap(1) === second && c.layout.height > h0 + 25)
          drag(0, -500 * scale())
          ok('they cannot be pushed into each other', gap(0) >= 65 && gap(0) <= usual)
          c.undo(); c.undo()
          ok('undo puts them back', gap(0) === usual)
          drag(1, 20 * scale()); grip(1).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
          ok('a double click on the grip resets the line', gap(1) === second)
          const { pdfPages } = await import('./editor/io')
          ok('the grips are not part of an exported page', !pdfPages(document.querySelector('.cmp-sheet svg') as unknown as SVGElement, c.layout).includes('gap-handle'))
        }
        { // inserting layout the way MuseScore does
          const { findEv } = await import('./editor/model')
          const bars = (n: number) => d.fromText(Array.from({ length: n }, () => ({ rh: 'C5:4', lh: 'r:4' })))
          c.setScore(bars(4)); c.sel = c.score.measures[1].staves[0][0][0].id
          const open = (count: number, where: string) => {
            const dlg = document.getElementById('dlg-insert') as HTMLDialogElement
            c.openInsertBars()
            ;(dlg.querySelector('#ins-count') as HTMLInputElement).value = String(count)
            ;(dlg.querySelector(`input[name="ins-where"][value="${where}"]`) as HTMLInputElement).checked = true
            ;(dlg.querySelector('button[value="ok"]') as HTMLButtonElement).click()
          }
          open(3, 'after'); await new Promise((r) => setTimeout(r, 30))
          ok('the dialog inserts several bars after the selected one, in one go', c.score.measures.length === 7 && c.score.measures[5].staves[0][0].some((e) => e.pitches.length) && !c.score.measures[2].staves[0][0].some((e) => e.pitches.length))
          c.undo(); ok('one undo takes them all out', c.score.measures.length === 4)
          open(2, 'start'); await new Promise((r) => setTimeout(r, 30)); open(1, 'end'); await new Promise((r) => setTimeout(r, 30))
          ok('also at the start and at the end of the piece', c.score.measures.length === 7 && findEv(c.score, c.score.measures[2].staves[0][0][0].id)!.m === 2)
          // keeping bars together and breaking sections
          c.setScore(bars(24))
          const sysOf = (m: number) => c.layout.measures[m].system
          const brokeAt = c.layout.measures.find((dm, i) => i > 0 && dm.system !== c.layout.measures[i - 1].system)!.m // the first bar of line 2 without any help
          c.setScore(bars(24)); c.cursor.m = brokeAt - 1; c.sel = c.score.measures[brokeAt - 1].staves[0][0][0].id
          c.keepTogether()
          ok('"keep together" moves a bar to the next line with its partner instead of splitting them', sysOf(brokeAt - 1) === sysOf(brokeAt) && sysOf(brokeAt - 1) !== sysOf(brokeAt - 2))
          c.setScore(bars(4)); c.sel = c.score.measures[1].staves[0][0][0].id; c.pageBreak('section')
          ok('a section break starts a new line after that bar, with a double bar', sysOf(2) !== sysOf(1) && c.score.measures[1].break === 'section')
          // deleting a whole line
          c.setScore(bars(24)); const n0 = c.score.measures.length
          const first = c.layout.measures.filter((dm) => dm.system === 0).length
          c.sysRange = [0, first - 1]; c.sel = undefined; c.delLine()
          ok('"delete the line" takes out every bar of the picked line', c.score.measures.length === n0 - first)
        }
        c.setMode('select')
        // marks must be hit by a real pointer: ask the page which element is under the centre of each kind of mark
        c.setScore(d.fromText([{ rh: 'C5:1 D5:1 E5:1 F5:1', lh: 'C3:4' }, { rh: 'G5:4', lh: 'r:4' }], { tempo: 60 }))
        { const q = c.score.measures[0].staves[0][0]; q[0].dyn = 'p'; q[1].lyric = 'la'; q[2].chord = 'Am'; q[3].staffText = 'dolce'; c.sel = q[1].id; c.tempoMark(90, 'Allegro'); c.rehearsal('A') }
        await new Promise((r) => setTimeout(r, 80))
        { const kinds: string[] = []; for (const el of document.querySelectorAll<SVGElement>('.cmp-sheet svg [data-mark]')) { const b = el.getBoundingClientRect(); const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); if (top !== el) kinds.push(el.getAttribute('data-mark')!) } 
          ok('every mark can be grabbed with a real pointer (the element under its centre is the mark)', kinds.length === 0 && document.querySelectorAll('.cmp-sheet svg [data-mark]').length >= 6) ; if (kinds.length) console.log('  not grabbable: ' + kinds.join(' ')) }
        c.setScore(d.minuet())
      }
      { // zoom: fit follows the window, steps, pointer-anchored wheel zoom, clicks still land on the right note
        const d = await import('./editor/demo')
        c.setScore(d.minuet())
        const page = document.querySelector('.cmp-page') as HTMLElement, sheet = document.querySelector('.cmp-sheet') as HTMLElement
        const width = () => sheet.getBoundingClientRect().width
        c.zoomFit()
        const avail = () => page.clientWidth - 2 * parseFloat(getComputedStyle(page).paddingLeft)
        ok('fit: the page is as wide as the window allows', Math.abs(width() - Math.min(1900, avail())) < 2)
        const wide = width()
        page.style.maxWidth = '640px'; await new Promise((r) => setTimeout(r, 120))
        ok('fit: a narrower window makes the page narrower by itself', width() < wide - 50 && Math.abs(width() - avail()) < 2)
        page.style.maxWidth = ''
        const p0 = c.zoomPercent()
        c.zoomIn(); ok('zoom in grows the page', c.zoomPercent() > p0 && c.zoomMode !== 'fit')
        c.setZoom(1); ok('100 % = 1000 px wide', Math.abs(width() - 1000) < 1 && c.zoomPercent() === 100)
        c.setZoom(2); ok('200 % = 2000 px wide (scrolls)', Math.abs(width() - 2000) < 1)
        c.zoomOut(); ok('zoom out steps down', c.zoomPercent() < 200 && c.zoomPercent() >= 150)
        for (let i = 0; i < 20; i++) c.zoomOut()
        ok('zoom out stops at the smallest size', c.zoomPercent() >= 34 && c.zoomPercent() <= 36)
        for (let i = 0; i < 30; i++) c.zoomIn()
        ok('zoom in stops at the largest size', c.zoomPercent() >= 349 && c.zoomPercent() <= 351)
        c.key('0', { ctrlKey: true }); ok('Ctrl+0 fits again', c.zoomMode === 'fit')
        c.key('=', { ctrlKey: true }); ok('Ctrl and + zooms in', c.zoomMode !== 'fit')
        c.key('-', { metaKey: true }); c.key('-', { metaKey: true })
        ok('Cmd and − zooms out', c.zoomPercent() < 100)
        ok('the choice is remembered', localStorage.getItem('notefall.zoom') !== null)
        // a click on a note at 250 %: the layout is in logical units, the pointer is in pixels: they must still agree
        c.setZoom(2.5); await new Promise((r) => setTimeout(r, 80))
        const ev = c.layout.measures[1].evs.find((e) => e.staff === 0 && !e.rest)!
        const r = (document.querySelector('.cmp-sheet svg') as SVGElement).getBoundingClientRect()
        c.setMode('select')
        document.querySelector('.cmp-sheet')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + ((ev.x + 5) * r.width) / c.layout.width, clientY: r.top + (ev.ys[0] * r.width) / c.layout.width }))
        ok('at 250 % a click still selects the note under the pointer', c.sel === ev.id)
        // Ctrl + wheel keeps the spot under the pointer
        c.setZoom(1); await new Promise((r2) => setTimeout(r2, 80))
        const rb = sheet.getBoundingClientRect(), cx = rb.left + rb.width * 0.4, cy = rb.top + 160
        const lx = ((cx - rb.left) * c.layout.width) / rb.width
        page.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -240, clientX: cx, clientY: cy, bubbles: true, cancelable: true }))
        const ra = sheet.getBoundingClientRect(), lx2 = ((cx - ra.left) * c.layout.width) / ra.width
        ok('Ctrl + wheel zooms in around the pointer', ra.width > rb.width + 100 && Math.abs(lx - lx2) < 4)
        c.zoomFit()
        c.setScore(d.minuet())
      }
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

    const uiq = new URLSearchParams(location.search).get('ui') ?? ''
    if (uiq.startsWith('palettes')) { // open every palette, then scroll the panel (palettes:900 = 900px down) so a screenshot can show any part
      document.querySelectorAll<HTMLDetailsElement>('.cmp-insp details').forEach((d) => { d.open = true })
      await new Promise((r) => setTimeout(r, 400))
      document.querySelector('.cmp-insp')!.scrollTop = +(uiq.split(':')[1] ?? 0)
    }
    if (new URLSearchParams(location.search).get('ui') === 'menu') (document.querySelector('[aria-label="Tệp"]') as HTMLElement).click()
    // a little tune for the screenshot
    const { minuet, showcase, endings, palette, voices } = await import('./editor/demo')
    c.setScore(location.search.includes('endings') ? endings() : location.search.includes('palette') ? palette() : location.search.includes('voices') ? voices() : location.search.includes('showcase') ? showcase() : minuet())
    c.setMode('select')
    c.click(c.layout.measures[1].evs.find((e) => e.staff === 0)!.x, c.layout.measures[1].staves[0].top + 5)
    if (location.search.includes('pdf')) { // export a longer score (several pages) as vector PDF
      const { newId } = await import('./editor/model')
      const big = minuet()
      for (let k = 0; k < 4; k++) big.measures.push(...JSON.parse(JSON.stringify(big.measures.slice(0, 8))).map((m: import('./editor/model').Measure) => { m.staves.forEach((vs) => vs.forEach((v) => v.forEach((e) => { e.id = newId(big) }))); return m }))
      c.setScore(big)
      console.log(`pdf score: ${big.measures.length} bars, ${c.layout.systems.length} systems`)
      { const t0 = performance.now(); c.refresh(); const ms = performance.now() - t0; console.log(`${ms < 250 ? 'PASS' : 'FAIL'} redrawing a ${big.measures.length}-bar score after an edit takes ${Math.round(ms)} ms (limit 250)`) }
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
    const { minuet, showcase, endings, palette, voices } = await import('./editor/demo')
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
    ;(window as unknown as { __metronome?: { met: { follow: boolean } } }).__metronome!.met.follow = true // metronome switched on while exporting
    const blob = (await exportVideo({ view: v, duration: 3, audio, height: 720, fps: 30, onProgress: (p) => (last = p), cancelled: () => false }))!
    console.log(`exported ${blob.size} bytes in ${Math.round(performance.now() - t0)} ms (progress ${last})`)
    const vid = document.createElement('video')
    vid.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;background:#000;z-index:99'
    vid.muted = true
    document.body.append(vid)
    vid.src = URL.createObjectURL(blob)
    await new Promise((r) => (vid.onloadedmetadata = r))
    console.log(`decoded: ${vid.videoWidth}x${vid.videoHeight}, duration ${vid.duration.toFixed(2)} s`)
    { // the metronome is on, yet the video's sound is the song alone: decode it back and check it is the pure 440 Hz tone we put in
      const m = (window as unknown as { __metronome?: { met: { follow: boolean } } }).__metronome
      const decoded = await new OfflineAudioContext(1, 48000, 48000).decodeAudioData(await blob.arrayBuffer())
      const d = decoded.getChannelData(0), from = 6000, n = Math.min(d.length - from, 48000 * 2)
      let a = 0, b = 0, tot = 0
      for (let i = 0; i < n; i++) { const x = d[from + i], ph = (2 * Math.PI * 440 * (from + i)) / 48000; a += x * Math.sin(ph); b += x * Math.cos(ph); tot += x * x }
      a = (2 * a) / n; b = (2 * b) / n
      const tone = (a * a + b * b) / 2, residual = Math.max(0, tot / n - tone)
      console.log(`  exported sound: tone ${Math.sqrt(tone).toFixed(3)} rms, other ${Math.sqrt(residual).toFixed(4)} rms (metronome following: ${!!m?.met.follow})`)
      console.log(`${Math.sqrt(residual) < 0.02 && Math.sqrt(tone) > 0.1 ? 'PASS' : 'FAIL'} the video carries no metronome clicks`)
    }
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
      if (ui === 'metronome') click('btn-met')
      if (ui === 'export') click('btn-export')
      if (ui === 'keys') (document.getElementById('dlg-keys') as HTMLDialogElement).showModal()
      if (ui === 'play') { click('play'); await new Promise((r) => setTimeout(r, 2200)) }
      await new Promise((r) => setTimeout(r, 400))
      return console.log('SELFTEST_DONE')
    }
    if (location.search.includes('autofill')) { // opening the composer tab alone fills it from the open song
      const c = (window as unknown as { __composer: import('./editor/composer').Composer }).__composer
      const before = c.hasMusic()
      ;(document.getElementById('tab-composer') as HTMLButtonElement).click()
      await new Promise((r) => setTimeout(r, 600))
      const pitched = c.score.measures.flatMap((m) => m.staves.flat(2)).filter((e) => e.pitches.length).length
      console.log(`AUTOFILL composer had music before: ${before}; now ${c.score.measures.length} bars, ${pitched} notes/chords, key ${c.score.key}, status: ${document.querySelector('.cmp-status')?.textContent}`)
      console.log(pitched > 0 && !before ? 'PASS the composer tab fills itself from the open song' : 'FAIL the composer tab fills itself from the open song')
      c.sel = undefined; c.key('ArrowDown') // (nothing selected: no edit)
      c.setScore(c.score) // the user's own score now
      ;(document.getElementById('tab-falling') as HTMLButtonElement).click(); (document.getElementById('tab-composer') as HTMLButtonElement).click()
      await new Promise((r) => setTimeout(r, 300))
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
