import { defineConfig, type Plugin } from 'vite'
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const walk = (dir: string, base = dir): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f), base) : [join(dir, f).slice(base.length + 1)]))

/** Web build only: an offline cache of every built file, so the page keeps working without a network once it has loaded. */
const offline = (): Plugin => ({
  name: 'offline-cache',
  apply: 'build',
  closeBundle() {
    const files = walk('dist').filter((f) => f !== 'sw.js')
    const version = Date.now().toString(36)
    writeFileSync('dist/sw.js', `const CACHE = 'notefall-${version}'
const FILES = ${JSON.stringify(['./', ...files])}
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())) })
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', (e) => { if (e.request.method === 'GET') e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))) })
`)
  },
})

export default defineConfig({ base: './', plugins: [offline()], build: { outDir: 'dist', target: ['chrome120', 'safari16'] }, test: { include: ['src/**/*.test.ts'] } })
