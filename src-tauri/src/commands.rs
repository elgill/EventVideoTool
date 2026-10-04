//! `#[tauri::command]` handlers exposed to the Angular frontend. Kept thin:
//! business logic lives in `clips`, `hwaccel`, and `ffmpeg::*`, which are
//! independently unit tested.

use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

use crate::clips::{self, ClipInfo, Segment};
use crate::export::{self, ExportError, SegmentSource};
use crate::ffmpeg::args::{build_export_args, ExportOptions};
use crate::ffmpeg::runner::run_ffmpeg;
use crate::hwaccel::detect_hardware_encoder;

#[tauri::command]
pub fn detect_hw_encoder() -> Option<String> {
    detect_hardware_encoder()
}

/// Runs the bundled ffprobe sidecar against a single file and returns its
/// duration in seconds.
async fn probe_duration(app: &AppHandle, file_path: &Path) -> Result<f64, String> {
    let output = app
        .shell()
        .sidecar("ffprobe")
        .map_err(|e| format!("could not resolve bundled ffprobe: {e}"))?
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(file_path.to_string_lossy().into_owned())
        .output()
        .await
        .map_err(|e| format!("could not run ffprobe: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "ffprobe failed for {}: {}",
            file_path.display(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<f64>()
        .map_err(|e| format!("could not parse ffprobe output: {e}"))
}

async fn probed_clip_infos(app: &AppHandle, dir: &Path) -> Result<Vec<ClipInfo>, String> {
    let files = clips::scan_clip_files(dir)?;
    let mut result = Vec::with_capacity(files.len());
    for path in files {
        let duration_secs = probe_duration(app, &path).await.ok();
        result.push(ClipInfo {
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path: path.to_string_lossy().into_owned(),
            duration_secs,
        });
    }
    Ok(result)
}

/// Lists the clips in `dir` (sorted, filtered to non-empty `.mp4` files)
/// with their durations, for the clip-list panel.
#[tauri::command]
pub async fn list_clips(app: AppHandle, dir: String) -> Result<Vec<ClipInfo>, String> {
    probed_clip_infos(&app, &PathBuf::from(dir)).await
}

/// Concatenates, trims, mutes, and/or re-encodes `clips` into `output_file`
/// in one ffmpeg pass, emitting `ffmpeg-progress`/`ffmpeg-finished` events
/// as it runs.
///
/// Fails fast if the destination clearly lacks the space, and writes to a
/// `.partial` file that only replaces `output_file` on success, so running
/// out of space (or any other failure) never leaves a truncated video
/// behind or destroys a file the user chose to overwrite.
///
/// `clips` is the list the frontend's timeline was built from (as returned
/// by `list_clips`), so `start_secs`/`end_secs` — positions on that combined
/// timeline — map onto exactly the clips and durations the user saw. Omit
/// either to export from the start / to the end.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn export_video(
    app: AppHandle,
    clips: Vec<ClipInfo>,
    output_file: String,
    start_secs: Option<f64>,
    end_secs: Option<f64>,
    mute: bool,
    re_encode: bool,
    hw_acceleration: bool,
) -> Result<(), ExportError> {
    let segments =
        clips::plan_segments(&clips, start_secs, end_secs).map_err(ExportError::failed)?;

    let output_path = PathBuf::from(&output_file);
    let output_dir = output_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."))
        .to_path_buf();
    // If free space can't be read, let the export try rather than block it.
    if let Ok(available) = fs4::available_space(&output_dir) {
        let estimate =
            export::estimate_output_bytes(&segment_sources(&clips, &segments), re_encode);
        export::check_free_space(estimate, available, &output_dir)?;
    }

    let filelist_path = clips::temp_filelist_path();
    clips::write_filelist(&filelist_path, &segments).map_err(|e| {
        let _ = std::fs::remove_file(&filelist_path);
        export::describe_temp_file_failure(e, &std::env::temp_dir())
    })?;
    let partial_path = export::partial_path(&output_path);
    let partial_file = partial_path.to_string_lossy().into_owned();

    let hw_encoder = if hw_acceleration {
        detect_hardware_encoder()
    } else {
        None
    };

    let opts = ExportOptions {
        filelist_path: &filelist_path,
        seek_secs: segments[0].inpoint,
        output_file: &partial_file,
        mute,
        re_encode,
        hw_acceleration,
        hw_encoder: hw_encoder.as_deref(),
    };
    let args = build_export_args(&opts);
    let result = run_ffmpeg(
        &app,
        "export",
        args,
        clips::segments_duration_secs(&segments),
    )
    .await;
    let _ = std::fs::remove_file(&filelist_path);

    export::finalize_output(&partial_path, &output_path, result.is_ok())?;
    result.map_err(|raw| export::describe_ffmpeg_failure(&raw, &output_dir))
}

/// Pairs each planned segment with its source file's size and full length,
/// for estimating the export's size. Unreadable sizes count as zero, which
/// only makes the estimate more lenient.
fn segment_sources(clips: &[ClipInfo], segments: &[Segment]) -> Vec<SegmentSource> {
    segments
        .iter()
        .map(|segment| {
            let clip_secs = clips
                .iter()
                .find(|c| c.path == segment.path)
                .and_then(|c| c.duration_secs)
                .unwrap_or(segment.duration_secs);
            SegmentSource {
                file_bytes: std::fs::metadata(&segment.path)
                    .map(|m| m.len())
                    .unwrap_or(0),
                clip_secs,
                segment_secs: segment.duration_secs,
            }
        })
        .collect()
}
