//! End-to-end smoke test that exercises the real bundled ffmpeg/ffprobe
//! sidecar binaries (the ones `scripts/prepare-ffmpeg.mjs` stages into
//! `src-tauri/binaries/`) against synthetic video, using the same
//! arg-builders and progress parser the production Tauri commands use.
//!
//! This is the strongest verification available in a headless environment:
//! it can't drive the actual GUI window, but it proves the bundled binaries
//! run, that a single-pass concat/trim/mute/re-encode export produces
//! correct output, and that progress reporting reaches 100%.

use eventvideotool_app_lib::clips;
use eventvideotool_app_lib::clips::ClipInfo;
use eventvideotool_app_lib::ffmpeg::args::{build_export_args, ExportOptions};
use eventvideotool_app_lib::ffmpeg::progress::ProgressParser;

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Locates a staged sidecar binary by its logical name ("ffmpeg" or
/// "ffprobe"), regardless of which target-triple suffix
/// `scripts/prepare-ffmpeg.mjs` gave it.
fn find_sidecar(name: &str) -> PathBuf {
    let binaries_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
    let prefix = format!("{name}-");
    std::fs::read_dir(&binaries_dir)
        .unwrap_or_else(|e| {
            panic!(
                "could not read {}: {e}. Run `npm run prepare:ffmpeg` first.",
                binaries_dir.display()
            )
        })
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with(&prefix))
                .unwrap_or(false)
        })
        .unwrap_or_else(|| {
            panic!(
                "no staged {name} binary found in {}. Run `npm run prepare:ffmpeg` first.",
                binaries_dir.display()
            )
        })
}

/// Runs ffmpeg with `args`, feeding its `-progress pipe:1` stdout into a
/// [`ProgressParser`], and returns the final snapshot's percentage.
fn run_ffmpeg_and_track_progress(
    ffmpeg_path: &Path,
    mut args: Vec<String>,
    duration_secs: f64,
) -> f64 {
    args.extend(
        [
            "-hide_banner",
            "-loglevel",
            "error",
            "-progress",
            "pipe:1",
            "-nostats",
        ]
        .iter()
        .map(|s| s.to_string()),
    );

    let mut child = Command::new(ffmpeg_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn ffmpeg");

    let stdout = child.stdout.take().unwrap();
    let mut parser = ProgressParser::new(duration_secs);
    let mut last_percentage = 0.0;

    for line in BufReader::new(stdout).lines() {
        let line = line.expect("failed to read ffmpeg stdout");
        if let Some(snapshot) = parser.feed_line(&line) {
            last_percentage = snapshot.percentage;
        }
    }

    let status = child.wait().expect("failed to wait on ffmpeg");
    assert!(
        status.success(),
        "ffmpeg exited with {status}: args={args:?}"
    );

    last_percentage
}

/// Generates a tiny synthetic test clip (no real footage needed) using
/// ffmpeg's lavfi test sources.
fn generate_test_clip(ffmpeg_path: &Path, dest: &Path, duration_secs: u32) {
    let status = Command::new(ffmpeg_path)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            &format!("testsrc=duration={duration_secs}:size=320x240:rate=25"),
            "-f",
            "lavfi",
            "-i",
            &format!("sine=frequency=1000:duration={duration_secs}"),
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            "-y",
        ])
        .arg(dest)
        .status()
        .expect("failed to spawn ffmpeg for test clip generation");
    assert!(
        status.success(),
        "failed to generate test clip {}",
        dest.display()
    );
}

fn has_audio_stream(ffprobe_path: &Path, file: &Path) -> bool {
    let output = Command::new(ffprobe_path)
        .args([
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=index",
        ])
        .arg(file)
        .output()
        .expect("failed to run ffprobe");
    !String::from_utf8_lossy(&output.stdout).trim().is_empty()
}

/// Plans, writes, and runs an export exactly like the `export_video`
/// command does, returning the output path and final progress percentage.
#[allow(clippy::too_many_arguments)]
fn export(
    ffmpeg_path: &Path,
    dir: &Path,
    clip_infos: &[ClipInfo],
    name: &str,
    start_secs: Option<f64>,
    end_secs: Option<f64>,
    mute: bool,
    re_encode: bool,
) -> (PathBuf, f64) {
    let segments = clips::plan_segments(clip_infos, start_secs, end_secs).unwrap();
    let filelist_path = clips::temp_filelist_path();
    clips::write_filelist(&filelist_path, &segments).unwrap();

    // Joined the way the frontend's `joinPath` does it: with a `/`, even on
    // Windows. That mixed-separator path once leaked into the filelist's
    // location and broke clip path resolution, so keep exercising it.
    let output_file = format!("{}/{name}.mp4", dir.display());
    let output = PathBuf::from(&output_file);
    let args = build_export_args(&ExportOptions {
        filelist_path: &filelist_path,
        seek_secs: segments[0].inpoint,
        output_file: &output_file,
        mute,
        re_encode,
        hw_acceleration: false,
        hw_encoder: None,
    });
    let final_percentage =
        run_ffmpeg_and_track_progress(ffmpeg_path, args, clips::segments_duration_secs(&segments));
    let _ = std::fs::remove_file(&filelist_path);
    assert!(output.exists(), "{name} output was not created");
    (output, final_percentage)
}

#[test]
fn export_concats_trims_and_mutes_in_one_pass() {
    let ffmpeg_path = find_sidecar("ffmpeg");
    let ffprobe_path = find_sidecar("ffprobe");

    let dir = tempfile::tempdir().unwrap();

    // Two 2-second synthetic clips, named so they concatenate in order.
    generate_test_clip(&ffmpeg_path, &dir.path().join("clip_a.mp4"), 2);
    generate_test_clip(&ffmpeg_path, &dir.path().join("clip_b.mp4"), 2);

    // --- clip discovery (same code path list_clips uses) ---
    let discovered = clips::list_clips_sync(&ffprobe_path, dir.path()).unwrap();
    assert_eq!(
        discovered.len(),
        2,
        "expected both synthetic clips to be discovered"
    );
    for clip in &discovered {
        let d = clip.duration_secs.expect("duration should be probed");
        assert!((d - 2.0).abs() < 0.3, "unexpected clip duration: {d}");
    }

    // --- untrimmed stream-copy export: the old "concat" step on its own ---
    let (full, final_percentage) = export(
        &ffmpeg_path,
        dir.path(),
        &discovered,
        "full",
        None,
        None,
        false,
        false,
    );
    assert!(
        final_percentage >= 99.0,
        "expected full export to reach ~100%, got {final_percentage}"
    );
    let full_duration = clips::probe_duration_secs(&ffprobe_path, &full).unwrap();
    assert!(
        (full_duration - 4.0).abs() < 0.5,
        "expected full export to be ~4s, got {full_duration}"
    );
    assert!(has_audio_stream(&ffprobe_path, &full));

    // --- trim across the clip boundary (1s..3s) + mute + re-encode ---
    let (trimmed, final_percentage) = export(
        &ffmpeg_path,
        dir.path(),
        &discovered,
        "trimmed",
        Some(1.0),
        Some(3.0),
        true,
        true,
    );
    assert!(
        final_percentage >= 99.0,
        "expected trimmed export to reach ~100%, got {final_percentage}"
    );
    let trimmed_duration = clips::probe_duration_secs(&ffprobe_path, &trimmed).unwrap();
    assert!(
        (trimmed_duration - 2.0).abs() < 0.3,
        "expected trimmed export to be ~2s, got {trimmed_duration}"
    );
    assert!(
        !has_audio_stream(&ffprobe_path, &trimmed),
        "expected -an to strip the audio stream"
    );
}
