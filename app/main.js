const { app, BrowserWindow, protocol, net, ipcMain, session, Menu } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')
const fs = require('fs')

// Serve dist/ over app:// so fetch() (model.json) and IndexedDB work; file:// blocks both.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

// headless self-test has no GPU: let Chromium fall back to software WebGL
if (process.env.NOTEFALL_SELFTEST) app.commandLine.appendSwitch('enable-unsafe-swiftshader')

// NOTEFALL_FRESH: throw-away profile, so no cached notes can hide a pipeline change
if (process.env.NOTEFALL_FRESH) app.setPath('userData', require('os').tmpdir() + '/notefall-fresh-' + Date.now())

// Print the window that asked: it already has the music font loaded, a separate window would not.
ipcMain.handle('print-pdf', (e) => e.sender.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true }))

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.bin': 'application/octet-stream',
}

app.whenReady().then(() => {
  if (process.env.NOTEFALL_DL) { // self-test: save downloads to a known folder instead of asking
    session.defaultSession.on('will-download', (_e, item) => item.setSavePath(path.join(process.env.NOTEFALL_DL, item.getFilename())))
  }
  protocol.handle('app', (req) => {
    const pathname = decodeURIComponent(new URL(req.url).pathname)
    // test hook: lets the headless self-test feed a real file to the renderer
    if (pathname === '/__file' && process.env.NOTEFALL_FILE) return net.fetch(pathToFileURL(process.env.NOTEFALL_FILE).toString())
    const p = path.join(__dirname, 'dist', pathname)
    // Say the type ourselves: on Windows net.fetch(file://) asks the registry, which often calls .js/.mjs "text/plain" and the page's scripts and PDF worker then refuse to load
    return net.fetch(pathToFileURL(p).toString()).then((r) => {
      const type = MIME[path.extname(p).toLowerCase()]
      if (!type) return r
      const h = new Headers(r.headers); h.set('content-type', type)
      return new Response(r.body, { status: r.status, headers: h })
    })
  })
  const selftest = !!process.env.NOTEFALL_SELFTEST
  const win = new BrowserWindow({
    width: +(process.env.NOTEFALL_SIZE || '1280x780').split('x')[0], height: +(process.env.NOTEFALL_SIZE || '1280x780').split('x')[1], minWidth: 960, minHeight: 600, show: !(selftest || process.env.NOTEFALL_JS), backgroundColor: '#080a1c',
    webPreferences: { autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false, preload: path.join(__dirname, 'preload.cjs') },
  })
  win.setMenuBarVisibility(false)
  // The default menu has its own zoom (the whole window) and undo / select-all that never reach the page as key presses.
  // Windows and Linux need no menu at all; macOS gets a small one whose commands go to the page.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  else {
    const send = (cmd) => () => win.webContents.send('menu-cmd', cmd)
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { label: 'Chỉnh sửa', submenu: [
        { label: 'Hoàn tác', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Làm lại', accelerator: 'Shift+CmdOrCtrl+Z', click: send('redo') },
        { type: 'separator' }, { role: 'cut', label: 'Cắt' }, { role: 'copy', label: 'Sao chép' }, { role: 'paste', label: 'Dán' },
        { label: 'Chọn tất cả', accelerator: 'CmdOrCtrl+A', click: send('select-all') },
      ] },
      { label: 'Xem', submenu: [
        { label: 'Phóng to trang nhạc', accelerator: 'CmdOrCtrl+Plus', click: send('zoom-in') },
        { label: 'Thu nhỏ trang nhạc', accelerator: 'CmdOrCtrl+-', click: send('zoom-out') },
        { label: 'Vừa khung', accelerator: 'CmdOrCtrl+0', click: send('zoom-fit') },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ] },
      { role: 'windowMenu' },
    ]))
  }
  win.loadURL('app://notefall/index.html' + (selftest ? '?selftest' + (process.env.NOTEFALL_FILE ? '&file&name=' + encodeURIComponent(path.basename(process.env.NOTEFALL_FILE)) : '') + (process.env.NOTEFALL_VF ? '&vf' : '') + (process.env.NOTEFALL_EDIT ? '&edit' : '') + (process.env.NOTEFALL_AUTOFILL ? '&autofill' : '') + (process.env.NOTEFALL_SEEK ? '&seek=' + process.env.NOTEFALL_SEEK : '') + (process.env.NOTEFALL_UI ? '&ui=' + process.env.NOTEFALL_UI : '') + (process.env.NOTEFALL_PERSIST ? '&persist' : '') + (process.env.NOTEFALL_SHELL ? '&shell' : '') + (process.env.NOTEFALL_COMPOSE ? '&compose' + (process.env.NOTEFALL_COMPOSE === 'falling' ? '&falling' : process.env.NOTEFALL_COMPOSE === 'pdf' ? '&pdf' : process.env.NOTEFALL_COMPOSE === 'showcase' ? '&showcase' : process.env.NOTEFALL_COMPOSE === 'palette' ? '&palette' : process.env.NOTEFALL_COMPOSE === 'voices' ? '&voices' : '') : '') + (process.env.NOTEFALL_EDITOR ? '&editor' + (process.env.NOTEFALL_EDITOR === 'showcase' ? '&showcase' : process.env.NOTEFALL_EDITOR === 'endings' ? '&endings' : '') : '') + (process.env.NOTEFALL_LEAD ? '&lead' : '') + (process.env.NOTEFALL_TX ? '&tx' : '') + (process.env.NOTEFALL_SYNTH ? '&synth' : '') + (process.env.NOTEFALL_EXPORT ? '&export' : '') + (process.env.NOTEFALL_THEME ? '&theme=' + process.env.NOTEFALL_THEME : '') : ''))
  if (process.env.NOTEFALL_JS) { // developer hook: run a script file in the page once it has loaded and print what it returns
    win.webContents.once('did-finish-load', () => setTimeout(async () => { try {
      if (process.env.NOTEFALL_TOUCH) { // behave like a touch screen from the start (the layout changes: coarse pointer, touch-only buttons)
        win.webContents.debugger.attach('1.3')
        await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
        await new Promise((res) => setTimeout(res, 500))
      }
      const r = await win.webContents.executeJavaScript(fs.readFileSync(process.env.NOTEFALL_JS, 'utf8'))
      console.log('JS_RESULT ' + JSON.stringify(r))
      // real mouse input (the whole path: hit-testing, default actions, event order): the script may return { input: [{type, x, y, button?, modifiers?}] }
      const input = typeof r === 'string' ? (() => { try { return JSON.parse(r).input } catch { return undefined } })() : r?.input
      const touch = typeof r === 'string' ? (() => { try { return JSON.parse(r).touch } catch { return undefined } })() : r?.touch
      if (Array.isArray(touch)) { // a finger: Chrome DevTools protocol touch events ({type:'touchStart'|'touchMove'|'touchEnd', points:[{x,y}]})
        const dbg = win.webContents.debugger
        if (!dbg.isAttached()) { dbg.attach('1.3'); await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }) }
        for (const ev of touch) { await dbg.sendCommand('Input.dispatchTouchEvent', { type: ev.type, touchPoints: (ev.points ?? []).map((p, i) => ({ x: p.x, y: p.y, id: i })) }); await new Promise((res) => setTimeout(res, ev.wait ?? 25)) }
        await new Promise((res) => setTimeout(res, 300))
        if (process.env.NOTEFALL_JS2) console.log('JS2_RESULT ' + JSON.stringify(await win.webContents.executeJavaScript(fs.readFileSync(process.env.NOTEFALL_JS2, 'utf8'))))
      }
      if (Array.isArray(input)) {
        for (const ev of input) { win.webContents.sendInputEvent({ button: 'left', clickCount: 1, ...ev }); await new Promise((res) => setTimeout(res, ev.wait ?? 25)) }
        await new Promise((res) => setTimeout(res, 300))
        if (process.env.NOTEFALL_JS2) console.log('JS2_RESULT ' + JSON.stringify(await win.webContents.executeJavaScript(fs.readFileSync(process.env.NOTEFALL_JS2, 'utf8'))))
      }
    } catch (e) { console.log('JS_ERROR ' + e) } if (!process.env.NOTEFALL_KEEP) { const img = await win.webContents.capturePage(); fs.writeFileSync(process.env.NOTEFALL_SHOT || 'shot.png', img.toPNG()); app.quit() } }, 1500))
  }
  if (selftest) {
    win.webContents.on('console-message', async (_e, _l, msg) => {
      console.log(msg)
      if (msg === 'SELFTEST_DONE') {
        const img = await win.webContents.capturePage()
        fs.writeFileSync(process.env.NOTEFALL_SHOT || 'shot.png', img.toPNG())
        app.quit()
      }
    })
    setTimeout(() => { console.log('SELFTEST_TIMEOUT'); app.exit(1) }, 600000)
  }
})
app.on('window-all-closed', () => app.quit())
