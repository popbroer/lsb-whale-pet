'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('replyApi', {
  list: () => ipcRenderer.invoke('replyw:list'),
  send: (payload) => ipcRenderer.invoke('replyw:send', payload),
  close: () => ipcRenderer.send('replyw:close'),
});
