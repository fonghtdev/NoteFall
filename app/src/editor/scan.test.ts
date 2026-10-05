// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scanPdf } from './scan'

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
