/**
 * Saving a file: on a computer the browser downloads it; on a touch screen (iPad) a download from a web view goes nowhere,
 * so the share sheet is offered ("Save to Files", AirDrop, Mail…). Sharing needs a fresh tap, and making a video or PDF takes
 * longer than that, so when the file is ready a button waits for the tap.
 */
export const isTouchDevice = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

const anchor = (name: string, blob: Blob) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 60000)
}

export function saveFile(name: string, data: BlobPart, type: string) {
  const blob = new Blob([data], { type })
  const file = typeof File === 'function' ? new File([blob], name, { type }) : undefined
  if (isTouchDevice() && file && navigator.canShare?.({ files: [file] })) offerShare(name, file)
  else anchor(name, blob)
}

/** A button at the bottom of the screen: tap to open the share sheet for `file`. */
export function offerShare(name: string, file: File) {
  document.getElementById('share-offer')?.remove()
  const box = document.createElement('div')
  box.id = 'share-offer'; box.setAttribute('role', 'status')
  const go = document.createElement('button'); go.className = 'btn primary'; go.textContent = `Lưu “${name}”`
  const close = document.createElement('button'); close.className = 'btn ghost icon'; close.textContent = '✕'; close.setAttribute('aria-label', 'Đóng')
  go.onclick = async () => { try { await navigator.share({ files: [file], title: name }); box.remove() } catch (e) { if ((e as Error).name !== 'AbortError') anchor(name, file) } }
  close.onclick = () => box.remove()
  box.append(go, close)
  document.body.append(box)
  setTimeout(() => box.remove(), 120000)
}
