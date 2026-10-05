const { contextBridge, ipcRenderer } = require('electron')

// The only door from the page to the main process: print the current page (its @media print view) to PDF bytes.
contextBridge.exposeInMainWorld('notefall', {
  printPdf: () => ipcRenderer.invoke('print-pdf'),
  // scanned sheet music (see omr.cjs)
  omr: {
    status: () => ipcRenderer.invoke('omr-status'),
    install: () => ipcRenderer.invoke('omr-install'),
    run: (data, pages) => ipcRenderer.invoke('omr-run', data, pages),
    cancel: () => ipcRenderer.invoke('omr-cancel'),
    onProgress: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('omr-progress', h); return () => ipcRenderer.removeListener('omr-progress', h) },
  },
  // menu commands (macOS app menu: undo, redo, select all, zoom) arrive here
  onMenu: (cb) => ipcRenderer.on('menu-cmd', (_e, cmd) => cb(cmd)),
})
