# Event Video Tool

A desktop utility for concatenating GoPro-style clips and trimming/re-encoding
the combined video, with an in-app video preview and a draggable trim
timeline.

This is a Tauri + Angular + Rust rewrite of the original PyQt5 tool (kept for
reference in [`legacy-python/`](./legacy-python)). See
[`MIGRATION.md`](./MIGRATION.md) for why and how.

## Features

- Pick a clip directory and concatenate every `.mp4` clip in it (sorted by
  name), matching the original's GoPro-clip-joining workflow.
- In-app video preview (play/pause/seek) for both individual clips and the
  concatenated output — the original only opened files in your system video
  player.
- A draggable trim timeline on the concatenated output, instead of typing
  `HH:MM:SS` blind.
- Mute, re-encode, and hardware-acceleration options, with the actual
  detected hardware encoder shown in the UI.
- A live, working progress bar with speed/ETA during concat and processing.
- Time Utilities dialog for converting between a recording's internal
  timestamp and real-world event time.
- ffmpeg/ffprobe are bundled automatically — see below.

## Tech stack

- **Frontend:** Angular (standalone components + signals), rendered in
  Tauri's native OS webview.
- **Backend:** Rust via Tauri v2. `src-tauri/src/ffmpeg/` and
  `src-tauri/src/clips.rs`/`hwaccel.rs` hold the ffmpeg argument building,
  progress parsing, and hardware-encoder detection — all pure and unit
  tested independently of Tauri.
- **ffmpeg/ffprobe:** bundled as Tauri "sidecar" binaries, sourced from the
  `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe` npm packages
  (which ship real static binaries as package content, not a download
  step). `npm install` triggers `scripts/prepare-ffmpeg.mjs` automatically,
  which stages them into `src-tauri/binaries/` with the file names Tauri's
  sidecar bundling expects. **Nobody ever downloads or places an ffmpeg
  binary by hand**, on any platform.

## Development

Requires Node.js and Rust (`rustup`). On Linux you'll also need the
webkit2gtk/gtk dev packages Tauri lists at
<https://tauri.app/start/prerequisites/>.

```sh
npm install          # also stages the ffmpeg/ffprobe sidecars
npm run tauri dev     # launches the app with hot reload
```

## Testing

```sh
# Rust: pure-logic unit tests + an end-to-end integration test that runs
# the real bundled ffmpeg/ffprobe binaries against synthetic video
# (concat -> trim -> mute -> re-encode) and checks the output.
cd src-tauri && cargo test

# Angular: unit tests (Vitest + jsdom, no browser required)
npx ng test
```

## Building

```sh
npm run tauri build
```

Produces platform installers under `src-tauri/target/release/bundle/`
(`.deb`/`.rpm`/`.AppImage` on Linux, `.msi`/`.exe` on Windows, `.dmg`/`.app`
on macOS). Each OS's CI runner naturally resolves its own platform's
`@ffmpeg-installer`/`@ffprobe-installer` package via npm's
`optionalDependencies`, so building on Windows/macOS "just works" the same
way — no per-platform script variants needed.

Windows and macOS builds are unsigned by default; unsigned installers will
trigger a SmartScreen/Gatekeeper warning until code-signing certificates are
configured.
