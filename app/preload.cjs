const { contextBridge, ipcRenderer } = require('electron')

// The only door from the page to the main process: print the current page (its @media print view) to PDF bytes.
contextBridge.exposeInMainWorld('notefall', {
  printPdf: () => ipcRenderer.invoke('print-pdf'),
  // menu commands (macOS app menu: undo, redo, select all, zoom) arrive here
  onMenu: (cb) => ipcRenderer.on('menu-cmd', (_e, cmd) => cb(cmd)),
})
