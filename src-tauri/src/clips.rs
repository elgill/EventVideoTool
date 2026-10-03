//! Directory scanning + ffprobe duration lookups (port of the file-discovery
//! half of `concatenation_thread.py`), mapping a trim window on the combined
//! clip timeline onto per-clip segments, and serializable types shared with
//! the Angular frontend.
//!
//! Directory scanning/filtering/sorting, segment planning, and filelist
//! writing are pure and fully unit tested here. Actually invoking ffprobe is done two ways: a
//! synchronous `std::process::Command` path (used directly by integration
//! tests against the real staged binary, and available as a library
//! function), and, in production, the async Tauri sidecar API in
//! `commands.rs` (kept out of this module so it stays free of Tauri types).

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipInfo {
    pub path: String,
    pub name: String,
    pub duration_secs: Option<f64>,
}

/// True for files this tool treats as GoPro-style clips: `.mp4`/`.MP4`,
/// not a dotfile. Mirrors the filter in `concatenation_thread.py`.
pub fn is_clip_file(file_name: &str) -> bool {
    if file_name.starts_with('.') {
        return false;
    }
    file_name.to_ascii_lowercase().ends_with(".mp4")
}

/// Lists clip file paths in `dir`, filtered and sorted (the order they'll
/// be concatenated in). Skips zero-byte files, matching the original's
/// `os.path.getsize(...) > 0` guard.
pub fn scan_clip_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|e| format!("cannot read directory {}: {e}", dir.display()))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.metadata().map(|m| m.len() > 0).unwrap_or(false)
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .map(is_clip_file)
                    .unwrap_or(false)
        })
        .collect();
    entries.sort();
    Ok(entries)
}

