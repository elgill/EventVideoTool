# Migration notes: PyQt5 → Tauri + Angular

## Why

The original app (kept in [`legacy-python/`](./legacy-python)) was PyQt5 +
manually-downloaded, per-OS ffmpeg/ffprobe binaries that had to be placed
into `ffmpeg_binaries/{mac,linux,win}/` by hand before `pyinstaller` could
build. It also had no in-app video preview — "Preview" just opened the file
in the system's default video player — and its progress bar was wired up on
the backend but never connected to the UI (`main.py`'s
`update_progress_bar` was a no-op).

This rewrite addresses exactly those three gaps: still cross-platform, but
with ffmpeg auto-bundled (no manual download, ever) and a real in-app
preview with a draggable trim timeline.

## Stack decision

Tauri + Angular + Rust, chosen over Electron/React and over staying in
Python (PySide6 + QtMultimedia), per the plan discussed with the repo owner.
Tauri gives a much smaller install size than Electron (native OS webview
instead of bundling Chromium) while still allowing a real `<video>` element
for preview.

## ffmpeg bundling: what actually shipped vs. the original plan

The original plan proposed a custom fetch script pulling static builds from
BtbN/FFmpeg-Builds (Windows/Linux) and evermeet.cx (macOS) GitHub releases.
During implementation, from this development sandbox, `github.com`'s
release-download endpoints were blocked by network policy (`crates.io` and
`registry.npmjs.org` were reachable; `github.com` returned 403 outside of
`raw.githubusercontent.com`).

Instead, `scripts/prepare-ffmpeg.mjs` sources ffmpeg/ffprobe from the
`@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe` npm packages,
which ship real static binaries **as npm package content** (their
per-platform sub-packages, e.g. `@ffmpeg-installer/linux-x64`, are the
binary — there's no separate download step). This is arguably more robust
than the original GitHub-releases plan since it works through any firewall
that allows npm, not just this sandbox. The tradeoff: the bundled ffmpeg is
an older static build (~2018-2023 vintage, still includes libx264/libx265
and all the hardware encoders this app uses: NVENC, VideoToolbox, QSV,
VAAPI). If newer codec support (e.g. AV1) is ever needed, swap the source in
`prepare-ffmpeg.mjs` for a BtbN/evermeet fetch — the rest of the pipeline
(sidecar naming, `externalBin` config) is unchanged either way.

## What's implemented

- Full Rust backend: clip discovery + ffprobe duration lookups, concat,
  trim/mute/re-encode, hardware-encoder detection, live progress streaming
  via Tauri events. 27 unit tests + 1 end-to-end integration test (real
  bundled binaries against synthetic video).
- Full Angular UI: directory pickers, clip list, in-app video preview,
  draggable trim timeline, options, live progress bar, Time Utilities
  dialog. 32 unit tests (Vitest + jsdom).
- `npm run tauri build` produces working `.deb`, `.rpm`, and `.AppImage`
  bundles on Linux in this sandbox (~56-126MB, comparable to the original's
  bundled-ffmpeg size).

## What's not verified here

This sandbox is Linux-only, headless (no display), and has no macOS/Windows
runners. Not verified by this session:

- Actually running the GUI (manual click-through, visual layout, drag
  interactions) — no display available. The Rust and Angular test suites
  are the available substitute; a human should click through the app at
  least once before relying on it.
- macOS/Windows builds. `@ffmpeg-installer`/`@ffprobe-installer`'s
  `optionalDependencies` mechanism means `npm install` on those platforms
  should transparently pull the matching binary, and Tauri's bundler
  handles `.dmg`/`.msi` output the same way it handled `.deb`/`.rpm` here —
  but this has not been built or run on those OSes.
- Code signing (macOS notarization, Windows Authenticode). Unsigned builds
  will show Gatekeeper/SmartScreen warnings.

## Suggested next steps

- Click through the app on a real desktop (all three OSes if possible) to
  verify the trim-handle drag interaction and overall layout feel right.
  This is the one thing this environment fundamentally cannot verify.
- Set up a CI matrix (GitHub Actions `windows-latest`/`macos-latest`/
  `ubuntu-latest`) running `cargo test`, `ng test`, and `tauri build` on
  every push, replacing the manual `pyinstaller` step.
- Code-signing certificates for macOS/Windows, if wide distribution is
  planned.
- Stretch features from the original plan not yet built: thumbnail
  filmstrip on the timeline, drag-to-reorder clips before concatenation.
