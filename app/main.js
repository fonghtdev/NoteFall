const { app, BrowserWindow, protocol, net, ipcMain, session } = require('electron')
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

app.whenReady().then(() => {
  if (process.env.NOTEFALL_DL) { // self-test: save downloads to a known folder instead of asking
    session.defaultSession.on('will-download', (_e, item) => item.setSavePath(path.join(process.env.NOTEFALL_DL, item.getFilename())))
  }
  protocol.handle('app', (req) => {
    const pathname = decodeURIComponent(new URL(req.url).pathname)
    // test hook: lets the headless self-test feed a real file to the renderer
    if (pathname === '/__file' && process.env.NOTEFALL_FILE) return net.fetch(pathToFileURL(process.env.NOTEFALL_FILE).toString())
    const p = path.join(__dirname, 'dist', pathname)
    return net.fetch(pathToFileURL(p).toString())
  })
  const selftest = !!process.env.NOTEFALL_SELFTEST
  const win = new BrowserWindow({
    width: +(process.env.NOTEFALL_SIZE || '1280x780').split('x')[0], height: +(process.env.NOTEFALL_SIZE || '1280x780').split('x')[1], minWidth: 960, minHeight: 600, show: !selftest, backgroundColor: '#080a1c',
    webPreferences: { autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false, preload: path.join(__dirname, 'preload.cjs') },
  })
  win.setMenuBarVisibility(false)
  win.loadURL('app://notefall/index.html' + (selftest ? '?selftest' + (process.env.NOTEFALL_FILE ? '&file&name=' + encodeURIComponent(path.basename(process.env.NOTEFALL_FILE)) : '') + (process.env.NOTEFALL_VF ? '&vf' : '') + (process.env.NOTEFALL_EDIT ? '&edit' : '') + (process.env.NOTEFALL_SEEK ? '&seek=' + process.env.NOTEFALL_SEEK : '') + (process.env.NOTEFALL_UI ? '&ui=' + process.env.NOTEFALL_UI : '') + (process.env.NOTEFALL_PERSIST ? '&persist' : '') + (process.env.NOTEFALL_SHELL ? '&shell' : '') + (process.env.NOTEFALL_COMPOSE ? '&compose' + (process.env.NOTEFALL_COMPOSE === 'falling' ? '&falling' : process.env.NOTEFALL_COMPOSE === 'pdf' ? '&pdf' : process.env.NOTEFALL_COMPOSE === 'showcase' ? '&showcase' : '') : '') + (process.env.NOTEFALL_EDITOR ? '&editor' + (process.env.NOTEFALL_EDITOR === 'showcase' ? '&showcase' : process.env.NOTEFALL_EDITOR === 'endings' ? '&endings' : '') : '') + (process.env.NOTEFALL_LEAD ? '&lead' : '') + (process.env.NOTEFALL_TX ? '&tx' : '') + (process.env.NOTEFALL_SYNTH ? '&synth' : '') + (process.env.NOTEFALL_EXPORT ? '&export' : '') + (process.env.NOTEFALL_THEME ? '&theme=' + process.env.NOTEFALL_THEME : '') : ''))
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
