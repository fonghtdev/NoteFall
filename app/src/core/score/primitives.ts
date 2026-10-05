import { smuflOfName } from './glyphNames'

// Turns a pdf.js page into plain geometry: glyphs (music-font characters), stroked line segments, filled polygons.
// All coordinates are PDF user space (origin bottom-left, y up).

export interface Glyph { font: string; code: number; x: number; y: number; size: number; w: number } // code = unicode, e.g. 0xF0CF
export interface Seg { x1: number; y1: number; x2: number; y2: number; w: number }
export interface Poly { pts: [number, number][] }
export interface Curve { x0: number; y0: number; x1: number; y1: number } // bounding box of a curved path (tie/slur/brace)
export interface PagePrims { width: number; height: number; glyphs: Glyph[]; segs: Seg[]; polys: Poly[]; curves: Curve[] }

type M = [number, number, number, number, number, number]
const I: M = [1, 0, 0, 1, 0, 0]
const compose = (o: M, i: M): M => [
  o[0] * i[0] + o[2] * i[1], o[1] * i[0] + o[3] * i[1],
  o[0] * i[2] + o[2] * i[3], o[1] * i[2] + o[3] * i[3],
  o[0] * i[4] + o[2] * i[5] + o[4], o[1] * i[4] + o[3] * i[5] + o[5],
]
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

type FontNames = Record<string, { name: string; diffs: Record<number, string> }>
async function fontNames(page: any, ol: any, OPS: Record<string, number>): Promise<FontNames> {
  const out: FontNames = {}
  const used = new Set<string>(ol.fnArray.flatMap((op: number, i: number) => (op === OPS.setFont ? [ol.argsArray[i][0] as string] : [])))
  for (const id of used) {
    const f: any = await Promise.race([new Promise((res) => page.commonObjs?.get(id, res)), new Promise((res) => setTimeout(res, 1500))]) // (a font that never loads must not hold the page up)
    if (f?.differences && Object.keys(f.differences).length) out[id] = { name: f.name ?? '', diffs: f.differences }
  }
  return out
}

/** `OPS` is pdf.js's operator table (passed in so this file works with both the browser and Node builds). */
export async function extractPrims(page: any, OPS: Record<string, number>): Promise<PagePrims> {
  const [x0, y0, x1, y1] = page.view as number[]
  const ol = await page.getOperatorList()
  const fonts = await fontNames(page, ol, OPS) // glyph names per font, to read music fonts whose character codes differ from file to file
  const out: PagePrims = { width: x1 - x0, height: y1 - y0, glyphs: [], segs: [], polys: [], curves: [] }

  let ctm = I, stack: M[] = [], tm = I, lx = 0, ly = 0, font = '', fontSize = 1, lineW = 1, charSp = 0, leading = 0 // (lx, ly): where the text line has been moved to (Td) since the last text matrix
  for (let i = 0; i < ol.fnArray.length; i++) {
    const op = ol.fnArray[i], a = ol.argsArray[i]
    if (op === OPS.save) stack.push(ctm)
    else if (op === OPS.restore) ctm = stack.pop() ?? I
    else if (op === OPS.transform) ctm = compose(ctm, Array.from(typeof a[0] === 'number' ? a : a[0]) as M)
    else if (op === OPS.setLineWidth) lineW = a[0]
    else if (op === OPS.setCharSpacing) charSp = a[0]
    else if (op === OPS.beginText) { tm = I; lx = ly = 0 }
    else if (op === OPS.moveText) { lx += a[0]; ly += a[1] } // MuseScore 4 places every symbol with Td
    else if (op === OPS.setLeading) leading = a[0] // LilyPond stacks the notes of a chord with a line feed (T*) of this height
    else if (op === OPS.nextLine) ly -= leading
    else if (op === OPS.setFont) { font = a[0]; fontSize = typeof a[1] === 'number' && a[1] ? a[1] : 1 } // some writers keep the size here, others fold it into the text matrix
    else if (op === OPS.setTextMatrix) { tm = Array.from(typeof a[0] === 'number' ? a : a[0]) as M; lx = ly = 0 } // some pdf.js builds nest the matrix
    else if (op === OPS.showText) {
      let adv = 0 // advance in text space
      for (const g of a[0] as any[]) {
        const w = ((g.width ?? 0) / 1000) * fontSize
        if (g.unicode && !g.isSpace) {
          const [x, y] = apply(ctm, ...apply(tm, lx + adv, ly))
          const named = fonts[font] && smuflOfName(fonts[font].diffs[g.originalCharCode], fonts[font].name)
          out.glyphs.push({ font, code: named ?? g.unicode.codePointAt(0)!, x, y, size: Math.abs(fontSize * tm[0] * ctm[0]), w: w * Math.abs(tm[0] * ctm[0]) })
        }
        adv += w + charSp
      }
    } else if (op === OPS.constructPath) {
      const paint = a[0] as number, d = a[1][0] as ArrayLike<number>
      // pdf.js packs the path as a flat array: 0 x y = moveTo, 1 x y = lineTo, 2 x1 y1 x2 y2 x3 y3 = curveTo, 4 = close
      const subs: [number, number][][] = []
      let cur: [number, number][] = []
      let box: Curve | undefined
      const grow = (p: [number, number]) => { box = box ? { x0: Math.min(box.x0, p[0]), y0: Math.min(box.y0, p[1]), x1: Math.max(box.x1, p[0]), y1: Math.max(box.y1, p[1]) } : { x0: p[0], y0: p[1], x1: p[0], y1: p[1] } }
      for (let k = 0; k < d.length;) {
        const c = d[k]
        if (c === 0) { if (cur.length) subs.push(cur); cur = [apply(ctm, d[k + 1], d[k + 2])]; k += 3 }
        else if (c === 1) { cur.push(apply(ctm, d[k + 1], d[k + 2])); k += 3 }
        else if (c === 2) { for (const o of [1, 3, 5]) grow(apply(ctm, d[k + o], d[k + o + 1])); cur.push(apply(ctm, d[k + 5], d[k + 6])); k += 7 } // curve: polygon keeps the end point, the box keeps the control points
        else if (c === 4) { if (cur.length) cur.push(cur[0]); k += 1 }
        else k += 1
      }
      if (cur.length) subs.push(cur)
      if (box && (paint === OPS.stroke || paint === OPS.fill || paint === OPS.eoFill || paint === OPS.fillStroke || paint === OPS.closeStroke)) out.curves.push(box)
      const stroke = paint === OPS.stroke || paint === OPS.closeStroke || paint === OPS.fillStroke
      const fill = paint === OPS.fill || paint === OPS.eoFill || paint === OPS.fillStroke
      const scale = Math.hypot(ctm[0], ctm[1])
      for (const s of subs) {
        if (stroke) for (let k = 0; k + 1 < s.length; k++) out.segs.push({ x1: s[k][0], y1: s[k][1], x2: s[k + 1][0], y2: s[k + 1][1], w: lineW * scale })
        if (fill && s.length >= 3) out.polys.push({ pts: s })
      }
    }
  }
  return out
}
