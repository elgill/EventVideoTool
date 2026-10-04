//! Keeps a failed export, above all one that runs out of disk space, from
//! leaving a mess: a free-space check before starting, writing to a
//! `.partial` file that only replaces the chosen output once ffmpeg succeeds,
//! and errors the frontend can show as a plain sentence with ffmpeg's raw
//! output tucked away as details.
//!
//! Everything here is pure or touches only the paths it's given, so it's
//! unit tested directly; `commands::export_video` strings it together.

use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Video bitrate passed to ffmpeg when re-encoding (see `ffmpeg::args`),
/// plus headroom for audio, in bits per second.
const RE_ENCODE_BITS_PER_SEC: f64 = 5_000_000.0 + 256_000.0;
/// Slack on top of the size estimate: container overhead, bitrate overshoot,
/// and not leaving the disk at exactly zero bytes free.
const ESTIMATE_MARGIN: f64 = 1.05;
const ESTIMATE_PADDING_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportErrorKind {
    DiskFull,
    Failed,
}

/// What the frontend gets when an export fails: one sentence to show, and
/// anything technical (ffmpeg's stderr) to keep out of the way.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ExportError {
    pub kind: ExportErrorKind,
    pub message: String,
    pub details: Option<String>,
}

impl ExportError {
    pub fn failed(message: impl Into<String>) -> Self {
        Self {
            kind: ExportErrorKind::Failed,
            message: message.into(),
            details: None,
        }
    }
}

/// One clip's share of an export, for estimating the output size.
pub struct SegmentSource {
    pub file_bytes: u64,
    pub clip_secs: f64,
    pub segment_secs: f64,
}

/// Roughly how big the export will be. Stream copying keeps the source
/// bitrate, so each clip contributes its size in proportion to how much of
/// it is used; re-encoding is governed by the target bitrate instead.
pub fn estimate_output_bytes(sources: &[SegmentSource], re_encode: bool) -> u64 {
    let bytes: f64 = if re_encode {
        let secs: f64 = sources.iter().map(|s| s.segment_secs).sum();
        secs * RE_ENCODE_BITS_PER_SEC / 8.0
    } else {
        sources
            .iter()
            .map(|s| {
                let fraction = if s.clip_secs > 0.0 {
                    (s.segment_secs / s.clip_secs).clamp(0.0, 1.0)
                } else {
                    1.0
                };
                s.file_bytes as f64 * fraction
            })
            .sum()
    };
    bytes.ceil() as u64
}

/// Refuses to start an export that can't fit in `available_bytes`, rather
/// than letting ffmpeg discover it partway through.
pub fn check_free_space(
    estimated_bytes: u64,
    available_bytes: u64,
    location: &Path,
) -> Result<(), ExportError> {
    let needed = (estimated_bytes as f64 * ESTIMATE_MARGIN) as u64 + ESTIMATE_PADDING_BYTES;
    if available_bytes >= needed {
        return Ok(());
    }
    Err(ExportError {
        kind: ExportErrorKind::DiskFull,
        message: format!(
            "Not enough disk space: this export needs about {} but only {} is free in {}. \
             Free up space or choose another location.",
            format_bytes(estimated_bytes),
            format_bytes(available_bytes),
            location.display()
        ),
        details: None,
    })
}

/// Where ffmpeg writes while the export runs: beside the chosen file, so the
/// final rename stays on one volume, e.g. `race.mp4` → `race.partial.mp4`.
pub fn partial_path(output: &Path) -> PathBuf {
    let stem = output
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "export".into());
    let ext = output
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_else(|| "mp4".into());
    output.with_file_name(format!("{stem}.partial.{ext}"))
}

/// Moves a finished export into place, or deletes the partial file of a
/// failed one. Either way the partial file is gone afterwards, and the
/// chosen output is only touched once there's a complete file to replace
/// it with.
pub fn finalize_output(partial: &Path, output: &Path, succeeded: bool) -> Result<(), ExportError> {
    if !succeeded {
        remove_if_present(partial);
        return Ok(());
    }
    fs::rename(partial, output).map_err(|e| {
        remove_if_present(partial);
        let mut err = describe_io_error(&e, output.parent().unwrap_or(output));
        err.message = format!("Couldn't save {}: {}", output.display(), err.message);
        err
    })
}

fn remove_if_present(path: &Path) {
    let _ = fs::remove_file(path);
}