/// Runs ffprobe on `file_path` and returns its duration in seconds.
pub fn probe_duration_secs(ffprobe_path: &Path, file_path: &Path) -> Result<f64, String> {
    let output = Command::new(ffprobe_path)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(file_path)
        .output()
        .map_err(|e| format!("failed to run ffprobe: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "ffprobe exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<f64>()
        .map_err(|e| format!("could not parse ffprobe duration output: {e}"))
}

/// Synchronous convenience combining [`scan_clip_files`] and
/// [`probe_duration_secs`] via a real ffprobe binary on disk. Used by
/// integration tests and available for any non-Tauri (e.g. CLI) callers.
pub fn list_clips_sync(ffprobe_path: &Path, dir: &Path) -> Result<Vec<ClipInfo>, String> {
    Ok(scan_clip_files(dir)?
        .into_iter()
        .map(|path| {
            let duration_secs = probe_duration_secs(ffprobe_path, &path).ok();
            ClipInfo {
                name: path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                path: path.to_string_lossy().into_owned(),
                duration_secs,
            }
        })
        .collect())
}

/// Clip boundaries closer than this to a trim point are treated as the trim
/// point itself, so float noise doesn't produce zero-length segments or
/// pointless `inpoint 0.000001` directives.
const BOUNDARY_EPSILON_SECS: f64 = 0.001;

/// One clip's contribution to an export: the part of `path` between
/// `inpoint` and `outpoint` (clip-local seconds; `None` means the clip's own
/// start/end).
#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    pub path: String,
    pub inpoint: Option<f64>,
    pub outpoint: Option<f64>,
    /// How many seconds this segment contributes to the output.
    pub duration_secs: f64,
}

/// Maps a `[start_secs, end_secs)` window on the combined timeline (every
/// clip laid end to end, in order) onto the clips it covers. Clips entirely
/// outside the window are dropped; only the first covered clip can get an
/// inpoint and only the last an outpoint. Cuts are expressed relative to each clip rather than as
/// one offset into a concatenated file, so small per-clip differences
/// between probed and actual durations can't accumulate across clips.
///
/// `None` for either end means the start/end of the whole timeline. Every
/// clip must have a known duration, since an unknown one would shift every
/// later clip's position on the timeline.
pub fn plan_segments(
    clips: &[ClipInfo],
    start_secs: Option<f64>,
    end_secs: Option<f64>,
) -> Result<Vec<Segment>, String> {
    if clips.is_empty() {
        return Err("no clips to export".into());
    }
    let durations = clips
        .iter()
        .map(|c| {
            c.duration_secs
                .ok_or_else(|| format!("could not read the duration of {}", c.name))
        })
        .collect::<Result<Vec<f64>, String>>()?;
    let total: f64 = durations.iter().sum();

    let start = start_secs.unwrap_or(0.0).max(0.0);
    let end = end_secs.unwrap_or(total).min(total);
    if end - start < BOUNDARY_EPSILON_SECS {
        return Err(format!(
            "trim end ({end:.3}s) must be after trim start ({start:.3}s)"
        ));
    }

    let mut segments = Vec::new();
    let mut offset = 0.0;
    for (clip, duration) in clips.iter().zip(durations) {
        let clip_start = offset;
        let clip_end = offset + duration;
        offset = clip_end;

        if clip_end <= start + BOUNDARY_EPSILON_SECS || clip_start >= end - BOUNDARY_EPSILON_SECS {
            continue;
        }

        let local_in = start - clip_start;
        let local_out = end - clip_start;
        let inpoint = (local_in > BOUNDARY_EPSILON_SECS).then_some(local_in);
        let outpoint = (local_out < duration - BOUNDARY_EPSILON_SECS).then_some(local_out);
        segments.push(Segment {
            path: clip.path.clone(),
            inpoint,
            outpoint,
            duration_secs: outpoint.unwrap_or(duration) - inpoint.unwrap_or(0.0),
        });
    }
    Ok(segments)
}

/// Total output length of a planned export, for seeding progress reporting.
pub fn segments_duration_secs(segments: &[Segment]) -> f64 {
    segments.iter().map(|s| s.duration_secs).sum()
}

/// Quotes a path for a concat-demuxer `file` directive. A single quote can't
/// be escaped inside a quoted string, so close the quote, emit an escaped
/// quote, and reopen.
fn quote_concat_path(path: &str) -> String {
    format!("'{}'", path.replace('\'', r"'\''"))
}

/// Writes ffmpeg's concat-demuxer filelist to `filelist_path`: one `file`
/// directive per segment, followed by its `outpoint` if any.
///
/// Inpoints are deliberately *not* written: the demuxer's `inpoint` starts
/// from the preceding keyframe and ffmpeg keeps those extra frames even when
/// re-encoding. Only the first segment can have an inpoint, and since the
/// first file starts at 0 on the filelist's timeline, it's applied instead
/// as an input `-ss` (see [`crate::ffmpeg::args::ExportOptions::seek_secs`]),
/// which is frame-accurate when re-encoding.
pub fn write_filelist(filelist_path: &Path, segments: &[Segment]) -> Result<(), String> {
    let mut file = fs::File::create(filelist_path)
        .map_err(|e| format!("cannot create {}: {e}", filelist_path.display()))?;
    for segment in segments {
        writeln!(file, "file {}", quote_concat_path(&segment.path)).map_err(|e| e.to_string())?;
        if let Some(outpoint) = segment.outpoint {
            writeln!(file, "outpoint {outpoint:.6}").map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// A fresh path in the OS temp directory for an export's filelist (an
/// ffmpeg implementation detail, so it doesn't belong in any folder the
/// user picked).
///
/// The location matters: the concat demuxer resolves each `file` entry
/// against the filelist's own path, and the bundled (2018) ffmpeg doesn't
/// recognize `C:\...` as absolute. If the filelist's path contains a `/`,
/// it prefixes everything up to that slash onto every clip path, producing
/// `C:\out/C:\clips\a.mp4`. `temp_dir()` is a native path (backslashes
/// only on Windows), so clip paths are left as-is.
pub fn temp_filelist_path() -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    std::env::temp_dir().join(format!(
        "eventvideotool-filelist-{}-{}.txt",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use tempfile::tempdir;

    fn write_nonempty(path: &Path) {
        let mut f = File::create(path).unwrap();
        f.write_all(b"fake mp4 bytes").unwrap();
    }

    #[test]
    fn recognizes_mp4_case_insensitively() {
        assert!(is_clip_file("GOPR0001.MP4"));
        assert!(is_clip_file("clip.mp4"));
        assert!(!is_clip_file(".hidden.mp4"));
        assert!(!is_clip_file("readme.txt"));
    }

    #[test]
    fn scan_clip_files_filters_and_sorts() {
        let dir = tempdir().unwrap();
        write_nonempty(&dir.path().join("b.mp4"));
        write_nonempty(&dir.path().join("a.MP4"));
        write_nonempty(&dir.path().join(".skip.mp4"));
        write_nonempty(&dir.path().join("notes.txt"));
        File::create(dir.path().join("empty.mp4")).unwrap(); // zero bytes, skipped

        let files = scan_clip_files(dir.path()).unwrap();
        let names: Vec<&str> = files
            .iter()
            .map(|p| p.file_name().unwrap().to_str().unwrap())
            .collect();
        assert_eq!(names, vec!["a.MP4", "b.mp4"]);
    }

    fn clip(name: &str, duration_secs: Option<f64>) -> ClipInfo {
        ClipInfo {
            path: format!("/clips/{name}"),
            name: name.into(),
            duration_secs,
        }
    }

    /// Timeline: a = [0, 10), b = [10, 30), c = [30, 35)
    fn three_clips() -> Vec<ClipInfo> {
        vec![
            clip("a.mp4", Some(10.0)),
            clip("b.mp4", Some(20.0)),
            clip("c.mp4", Some(5.0)),
        ]
    }

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn plan_without_trim_uses_every_clip_whole() {
        let segments = plan_segments(&three_clips(), None, None).unwrap();
        assert_eq!(segments.len(), 3);
        assert!(segments
            .iter()
            .all(|s| s.inpoint.is_none() && s.outpoint.is_none()));
        assert!(approx(segments_duration_secs(&segments), 35.0));
    }

    #[test]
    fn plan_trim_within_one_clip_sets_both_points_on_that_clip() {
        let segments = plan_segments(&three_clips(), Some(12.0), Some(25.0)).unwrap();
        assert_eq!(
            segments,
            vec![Segment {
                path: "/clips/b.mp4".into(),
                inpoint: Some(2.0),
                outpoint: Some(15.0),
                duration_secs: 13.0,
            }]
        );
    }

    #[test]
    fn plan_trim_spanning_clips_cuts_first_and_last_only() {
        let segments = plan_segments(&three_clips(), Some(4.0), Some(32.0)).unwrap();
        let points: Vec<_> = segments.iter().map(|s| (s.inpoint, s.outpoint)).collect();
        assert_eq!(
            points,
            vec![(Some(4.0), None), (None, None), (None, Some(2.0))]
        );
        assert!(approx(segments_duration_secs(&segments), 28.0));
    }

    #[test]
    fn plan_drops_clips_that_only_touch_the_window_at_a_boundary() {
        // Exactly b's span: a ends at 10 and c starts at 30, so neither is included.
        let segments = plan_segments(&three_clips(), Some(10.0), Some(30.0)).unwrap();
        assert_eq!(
            segments,
            vec![Segment {
                path: "/clips/b.mp4".into(),
                inpoint: None,
                outpoint: None,
                duration_secs: 20.0,
            }]
        );
    }

    #[test]
    fn plan_clamps_window_to_timeline() {
        let segments = plan_segments(&three_clips(), Some(-5.0), Some(500.0)).unwrap();
        assert_eq!(segments.len(), 3);
        assert!(approx(segments_duration_secs(&segments), 35.0));
    }

    #[test]
    fn plan_rejects_empty_or_inverted_window() {
        assert!(plan_segments(&three_clips(), Some(20.0), Some(20.0)).is_err());
        assert!(plan_segments(&three_clips(), Some(20.0), Some(5.0)).is_err());
    }

    #[test]
    fn plan_rejects_unknown_durations() {
        let clips = vec![clip("a.mp4", Some(10.0)), clip("b.mp4", None)];
        let err = plan_segments(&clips, None, None).unwrap_err();
        assert!(err.contains("b.mp4"), "unexpected error: {err}");
    }

    #[test]
    fn plan_rejects_no_clips() {
        assert!(plan_segments(&[], None, None).is_err());
    }

    #[test]
    fn write_filelist_emits_file_and_outpoint_directives_only() {
        let dir = tempdir().unwrap();
        let segments = vec![
            Segment {
                path: "/clips/a.mp4".into(),
                inpoint: Some(4.5),
                outpoint: None,
                duration_secs: 5.5,
            },
            Segment {
                path: "/clips/b.mp4".into(),
                inpoint: None,
                outpoint: Some(2.0),
                duration_secs: 2.0,
            },
        ];
        let filelist_path = dir.path().join("filelist.txt");
        write_filelist(&filelist_path, &segments).unwrap();
        let contents = fs::read_to_string(filelist_path).unwrap();
        assert_eq!(
            contents,
            "file '/clips/a.mp4'\nfile '/clips/b.mp4'\noutpoint 2.000000\n"
        );
    }

    #[test]
    fn temp_filelist_paths_are_unique_and_native() {
        let a = temp_filelist_path();
        let b = temp_filelist_path();
        assert_ne!(a, b);
        assert!(a.starts_with(std::env::temp_dir()));
        if cfg!(windows) {
            assert!(!a.to_string_lossy().contains('/'), "{}", a.display());
        }
    }

    #[test]
    fn concat_paths_escape_single_quotes() {
        assert_eq!(quote_concat_path("/a/it's.mp4"), r"'/a/it'\''s.mp4'");
    }
}
