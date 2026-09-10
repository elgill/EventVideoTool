//! Directory scanning + ffprobe duration lookups (port of the file-discovery
//! half of `concatenation_thread.py`), and serializable types shared with
//! the Angular frontend.
//!
//! Directory scanning/filtering/sorting and filelist writing are pure and
//! fully unit tested here. Actually invoking ffprobe is done two ways: a
//! synchronous `std::process::Command` path (used directly by integration
//! tests against the real staged binary, and available as a library
//! function), and, in production, the async Tauri sidecar API in
//! `commands.rs` (kept out of this module so it stays free of Tauri types).

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
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

/// Writes ffmpeg's concat-demuxer filelist listing every given clip, in
/// order. Port of the filelist construction in `concatenation_thread.py`.
pub fn write_filelist(dir: &Path, clips: &[ClipInfo]) -> Result<PathBuf, String> {
    let filelist_path = dir.join("filelist.txt");
    let mut file = fs::File::create(&filelist_path)
        .map_err(|e| format!("cannot create {}: {e}", filelist_path.display()))?;
    for clip in clips {
        writeln!(file, "file '{}'", clip.path).map_err(|e| e.to_string())?;
    }
    Ok(filelist_path)
}

/// Sums the known durations of a clip list (unknown durations count as 0,
/// same as the original's `except Exception` swallow-and-continue).
pub fn total_duration_secs(clips: &[ClipInfo]) -> f64 {
    clips.iter().filter_map(|c| c.duration_secs).sum()
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

    #[test]
    fn write_filelist_quotes_each_path() {
        let dir = tempdir().unwrap();
        let clips = vec![
            ClipInfo {
                path: dir.path().join("a.mp4").to_string_lossy().into_owned(),
                name: "a.mp4".into(),
                duration_secs: Some(1.0),
            },
            ClipInfo {
                path: dir.path().join("b.mp4").to_string_lossy().into_owned(),
                name: "b.mp4".into(),
                duration_secs: Some(2.0),
            },
        ];
        let filelist_path = write_filelist(dir.path(), &clips).unwrap();
        let contents = fs::read_to_string(filelist_path).unwrap();
        assert_eq!(
            contents,
            format!(
                "file '{}'\nfile '{}'\n",
                dir.path().join("a.mp4").display(),
                dir.path().join("b.mp4").display()
            )
        );
    }

    #[test]
    fn total_duration_sums_known_durations_and_skips_unknown() {
        let clips = vec![
            ClipInfo {
                path: "a".into(),
                name: "a".into(),
                duration_secs: Some(10.0),
            },
            ClipInfo {
                path: "b".into(),
                name: "b".into(),
                duration_secs: None,
            },
            ClipInfo {
                path: "c".into(),
                name: "c".into(),
                duration_secs: Some(5.5),
            },
        ];
        assert_eq!(total_duration_secs(&clips), 15.5);
    }
}