/// True if `text` (ffmpeg stderr or an OS error message) says the disk is
/// full. ffmpeg reports ENOSPC via strerror on every platform; Windows' own
/// wording shows up for errors raised outside ffmpeg.
pub fn mentions_disk_full(text: &str) -> bool {
    let text = text.to_ascii_lowercase();
    [
        "no space left on device",
        "not enough space on the disk",
        "disk quota exceeded",
        "enospc",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}

/// Turns ffmpeg's failure output into something worth showing.
pub fn describe_ffmpeg_failure(raw: &str, output_dir: &Path) -> ExportError {
    if mentions_disk_full(raw) {
        ExportError {
            kind: ExportErrorKind::DiskFull,
            message: format!(
                "Ran out of disk space while exporting to {}. The incomplete file was removed; \
                 free up space or choose another location, then try again.",
                output_dir.display()
            ),
            details: Some(raw.trim().to_string()),
        }
    } else {
        ExportError {
            kind: ExportErrorKind::Failed,
            message: "ffmpeg couldn't finish the export.".into(),
            details: Some(raw.trim().to_string()),
        }
    }
}

/// For failing to write the small temporary filelist ffmpeg reads, which
/// lives in the OS temp folder (usually on C:, not the export's drive).
pub fn describe_temp_file_failure(message: String, temp_dir: &Path) -> ExportError {
    if mentions_disk_full(&message) {
        ExportError {
            kind: ExportErrorKind::DiskFull,
            message: format!(
                "Ran out of disk space in {} (needed for a small temporary file). \
                 Free up space there and try again.",
                temp_dir.display()
            ),
            details: Some(message),
        }
    } else {
        ExportError::failed(message)
    }
}

/// Same idea for errors from our own file operations.
pub fn describe_io_error(err: &io::Error, location: &Path) -> ExportError {
    if err.kind() == io::ErrorKind::StorageFull || mentions_disk_full(&err.to_string()) {
        ExportError {
            kind: ExportErrorKind::DiskFull,
            message: format!(
                "Ran out of disk space in {}. Free up space and try again.",
                location.display()
            ),
            details: Some(err.to_string()),
        }
    } else {
        ExportError {
            kind: ExportErrorKind::Failed,
            message: err.to_string(),
            details: None,
        }
    }
}

pub fn format_bytes(bytes: u64) -> String {
    let b = bytes as f64;
    if b >= 1e9 {
        format!("{:.1} GB", b / 1e9)
    } else if b >= 1e6 {
        format!("{:.0} MB", b / 1e6)
    } else {
        format!("{:.0} KB", (b / 1e3).max(1.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn source(file_bytes: u64, clip_secs: f64, segment_secs: f64) -> SegmentSource {
        SegmentSource {
            file_bytes,
            clip_secs,
            segment_secs,
        }
    }

    #[test]
    fn estimates_stream_copy_from_the_used_share_of_each_clip() {
        let sources = [
            source(1_000_000_000, 100.0, 50.0),  // second half of a 1 GB clip
            source(2_000_000_000, 200.0, 200.0), // all of a 2 GB clip
        ];
        assert_eq!(estimate_output_bytes(&sources, false), 2_500_000_000);
    }

    #[test]
    fn estimates_re_encode_from_the_target_bitrate() {
        let sources = [source(9_999, 100.0, 80.0)];
        let expected = (80.0 * RE_ENCODE_BITS_PER_SEC / 8.0) as u64;
        assert_eq!(estimate_output_bytes(&sources, true), expected);
    }

    #[test]
    fn free_space_check_passes_with_room_to_spare() {
        assert!(check_free_space(1_000_000_000, 2_000_000_000, Path::new("D:\\")).is_ok());
    }

    #[test]
    fn free_space_check_refuses_when_the_export_wont_fit() {
        let err =
            check_free_space(4_200_000_000, 1_100_000_000, Path::new("D:\\Exports")).unwrap_err();
        assert_eq!(err.kind, ExportErrorKind::DiskFull);
        assert!(err.message.contains("about 4.2 GB"), "{}", err.message);
        assert!(
            err.message.contains("only 1.1 GB is free"),
            "{}",
            err.message
        );
        assert!(err.message.contains("D:\\Exports"), "{}", err.message);
    }

    #[test]
    fn free_space_check_leaves_a_margin() {
        // Exactly enough bytes isn't enough: the estimate is only an estimate.
        assert!(check_free_space(1_000_000_000, 1_000_000_000, Path::new("/")).is_err());
    }

    #[test]
    fn partial_file_sits_beside_the_output() {
        assert_eq!(
            partial_path(Path::new("/out/race day.mp4")),
            PathBuf::from("/out/race day.partial.mp4")
        );
        assert_eq!(
            partial_path(Path::new("/out/race")),
            PathBuf::from("/out/race.partial.mp4")
        );
    }

    #[test]
    fn success_moves_the_partial_file_over_the_output() {
        let dir = tempdir().unwrap();
        let output = dir.path().join("race.mp4");
        let partial = partial_path(&output);
        fs::write(&output, b"old export").unwrap();
        fs::write(&partial, b"new export").unwrap();

        finalize_output(&partial, &output, true).unwrap();

        assert_eq!(fs::read(&output).unwrap(), b"new export");
        assert!(!partial.exists());
    }

    #[test]
    fn failure_removes_the_partial_file_and_keeps_an_existing_output() {
        let dir = tempdir().unwrap();
        let output = dir.path().join("race.mp4");
        let partial = partial_path(&output);
        fs::write(&output, b"previous good export").unwrap();
        fs::write(&partial, b"truncated garbage").unwrap();

        finalize_output(&partial, &output, false).unwrap();

        assert!(!partial.exists());
        assert_eq!(fs::read(&output).unwrap(), b"previous good export");
    }

    #[test]
    fn failure_before_any_output_was_written_is_fine() {
        let dir = tempdir().unwrap();
        let output = dir.path().join("race.mp4");
        finalize_output(&partial_path(&output), &output, false).unwrap();
        assert!(!output.exists());
    }

    #[test]
    fn recognizes_disk_full_wording() {
        // What ffmpeg prints when a write hits ENOSPC.
        assert!(mentions_disk_full(
            "av_interleaved_write_frame(): No space left on device\n\
             Error writing trailer of out.mp4: No space left on device"
        ));
        // Windows' own message (ERROR_DISK_FULL, os error 112).
        assert!(mentions_disk_full(
            "There is not enough space on the disk. (os error 112)"
        ));
        assert!(!mentions_disk_full(
            "Invalid data found when processing input"
        ));
    }

    #[test]
    fn describes_a_disk_full_ffmpeg_failure_plainly() {
        let raw = "export failed (exit code Some(1)): av_interleaved_write_frame(): \
                   No space left on device";
        let err = describe_ffmpeg_failure(raw, Path::new("D:\\Exports"));
        assert_eq!(err.kind, ExportErrorKind::DiskFull);
        assert!(err.message.starts_with("Ran out of disk space"));
        assert!(err.message.contains("D:\\Exports"));
        assert_eq!(err.details.as_deref(), Some(raw));
    }

    #[test]
    fn keeps_other_ffmpeg_failures_generic() {
        let err = describe_ffmpeg_failure("moov atom not found", Path::new("/out"));
        assert_eq!(err.kind, ExportErrorKind::Failed);
        assert_eq!(err.details.as_deref(), Some("moov atom not found"));
    }

    #[test]
    fn describes_a_full_temp_folder() {
        let err = describe_temp_file_failure(
            r"cannot create C:\Temp\list.txt: There is not enough space on the disk. (os error 112)"
                .into(),
            Path::new(r"C:\Temp"),
        );
        assert_eq!(err.kind, ExportErrorKind::DiskFull);
        assert!(err.message.contains("temporary file"));
        assert_eq!(
            describe_temp_file_failure("access denied".into(), Path::new("/tmp")).kind,
            ExportErrorKind::Failed
        );
    }

    #[test]
    fn describes_io_storage_full_errors() {
        let err = describe_io_error(
            &io::Error::new(io::ErrorKind::StorageFull, "disk full"),
            Path::new("C:\\Temp"),
        );
        assert_eq!(err.kind, ExportErrorKind::DiskFull);
        assert!(err.message.contains("C:\\Temp"));

        let windows = io::Error::from_raw_os_error(112);
        if cfg!(windows) {
            assert_eq!(
                describe_io_error(&windows, Path::new("C:\\")).kind,
                ExportErrorKind::DiskFull
            );
        }
    }

    #[test]
    fn serializes_for_the_frontend() {
        let json = serde_json::to_value(ExportError::failed("nope")).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "failed", "message": "nope", "details": null })
        );
    }
}
