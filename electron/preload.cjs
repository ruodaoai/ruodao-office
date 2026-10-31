'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ruodaoDesktop', {
  onOpenFiles: (callback) => {
    const listener = (_event, files) => callback(files)
    ipcRenderer.on('ruodao:open-files', listener)
    return () => ipcRenderer.removeListener('ruodao:open-files', listener)
  },
  ready: () => ipcRenderer.send('ruodao:renderer-ready'),
  onFlush: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('ruodao:flush', listener)
    return () => ipcRenderer.removeListener('ruodao:flush', listener)
  },
  flushDone: () => ipcRenderer.send('ruodao:flush-done'),
})
