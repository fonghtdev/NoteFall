// Results cached in IndexedDB keyed by SHA-1 of the file, so reopening a song is instant.
const open = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('notefall', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('notes')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })

export async function fileKey(data: ArrayBuffer): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', data))
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function load<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open()
    return await new Promise((res) => {
      const r = db.transaction('notes').objectStore('notes').get(key)
      r.onsuccess = () => res(r.result)
      r.onerror = () => res(undefined)
    })
  } catch { return undefined }
}

export async function save(key: string, value: unknown): Promise<void> {
  try {
    const db = await open()
    db.transaction('notes', 'readwrite').objectStore('notes').put(value, key)
  } catch { /* cache is best-effort */ }
}
