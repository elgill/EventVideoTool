const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const url = require('url');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const fsSync = require('fs');

// Set ffmpeg paths
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

let mainWindow;

// Register protocol scheme as privileged before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

// Register custom protocol for serving local video files
app.whenReady().then(() => {
  protocol.registerFileProtocol('media', (request, callback) => {
    try {
      const filePath = decodeURIComponent(request.url.replace('media://', ''));
      console.log('Media protocol request:', request.url);
      console.log('Resolved file path:', filePath);

      // Verify file exists
      if (!fsSync.existsSync(filePath)) {
        console.error('File not found:', filePath);
        callback({ error: -6 }); // FILE_NOT_FOUND
        return;
      }

      callback({ path: filePath });
    } catch (error) {
      console.error('Protocol error:', error);
      callback({ error: -2 });
    }
  });

  createWindow();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../public/favicon.ico')
  });

  // Load Angular app
  const startUrl = process.env.ELECTRON_START_URL || url.format({
    pathname: path.join(__dirname, '../dist/electron-video-editor/browser/index.html'),
    protocol: 'file:',
    slashes: true,
  });

  mainWindow.loadURL(startUrl);

  // Update Content Security Policy to allow media:// protocol
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self' 'unsafe-inline' 'unsafe-eval' media: http://localhost:* ws://localhost:*"]
      }
    });
  });

  // Open DevTools in development
  if (process.env.ELECTRON_START_URL) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Helper function to detect hardware encoder
function getHardwareEncoder() {
  const platform = process.platform;

  if (platform === 'darwin') {
    return 'h264_videotoolbox';
  } else if (platform === 'win32') {
    // Try to detect GPU - default to NVIDIA, fallback to software
    return 'h264_nvenc';
  } else {
    // Linux - try NVIDIA first
    return 'h264_nvenc';
  }
}

// Helper function to get video duration
function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata.format.duration);
      }
    });
  });
}

// Helper function to get video metadata
function getVideoMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata);
      }
    });
  });
}

// IPC Handlers

// Select directory
ipcMain.handle('dialog:selectDirectory', async (event, title) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: title || 'Select Directory'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Select file
ipcMain.handle('dialog:selectFile', async (event, title, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: title || 'Select File',
    filters: filters || [{ name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv'] }]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Get video files from directory
ipcMain.handle('video:getFilesFromDirectory', async (event, directoryPath) => {
  try {
    const files = await fs.readdir(directoryPath);
    const videoFiles = files
      .filter(file => /\.(mp4|mov|avi|mkv)$/i.test(file))
      .sort()
      .map(file => path.join(directoryPath, file));

    // Get metadata for each file
    const filesWithMetadata = await Promise.all(
      videoFiles.map(async (filePath) => {
        try {
          const metadata = await getVideoMetadata(filePath);
          return {
            path: filePath,
            name: path.basename(filePath),
            duration: metadata.format.duration,
            size: metadata.format.size,
          };
        } catch (err) {
          console.error(`Error getting metadata for ${filePath}:`, err);
          return {
            path: filePath,
            name: path.basename(filePath),
            duration: 0,
            size: 0,
          };
        }
      })
    );

    return filesWithMetadata;
  } catch (err) {
    throw new Error(`Failed to read directory: ${err.message}`);
  }
});

// Concatenate videos
ipcMain.handle('video:concatenate', async (event, { inputFiles, outputPath, useHardwareAcceleration }) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Create a temporary file list for concat
      const fileListPath = path.join(path.dirname(outputPath), 'filelist.txt');
      const fileListContent = inputFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
      await fs.writeFile(fileListPath, fileListContent);

      // Build input options
      const inputOptions = ['-f', 'concat', '-safe', '0'];
      if (useHardwareAcceleration) {
        inputOptions.unshift('-hwaccel', 'auto');
      }

      const command = ffmpeg(fileListPath)
        .inputOptions(inputOptions)
        .outputOptions(['-c', 'copy'])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('FFmpeg command:', commandLine);
          mainWindow.webContents.send('video:progress', {
            operation: 'concatenate',
            status: 'started'
          });
        })
        .on('progress', (progress) => {
          mainWindow.webContents.send('video:progress', {
            operation: 'concatenate',
            status: 'processing',
            percent: progress.percent || 0,
            currentFps: progress.currentFps,
            targetSize: progress.targetSize,
            timemark: progress.timemark
          });
        })
        .on('end', async () => {
          // Clean up temp file
          try {
            await fs.unlink(fileListPath);
          } catch (err) {
            console.error('Failed to delete temp file:', err);
          }

          mainWindow.webContents.send('video:progress', {
            operation: 'concatenate',
            status: 'completed'
          });

          resolve({ success: true, outputPath });
        })
        .on('error', async (err) => {
          // Clean up temp file
          try {
            await fs.unlink(fileListPath);
          } catch (cleanupErr) {
            console.error('Failed to delete temp file:', cleanupErr);
          }

          mainWindow.webContents.send('video:progress', {
            operation: 'concatenate',
            status: 'error',
            error: err.message
          });

          reject(new Error(`Concatenation failed: ${err.message}`));
        })
        .run();

    } catch (err) {
      reject(new Error(`Failed to start concatenation: ${err.message}`));
    }
  });
});

