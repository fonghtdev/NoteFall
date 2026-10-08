import { FADERS, MIX_CHANGED, levels, setLevel, type Fader } from '../core/mixer'

/** The mixer's sliders inside `panel` (a popover). Every copy of them, on either screen, stays in step. */
export function mountMixer(panel: HTMLElement) {
  const sec = document.createElement('section')
  sec.innerHTML = '<span class="label">Âm lượng</span>'
  const sliders = (Object.keys(FADERS) as Fader[]).map((f) => {
    const row = document.createElement('label'); row.className = 'row between'; row.textContent = FADERS[f]
    const r = document.createElement('input'); r.type = 'range'; r.min = '0'; r.max = '100'; r.style.width = '150px'; r.setAttribute('aria-label', `Âm lượng ${FADERS[f]}`)
    r.oninput = () => setLevel(f, +r.value / 100)
    row.append(r); sec.append(row)
    return [f, r] as const
  })
  const paint = () => { for (const [f, r] of sliders) { r.value = String(Math.round(levels[f] * 100)); r.style.setProperty('--fill', `${r.value}%`) } }
  window.addEventListener(MIX_CHANGED, paint)
  paint()
  panel.append(sec)
}
