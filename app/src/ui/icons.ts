// One small set of line icons (24×24, 1.75 stroke). Used as <span data-icon="name"> in the HTML and via icon() in code.
const P = {
  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4.5" width="4.2" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1" fill="currentColor" stroke="none"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h9A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  cursor: '<path d="M6 3.5l12 7.2-5.2 1.3 3 5.6-2.4 1.3-3-5.6L6 16.8z" stroke-linejoin="round"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  download: '<path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 20h14"/>',
  piano: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M9 19v-5M15 19v-5"/><path d="M7.5 5h2.6v9H7.5zM13.9 5h2.6v9h-2.6z" fill="currentColor" stroke="none"/>', // a few keys of a keyboard: the piano sound
  score: '<path d="M6 3h12v18H6z" stroke-linejoin="round"/><path d="M8.5 8h7M8.5 11h7M8.5 14h7" stroke-width="1.1"/><path d="M13.5 17.5V9.5"/><ellipse cx="12" cy="17.6" rx="1.6" ry="1.2" fill="currentColor" stroke="none"/>', // a page of music: the composer
  pencil: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14 7l3 3"/>',
  bars: '<path d="M6 4v7M12 4v12M18 4v5" stroke-width="2.6"/><path d="M4 20h16" opacity=".5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1.1 1-1.1 1.7M12 17h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
  tie: '<path d="M4 9c2.5 6.5 13.5 6.5 16 0"/>',
  metronome: '<path d="M8.5 21 10.5 4h3l2 17z"/><path d="M12 16.5 16.5 7"/><circle cx="16.5" cy="7" r="1.2" fill="currentColor"/><path d="M6.5 21h11"/>',
  arrowup: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowdown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5"/>',
  wand: '<path d="M5 19 16 8"/><path d="m14.5 6.5 3 3"/><path d="M19 3v3M17.5 4.5h3M6 5v2M5 6h2"/>',
} as const

export type IconName = keyof typeof P
export const icon = (name: IconName, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${P[name]}</svg>`

/** Replace every <span data-icon="…"> in the page with its SVG. */
export function paintIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon as IconName) })
}
