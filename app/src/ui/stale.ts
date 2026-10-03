/**
 * A window that was opened before the app was rebuilt asks for chunks (pdf, model…) whose file names have since changed.
 * Vite reports that as `vite:preloadError`: say so and reload once, instead of leaving a cryptic "Failed to fetch dynamically imported module".
 */
export function handleStaleChunk(o: { say: (t: string) => void; reload: () => void; storage: Pick<Storage, 'getItem' | 'setItem'>; now: number }): boolean {
  let last = 0
  try { last = Number(o.storage.getItem('notefall.reloaded') ?? 0) } catch { /* no storage: reload anyway, once per page load below */ }
  if (o.now - last < 15000) { o.say('Không tải được một phần của app. Hãy đóng và mở lại NoteFall.'); return false } // already reloaded a moment ago: do not loop
  try { o.storage.setItem('notefall.reloaded', String(o.now)) } catch { /* ignore */ }
  o.say('App vừa được cập nhật: đang tải lại… (hãy thử lại thao tác vừa rồi)')
  o.reload()
  return true
}

/** Only a file that could not be fetched means "the app changed under this window"; any other error that passes through a lazily loaded module is just an error. */
export const isMissingChunk = (message: string) => /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Load failed/i.test(message)
