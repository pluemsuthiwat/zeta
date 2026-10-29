import { contextBridge, ipcRenderer } from 'electron'

// Main replies { ok, data } | { ok: false, error } so the window gets clean error messages.
async function invoke(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args)
  if (!res.ok) throw new Error(res.error)
  return res.data
}

contextBridge.exposeInMainWorld('zeta', {
  platform: process.platform,
  window: {
    setTheme: (theme) => ipcRenderer.send('window:setTheme', theme)
  },
  controllers: {
    list: () => invoke('controllers:list'),
    get: (id) => invoke('controllers:get', id),
    create: (input) => invoke('controllers:create', input),
    update: (id, input) => invoke('controllers:update', id, input),
    remove: (id) => invoke('controllers:delete', id),
    test: (id) => invoke('controllers:test', id),
    apStats: (id) => invoke('controllers:apStats', id)
  },
  aps: {
    list: (id) => invoke('aps:list', id)
  },
  imports: {
    saveTemplate: (type) => invoke('template:save', type),
    preview: (id, bytes) => invoke('import:preview', id, bytes),
    apply: (id, bytes, confirmReboot) => invoke('import:apply', id, bytes, confirmReboot),
    /** Progress of a preview/apply check: ({ kind, phase, done, total }) => void. Returns unsubscribe. */
    onProgress: (cb) => {
      const listener = (_e, p) => cb(p)
      ipcRenderer.on('import:progress', listener)
      return () => ipcRenderer.removeListener('import:progress', listener)
    }
  },
  net: {
    list: () => invoke('net:list'),
    set: (name) => invoke('net:set', name)
  },
  jobs: {
    list: (id) => invoke('jobs:list', id),
    get: (jobId) => invoke('jobs:get', jobId)
  }
})