// Process video (trim, re-encode, mute)
ipcMain.handle('video:process', async (event, options) => {
  const {
    inputPath,
    outputPath,
    startTime,
    endTime,
    reEncode,
    mute,
    useHardwareAcceleration,
    bitrate = '5M'
  } = options;

  return new Promise(async (resolve, reject) => {
    try {
      const command = ffmpeg(inputPath);

      if (useHardwareAcceleration && reEncode) {
        command.inputOptions(['-hwaccel', 'auto']);
      }

      // Trim settings
      if (startTime && startTime !== '00:00:00') {
        command.seekInput(startTime);
      }

      if (endTime && endTime !== '00:00:00') {
        command.duration(endTime);
      }

      // Video encoding settings
      if (reEncode) {
        const encoder = useHardwareAcceleration ? getHardwareEncoder() : 'libx264';
        command
          .videoCodec(encoder)
          .videoBitrate(bitrate);

        if (encoder === 'libx264') {
          command.outputOptions(['-preset', 'fast']);
        }
      } else {
        command.videoCodec('copy');
      }

      // Audio settings
      if (mute) {
        command.noAudio();
      } else if (!reEncode) {
        command.audioCodec('copy');
      } else {
        command.audioCodec('aac');
      }

      command
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('FFmpeg command:', commandLine);
          mainWindow.webContents.send('video:progress', {
            operation: 'process',
            status: 'started'
          });
        })
        .on('progress', (progress) => {
          mainWindow.webContents.send('video:progress', {
            operation: 'process',
            status: 'processing',
            percent: progress.percent || 0,
            currentFps: progress.currentFps,
            targetSize: progress.targetSize,
            timemark: progress.timemark
          });
        })
        .on('end', () => {
          mainWindow.webContents.send('video:progress', {
            operation: 'process',
            status: 'completed'
          });

          resolve({ success: true, outputPath });
        })
        .on('error', (err) => {
          mainWindow.webContents.send('video:progress', {
            operation: 'process',
            status: 'error',
            error: err.message
          });

          reject(new Error(`Processing failed: ${err.message}`));
        })
        .run();

    } catch (err) {
      reject(new Error(`Failed to start processing: ${err.message}`));
    }
  });
});

// Get video metadata
ipcMain.handle('video:getMetadata', async (event, filePath) => {
  try {
    const metadata = await getVideoMetadata(filePath);
    return {
      duration: metadata.format.duration,
      size: metadata.format.size,
      bitrate: metadata.format.bit_rate,
      format: metadata.format.format_name,
      videoCodec: metadata.streams.find(s => s.codec_type === 'video')?.codec_name,
      audioCodec: metadata.streams.find(s => s.codec_type === 'audio')?.codec_name,
      width: metadata.streams.find(s => s.codec_type === 'video')?.width,
      height: metadata.streams.find(s => s.codec_type === 'video')?.height,
      fps: eval(metadata.streams.find(s => s.codec_type === 'video')?.r_frame_rate || '0'),
    };
  } catch (err) {
    throw new Error(`Failed to get metadata: ${err.message}`);
  }
});

// Check if file exists
ipcMain.handle('file:exists', async (event, filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
});

// Open file in default application
ipcMain.handle('file:openExternal', async (event, filePath) => {
  const { shell } = require('electron');
  try {
    await shell.openPath(filePath);
    return true;
  } catch (err) {
    throw new Error(`Failed to open file: ${err.message}`);
  }
});

console.log('Electron main process started');
console.log('FFmpeg path:', ffmpegPath);
console.log('FFprobe path:', ffprobePath);
