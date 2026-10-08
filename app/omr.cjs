// Scanned sheet music: runs Audiveris (free, open-source optical music recognition) on the user's machine.
// The program is not shipped inside NoteFall (160 MB a platform): the first scan downloads it once into the app's data folder.
const { app, ipcMain, net, powerSaveBlocker } = require('electron')
const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const VERSION = '5.11.0'
const ASSET = process.platform === 'darwin' ? `Audiveris-${VERSION}-macosx-${process.arch === 'arm64' ? 'arm64' : 'x86_64'}.dmg`
  : process.platform === 'win32' ? `Audiveris-${VERSION}-windows-x86_64.msi` : null
const home = () => path.join(app.getPath('userData'), `audiveris-${VERSION}`)

const find = (dir, name, depth = 5) => { // first file called `name` under dir
  if (depth < 0 || !fs.existsSync(dir)) return null
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isFile() && e.name === name) return p
    if (e.isDirectory()) { const r = find(p, name, depth - 1); if (r) return r }
  }
  return null
}
const exe = () => process.platform === 'darwin' ? path.join(home(), 'Audiveris.app/Contents/MacOS/Audiveris') : find(home(), 'Audiveris.exe')
const installed = () => { const p = exe(); return !!p && fs.existsSync(p) }

async function download(url, to, onRatio) {
  const res = await net.fetch(url)
  if (!res.ok) throw new Error(`không tải được (${res.status})`)
  const total = +res.headers.get('content-length') || 0
  const out = fs.createWriteStream(to)
  let got = 0
  for await (const chunk of res.body) { out.write(chunk); got += chunk.length; if (total) onRatio(got / total) }
  await new Promise((ok) => out.end(ok))
}

function unpack(file) {
  const dest = home()
  fs.mkdirSync(dest, { recursive: true })
  if (process.platform === 'darwin') {
    const mnt = fs.mkdtempSync(path.join(os.tmpdir(), 'audiveris-mnt-'))
    // the disk image shows its licence (AGPL: using the program needs no acceptance) and waits for a key
    const att = spawnSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mnt, file], { input: 'Y\n'.repeat(4) })
    if (att.status !== 0) throw new Error(`không mở được file cài của Audiveris (${String(att.stderr || att.error).trim().slice(0, 200)})`)
    try { spawnSync('ditto', [path.join(mnt, 'Audiveris.app'), path.join(dest, 'Audiveris.app')]) } finally { spawnSync('hdiutil', ['detach', mnt, '-quiet']) }
    spawnSync('xattr', ['-cr', path.join(dest, 'Audiveris.app')])
  } else {
    // an administrative install unpacks the files without installing anything on the system
    const r = spawnSync('msiexec', ['/a', file, '/qn', `TARGETDIR=${dest}`])
    if (r.status !== 0) throw new Error('không giải nén được file cài của Audiveris')
  }
  if (!installed()) throw new Error('Audiveris đã tải nhưng không tìm thấy chương trình bên trong')
}

let running, installing, cancelled = false // running: the Audiveris processes of the recognition under way
const kill = () => running?.forEach((p) => p.kill())

/** How many Audiveris processes to run side by side: at most 4, no more than half the cores, and one per 4 GB of memory (each can grow to a few GB). */
const workerCount = (pages) => Math.max(1, Math.min(pages, 4, Math.floor(os.cpus().length / 2), Math.floor(os.totalmem() / 4e9)))
/** Pages 1..n shared out into `k` runs of pages that follow each other, as even as can be: 18 pages, 4 runs -> 5, 5, 4, 4. */
const shareOut = (n, k) => Array.from({ length: k }, (_, i) => { const a = Math.floor((i * n) / k), b = Math.floor(((i + 1) * n) / k); return Array.from({ length: b - a }, (_, j) => a + j + 1) }).filter((r) => r.length)
function register() {
  ipcMain.handle('omr-status', () => ({ supported: !!ASSET, installed: !!ASSET && installed() }))

  // two windows asking at once share one download
  ipcMain.handle('omr-install', (e) => installing ??= (async () => {
    if (!ASSET) throw new Error('hệ điều hành này chưa được hỗ trợ')
    const file = path.join(os.tmpdir(), ASSET)
    try {
      await download(`https://github.com/Audiveris/audiveris/releases/download/${VERSION}/${ASSET}`, file, (ratio) => e.sender.send('omr-progress', { phase: 'download', ratio }))
      e.sender.send('omr-progress', { phase: 'unpack', ratio: 1 })
      unpack(file)
    } finally { fs.rmSync(file, { force: true }); installing = undefined }
  })())

  // data: the PDF's bytes; pages: how many it has. Resolves with one MusicXML text per movement found, in page order.
  // The pages are shared out between a few Audiveris processes that run side by side (one reads its pages one after the other): an 18-page scan takes a
  // fraction of the time on a machine with cores and memory to spare. Each process gets a run of pages that follow each other.
  ipcMain.handle('omr-run', (e, data, pages) => new Promise((resolve, reject) => {
    if (running) return reject(new Error('đang nhận dạng một file khác'))
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notefall-omr-'))
    const pdf = path.join(dir, 'score.pdf')
    fs.writeFileSync(pdf, Buffer.from(data))
    const keepAwake = powerSaveBlocker.start('prevent-app-suspension') // a window that is hidden or behind others must not slow the reading down
    const done = (err, val) => { running = undefined; powerSaveBlocker.stop(keepAwake); fs.rmSync(dir, { recursive: true, force: true }); err ? reject(err) : resolve(val) }
    const runs = shareOut(Math.max(1, pages), workerCount(pages))
    const steps = runs.map(() => 0), read = runs.map(() => 0), codes = []
    const report = () => { // every page goes through 20 steps (LOAD … PAGE) that the log announces: "StepMonitoring 98 | HEADS"
      const all = steps.reduce((a, b) => a + b, 0), pagesDone = read.reduce((a, b) => a + b, 0)
      e.sender.send('omr-progress', { phase: 'read', page: Math.min(pages, pagesDone + 1), ratio: pages ? Math.min(1, all / (pages * 20)) : 0 })
    }
    running = runs.map((sheets, k) => {
      const out = path.join(dir, `part${k}`)
      const p = spawn(exe(), ['-batch', '-transcribe', '-export', '-output', out, '-sheets', ...sheets.map(String), '-option', 'org.audiveris.omr.sheet.BookManager.useCompression=false', pdf])
      const watch = (b) => { const text = b.toString(), n = (text.match(/StepMonitoring/g) || []).length; if (n) { steps[k] += n; read[k] += (text.match(/\| PAGE\b/g) || []).length; report() } }
      p.stdout.on('data', watch); p.stderr.on('data', watch)
      p.on('error', (err) => { kill(); done(err) })
      p.on('close', (code, signal) => {
        codes[k] = signal ? -1 : code
        if (codes.filter((c) => c !== undefined).length < runs.length) return
        if (cancelled || codes.includes(-1)) return done(new Error('đã huỷ nhận dạng'))
        const xml = runs.flatMap((_, j) => { const d = path.join(dir, `part${j}`); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /\.xml$/.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((f) => fs.readFileSync(path.join(d, f), 'utf8')) : [] })
        if (!xml.length) return done(new Error('Audiveris không nhận dạng được nốt nào trong file này'))
        done(null, xml)
      })
      return p
    })
    cancelled = false
  }))

  ipcMain.handle('omr-cancel', () => { cancelled = true; kill() })
}

module.exports = { register, shareOut }
