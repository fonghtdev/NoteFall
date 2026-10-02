/**
 * A button that opens a floating panel. Closes on Escape (focus returns to the button), on a click outside,
 * and exposes aria-expanded. Panels with class "menu" also move focus with ↑/↓.
 */
export function popover(trigger: HTMLElement, panel: HTMLElement) {
  let closing = 0
  const set = (open: boolean) => {
    clearTimeout(closing)
    delete panel.dataset.closing
    if (open || panel.hidden) panel.hidden = !open
    else { // let the exit animation play, then really hide
      panel.dataset.closing = ''
      closing = window.setTimeout(() => { panel.hidden = true; delete panel.dataset.closing }, 110)
    }
    trigger.setAttribute('aria-expanded', String(open))
    if (open) (panel.querySelector<HTMLElement>('button, input, select') ?? panel).focus({ preventScroll: true })
  }
  trigger.setAttribute('aria-haspopup', panel.classList.contains('menu') ? 'menu' : 'dialog')
  trigger.setAttribute('aria-expanded', 'false')
  panel.hidden = true
  trigger.addEventListener('click', (e) => { e.stopPropagation(); set(!!panel.hidden || 'closing' in panel.dataset) })
  document.addEventListener('mousedown', (e) => {
    const t = e.target as Node
    if (!panel.hidden && !('closing' in panel.dataset) && !panel.contains(t) && !trigger.contains(t)) set(false)
  })
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); set(false); trigger.focus() }
    if (panel.classList.contains('menu') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const items = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled)')]
      const i = items.indexOf(document.activeElement as HTMLElement)
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
      e.preventDefault()
    }
  })
  // choosing a menu item closes the menu
  if (panel.classList.contains('menu')) panel.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button')) set(false) })
  return { open: () => set(true), close: () => set(false) }
}
