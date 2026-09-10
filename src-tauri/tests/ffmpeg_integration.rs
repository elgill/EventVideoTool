//! End-to-end smoke test that exercises the real bundled ffmpeg/ffprobe
//! sidecar binaries (the ones `scripts/prepare-ffmpeg.mjs` stages into
//! `src-tauri/binaries/`) against synthetic video, using the same
//! arg-builders and progress parser the production Tauri commands use.
//!
//! This is the strongest verification available in a headless environment:
//! it can't drive the actual GUI window, but it proves the bundled binaries
//! run, that concat/trim/mute/re-encode produce correct output, and that
//! progress reporting reaches 100%.

use eventvideotool_app_lib::clips;
use eventvideotool_app_lib::ffmpeg::args::{build_concat_args, build_process_args, ProcessOptions};
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

#[test]
fn concat_then_trim_and_mute_end_to_end() {
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

    // --- concat (same code path concat_clips uses) ---
    let filelist_path = clips::write_filelist(dir.path(), &discovered).unwrap();
    let total_duration = clips::total_duration_secs(&discovered);
    assert!((total_duration - 4.0).abs() < 0.5);

    let concat_output = dir.path().join("concatenated.mp4");
    let concat_args = build_concat_args(&filelist_path, &concat_output.to_string_lossy());
    let final_percentage = run_ffmpeg_and_track_progress(&ffmpeg_path, concat_args, total_duration);

    assert!(
        concat_output.exists(),
        "concatenated output was not created"
    );
    assert!(
        final_percentage >= 99.0,
        "expected concat to reach ~100%, got {final_percentage}"
    );

    let concatenated_duration = clips::probe_duration_secs(&ffprobe_path, &concat_output).unwrap();
    assert!(
        (concatenated_duration - 4.0).abs() < 0.5,
        "expected concatenated clip to be ~4s, got {concatenated_duration}"
    );
    assert!(has_audio_stream(&ffprobe_path, &concat_output));

    // --- trim + mute + re-encode (same code path process_video uses) ---
    let processed_output = dir.path().join("processed.mp4");
    let opts = ProcessOptions {
        input_file: concat_output.to_str().unwrap(),
        output_file: processed_output.to_str().unwrap(),
        start_time: Some("00:00:00"),
        end_time: Some("00:00:02"),
        mute: true,
        re_encode: true,
        hw_acceleration: false,
        hw_encoder: None,
    };
    let process_args = build_process_args(&opts);
    let final_percentage = run_ffmpeg_and_track_progress(&ffmpeg_path, process_args, 2.0);

    assert!(
        processed_output.exists(),
        "processed output was not created"
    );
    assert!(
        final_percentage >= 99.0,
        "expected process to reach ~100%, got {final_percentage}"
    );

    let processed_duration = clips::probe_duration_secs(&ffprobe_path, &processed_output).unwrap();
    assert!(
        (processed_duration - 2.0).abs() < 0.3,
        "expected trimmed clip to be ~2s, got {processed_duration}"
    );
    assert!(
        !has_audio_stream(&ffprobe_path, &processed_output),
        "expected -an to strip the audio stream"
    );
}
