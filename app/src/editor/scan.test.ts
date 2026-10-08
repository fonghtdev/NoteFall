// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { carryTime, scanPdf } from './scan'

// The desktop app's door to Audiveris (omr.cjs), replaced by a fake that takes as long as the test wants.
function fakeOmr(run: () => Promise<string[]>, installed = true) {
  const cancel = vi.fn()
  const omr = { status: async () => ({ supported: true, installed }), install: vi.fn(), run, cancel, onProgress: () => () => {} }
  ;(window as unknown as { notefall: unknown }).notefall = { omr }
  return omr
}
const file = new File([new Uint8Array(4)], 'scan.pdf')
afterEach(() => { delete (window as unknown as { notefall?: unknown }).notefall; document.body.innerHTML = '' })

describe('reading a scan', () => {
  it('does nothing where the desktop app is not there (web, tablet)', async () => {
    expect(await scanPdf(file, 3)).toBeUndefined()
  })
  it('shows a panel with a Cancel button while it reads, and takes it away when it is over', async () => {
    let end!: (e: Error) => void
    const omr = fakeOmr(() => new Promise((_, no) => { end = no }))
    const reading = scanPdf(file, 3)
    await vi.waitFor(() => expect(document.querySelector('.scanbar')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('.scanbar button')!.click()
    expect(omr.cancel).toHaveBeenCalled()
    end(new Error("Error invoking remote method 'omr-run': Error: đã huỷ nhận dạng"))
    await expect(reading).rejects.toThrow(/^đã huỷ nhận dạng$/)
    expect(document.querySelector('.scanbar')).toBeNull()
  })
  it('asks before the one-time download, and stops when the answer is no', async () => {
    const omr = fakeOmr(async () => [], false)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    expect(await scanPdf(file, 3)).toBeUndefined()
    expect(omr.install).not.toHaveBeenCalled()
    expect(document.querySelector('.scanbar')).toBeNull()
  })
})

describe('pages read side by side', () => {
  const part = (attrs: string) => `<score-partwise><part id="P1"><measure number="1"><attributes><divisions>4</divisions>${attrs}<clef><sign>G</sign></clef></attributes></measure></part></score-partwise>`
  it('a part with no time signature takes the last one of the part before it, after its key; one with its own keeps it', () => {
    const first = part('<key><fifths>-3</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time>')
    const [a, b, c, d] = carryTime([first, part('<key><fifths>-3</fifths></key>'), part(''), part('<time><beats>6</beats><beat-type>8</beat-type></time>')])
    expect(a).toBe(first)
    expect(b).toContain('<key><fifths>-3</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><clef>')
    expect(c).toContain('<divisions>4</divisions><time><beats>3</beats>')
    expect(d).toContain('<beats>6</beats>'); expect(d).not.toContain('<beats>3</beats>')
  })
  it('the parts make one score, in page order, with the carried time signature', async () => {
    const bar = (n: number, step: string, time = '') => `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1"><measure number="${n}"><attributes><divisions>1</divisions><key><fifths>0</fifths></key>${time}<clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>${step}</step><octave>5</octave></pitch><duration>3</duration><type>half</type><dot/></note></measure></part></score-partwise>`
    fakeOmr(async () => [bar(1, 'C', '<time><beats>3</beats><beat-type>4</beat-type></time>'), bar(1, 'D')])
    const r = await scanPdf(file, 2)
    expect(r!.score.measures.map((m) => m.staves[0][0][0].pitches[0].step)).toEqual(['C', 'D'])
    expect(r!.score.measures.map((m) => m.time?.beats ?? r!.score.time.beats)).toEqual([3, 3])
  })
})

