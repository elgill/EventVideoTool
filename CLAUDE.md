# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Desktop tool for joining GoPro-style `.mp4` clips, previewing them as one video with a draggable trim timeline, and exporting (concat + trim + mute + re-encode) in a single ffmpeg pass. Tauri v2 + Angular (standalone components, signals) + Rust. `legacy-python/` is the original PyQt5 app, kept only as reference — don't modify it or wire it into the build. `MIGRATION.md` explains the rewrite and what hasn't been verified (GUI click-through, macOS/Windows builds, code signing).

## Commands

```sh
npm install              # postinstall stages ffmpeg/ffprobe sidecars into src-tauri/binaries/
npm run tauri dev        # run the app (Angular dev server on port 1420 + Tauri window)
npm run tauri build      # installers under src-tauri/target/release/bundle/

# Rust tests (run from src-tauri/)
cargo test                              # unit tests + ffmpeg integration test
cargo test plan_segments                # single test / filter by name
cargo test --test ffmpeg_integration    # only the end-to-end test

# Angular tests (Vitest + jsdom via @angular/build:unit-test, no browser)
npx ng test
npx ng test --include src/app/timeline.spec.ts   # single spec file
```

The Rust integration test (`src-tauri/tests/ffmpeg_integration.rs`) runs the real staged sidecar binaries; if `src-tauri/binaries/` is empty, run `npm run prepare:ffmpeg` first.

## ffmpeg bundling

ffmpeg/ffprobe come from the `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe` npm packages. `scripts/prepare-ffmpeg.mjs` copies them to `src-tauri/binaries/{ffmpeg,ffprobe}-<rustc host triple>[.exe]` (the naming Tauri's `externalBin` sidecar config requires). It runs on `npm install` and before every `tauri dev`/`tauri build` (see `beforeDevCommand`/`beforeBuildCommand` in `src-tauri/tauri.conf.json`). Never hand-place binaries. The production code invokes them via `app.shell().sidecar("ffmpeg"|"ffprobe")`.

## Architecture

**Frontend ↔ backend contract.** Three Tauri commands in `src-tauri/src/commands.rs` (registered in `lib.rs`): `list_clips`, `detect_hw_encoder`, `export_video`. The frontend calls them only through `src/app/services/video-tool.service.ts`. Progress comes back as Tauri events `ffmpeg-progress` / `ffmpeg-finished` (emitted by `src-tauri/src/ffmpeg/runner.rs`, consumed by `ffmpeg-events.service.ts` as signals, wrapped in `NgZone.run`). Payload shapes are mirrored by hand between Rust structs (`clips::ClipInfo`, `runner::ProgressEvent`/`FinishedEvent`) and `src/app/models.ts` — keep them in sync; Rust fields are snake_case on the wire (e.g. `duration_secs`), while command *arguments* are camelCase from JS (`outputFile`, `startSecs`).

**Keep Rust logic pure.** `commands.rs` is intentionally thin. Business logic lives in Tauri-free modules so it can be unit tested without the runtime: `clips.rs` (clip scanning, segment planning, concat filelist writing), `ffmpeg/args.rs` (arg-list builders), `ffmpeg/progress.rs` (parses ffmpeg progress output), `hwaccel.rs` (per-OS GPU → encoder detection). The lib crate is `eventvideotool_app_lib`, which the integration test imports.

**Combined timeline model.** All clips in the chosen directory (non-empty `.mp4`, sorted by name) are laid end to end. Trim start/end are positions on this combined timeline, both in the UI (`src/app/timeline.ts`: `buildTimeline`, `locate`) and the backend (`clips::plan_segments`). The frontend passes the exact `ClipInfo[]` list it built the timeline from back to `export_video`, so positions map onto the same durations the user saw. Any clip with an unknown (`null`) duration makes the timeline invalid and export is refused.

**Single-pass export.** `plan_segments` converts the trim window into per-clip segments (only the first may have an inpoint, only the last an outpoint, cuts are clip-relative to avoid drift). `write_filelist` writes a concat-demuxer filelist with `outpoint` directives but deliberately *no* `inpoint` (it would keep pre-keyframe frames); the first segment's inpoint is applied instead as input `-ss` in `build_export_args`. There is no intermediate concatenated file.

**Preview.** The webview plays local files via `convertFileSrc` (Tauri asset protocol, enabled with scope `**` in `tauri.conf.json`). `video-preview` component handles playback across clip boundaries and the trim handles; `clock-sync` is the Time Utilities dialog (recording timestamp ↔ real-world event time).
