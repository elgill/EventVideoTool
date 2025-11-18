# Video Editor - Electron + Angular 20

A modern cross-platform video editing application built with Electron and Angular 20, featuring automatic ffmpeg integration for powerful video processing capabilities.

## Features

✨ **Core Features:**
- 🎬 **Video Concatenation** - Combine multiple video files into one
- ✂️ **Video Trimming** - Trim videos to specific start and end times
- 🔄 **Re-encoding** - Re-encode videos with configurable bitrate and codec
- 🔇 **Audio Muting** - Remove audio tracks from videos
- ⚡ **Hardware Acceleration** - Automatic GPU acceleration support (VideoToolbox on Mac, NVENC/AMF/QSV on Windows/Linux)
- 📺 **Video Preview** - Built-in video player to preview your edits
- ⏱️ **Time Utilities** - Time calculation tools for multi-camera workflows

## Modern Angular 20 Features

This app showcases the latest Angular 20 features:
- 🎯 **Signals** - Reactive state management with Angular Signals
- 🔄 **Computed Values** - Auto-updating computed properties
- 🎨 **Control Flow Syntax** - Modern `@if`, `@for`, `@else` syntax
- 🧩 **Standalone Components** - No NgModules required
- ⚡ **Effects** - Side effects with the new `effect()` API

## FFmpeg Integration

Unlike traditional Electron apps that require manual ffmpeg bundling, this app uses:
- `@ffmpeg-installer/ffmpeg` - Automatically downloads and bundles correct ffmpeg binary for each platform
- `@ffprobe-installer/ffprobe` - Automatically handles ffprobe binary
- `fluent-ffmpeg` - Clean, promise-based API for ffmpeg operations

**No manual ffmpeg installation or bundling required!**

## Installation

```bash
npm install
```

## Development

Run the app in development mode:

```bash
npm run electron:dev
```

This will:
1. Start the Angular dev server on port 4200
2. Wait for it to be ready
3. Launch Electron pointing to the dev server
4. Enable hot-reload for both Angular and Electron changes

## Building for Production

### Build for your current platform:
```bash
npm run electron:build
```

### Build for specific platforms:
```bash
npm run electron:build:mac    # macOS (DMG + ZIP)
npm run electron:build:win    # Windows (NSIS installer + Portable)
npm run electron:build:all    # All platforms
```

Built applications will be in the `release` folder.

## Usage

### 1. Select Directories
- **Clip Directory**: Choose a folder containing your video files (MP4, MOV, AVI, MKV)
- **Output Directory**: Choose where to save the processed videos

### 2. Concatenate Videos
- Click "Concatenate Videos" to merge all videos in the clip directory
- Videos are concatenated in alphabetical order
- Hardware acceleration is used by default for best performance

### 3. Process Video
After concatenation, you can:
- **Trim**: Set start and end times (HH:MM:SS format)
- **Re-encode**: Choose to re-encode with H.264 codec (5Mbps bitrate)
- **Mute**: Remove audio track
- **Hardware Acceleration**: Use GPU encoding when available

### 4. Preview
- Videos automatically appear in the preview panel after processing
- Click "Open in External Player" to view in your default video player

### 5. Time Utilities
Useful for multi-camera setups:
- **Time Difference Calculator**: Calculate recording times across multiple cameras
- **Time to Seconds Converter**: Convert HH:MM:SS to total seconds

## Supported Platforms

- ✅ **macOS** (10.13+)
  - Hardware Acceleration: VideoToolbox
- ✅ **Windows** (7/8/10/11)
  - Hardware Acceleration: NVENC (NVIDIA), AMF (AMD), QSV (Intel)
- ✅ **Linux** (Ubuntu, Debian, Fedora, etc.)
  - Hardware Acceleration: NVENC (NVIDIA), VAAPI (AMD), QSV (Intel)

## Hardware Acceleration

The app automatically detects and uses hardware acceleration when available:
- **macOS**: H.264 VideoToolbox
- **Windows/Linux**:
  - NVIDIA: H.264 NVENC
  - AMD: H.264 AMF (Windows) / VAAPI (Linux)
  - Intel: H.264 QSV

If hardware acceleration fails, the app automatically falls back to software encoding (libx264).

## Technology Stack

- **Electron** - Cross-platform desktop framework
- **Angular 20** - Modern web framework with signals and standalone components
- **FFmpeg** - Video processing engine (auto-installed)
- **TypeScript** - Type-safe development
- **SCSS** - Styled components

## Project Structure

```
electron-video-editor/
├── electron/
│   ├── main.js          # Electron main process
│   └── preload.js       # Preload script for IPC
├── src/
│   ├── app/
│   │   ├── services/    # Angular services
│   │   ├── app.ts       # Main app component
│   │   ├── app.html     # App template
│   │   └── app.scss     # App styles
│   ├── electron.d.ts    # TypeScript definitions
│   └── styles.scss      # Global styles
└── package.json         # Dependencies and scripts
```

## Development Tips

1. **Hot Reload**: Changes to Angular code auto-reload in dev mode
2. **DevTools**: Press `Cmd+Option+I` (Mac) or `Ctrl+Shift+I` (Windows/Linux) to open DevTools
3. **Logs**: Check the console for ffmpeg command output and errors

## Troubleshooting

### Video won't play in preview
- Ensure the video file exists and is readable
- Try opening in external player
- Check browser console for errors

### Concatenation fails
- Verify all files in the directory are valid video files
- Ensure output directory is writable
- Check that files are compatible (same codec/format works best)

### Hardware acceleration not working
- The app will automatically fall back to software encoding
- Check that your GPU drivers are up to date
- Not all GPUs support all codecs

## License

MIT

## Credits

Built with modern web technologies and powered by FFmpeg.
