const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Dialog methods
  selectDirectory: (title) => ipcRenderer.invoke('dialog:selectDirectory', title),
  selectFile: (title, filters) => ipcRenderer.invoke('dialog:selectFile', title, filters),

  // Video processing methods
  getFilesFromDirectory: (directoryPath) => ipcRenderer.invoke('video:getFilesFromDirectory', directoryPath),
  concatenateVideos: (options) => ipcRenderer.invoke('video:concatenate', options),
  processVideo: (options) => ipcRenderer.invoke('video:process', options),
  getVideoMetadata: (filePath) => ipcRenderer.invoke('video:getMetadata', filePath),

  // File operations
  fileExists: (filePath) => ipcRenderer.invoke('file:exists', filePath),
  openExternal: (filePath) => ipcRenderer.invoke('file:openExternal', filePath),

  // Progress listener
  onProgress: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('video:progress', subscription);

    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('video:progress', subscription);
    };
  }
});

console.log('Preload script loaded');
