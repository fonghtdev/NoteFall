import { describe, expect, it } from 'vitest'
import { handleStaleChunk } from './stale'

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }
describe('stale chunk after a rebuild', () => {
  it('reloads once, then stops and says what to do', () => {
    const st = mem(); const said: string[] = []; let reloads = 0
    const run = (now: number) => handleStaleChunk({ say: (t) => said.push(t), reload: () => { reloads++ }, storage: st, now })
    expect(run(100000)).toBe(true); expect(reloads).toBe(1)
    expect(run(103000)).toBe(false); expect(reloads).toBe(1)          // the new page failed too: no reload loop
    expect(said[1]).toContain('đóng và mở lại')
    expect(run(130000)).toBe(true); expect(reloads).toBe(2)           // much later, a fresh rebuild: reload again
  })
})
