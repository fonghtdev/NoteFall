// A tiny but valid SoundFont for the tests (nothing in the app uses this file).
/** A tiny but valid SoundFont built here: one preset, one instrument with a looping sine (441 Hz at key 60, 44100 Hz sample rate). */
export function tinySf2(opts: { attack?: number; cutoff?: number } = {}): ArrayBuffer {
  const bytes: number[] = []
  const u16 = (n: number) => [n & 255, (n >> 8) & 255], u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]
  const name = (s: string, n = 20) => Array.from({ length: n }, (_, i) => s.charCodeAt(i) || 0)
  const id = (s: string) => Array.from(s, (c) => c.charCodeAt(0))
  const chunk = (tag: string, data: number[]) => [...id(tag), ...u32(data.length), ...data, ...(data.length & 1 ? [0] : [])]
  const list = (tag: string, parts: number[][]) => chunk('LIST', [...id(tag), ...parts.flat()])
  const frames = 400
  const smpl: number[] = []
  for (let i = 0; i < frames + 46; i++) { const x = i < frames ? Math.round(Math.sin((2 * Math.PI * i) / 100) * 20000) : 0; smpl.push(...u16(x & 0xffff)) }
  const gen = (op: number, amt: number) => [...u16(op), ...u16(amt & 0xffff)]
  const igen = [...gen(43, 127 << 8), ...(opts.attack === undefined ? [] : gen(34, opts.attack)), ...(opts.cutoff === undefined ? [] : gen(8, opts.cutoff)), ...gen(54, 1), ...gen(58, 60), ...gen(53, 0), ...gen(0, 0)]
  const phdr = [...name('Piano'), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...u32(0), ...name('EOP'), ...u16(255), ...u16(255), ...u16(1), ...u32(0), ...u32(0), ...u32(0)]
  const inst = [...name('Sine'), ...u16(0), ...name('EOI'), ...u16(1)]
  const shdr = [...name('sine'), ...u32(0), ...u32(frames - 1), ...u32(0), ...u32(frames - 1), ...u32(44100), 60, 0, ...u16(0), ...u16(1), ...name('EOS'), ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0), 0, 0, ...u16(0), ...u16(0)]
  bytes.push(...list('INFO', [chunk('ifil', [...u16(2), ...u16(1)]), chunk('INAM', name('Tiny test', 10))]))
  bytes.push(...list('sdta', [chunk('smpl', smpl)]))
  bytes.push(...list('pdta', [
    chunk('phdr', phdr), chunk('pbag', [...u16(0), ...u16(0), ...u16(1), ...u16(0)]), chunk('pmod', new Array(10).fill(0)), chunk('pgen', [...gen(41, 0), ...gen(0, 0)]),
    chunk('inst', inst), chunk('ibag', [...u16(0), ...u16(0), ...u16(igen.length / 4 - 1), ...u16(0)]), chunk('imod', new Array(10).fill(0)), chunk('igen', igen), chunk('shdr', shdr),
  ]))
  const body = [...id('sfbk'), ...bytes]
  return new Uint8Array([...id('RIFF'), ...u32(body.length), ...body]).buffer
}

