import { defineConfig } from 'vite'

export default defineConfig({ base: './', build: { outDir: 'dist', target: 'chrome120' }, test: { include: ['src/**/*.test.ts'] } })
