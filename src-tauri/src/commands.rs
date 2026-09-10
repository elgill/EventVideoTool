//! `#[tauri::command]` handlers exposed to the Angular frontend. Kept thin:
//! business logic lives in `clips`, `hwaccel`, and `ffmpeg::*`, which are
//! independently unit tested.

use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

use crate::clips::{self, ClipInfo};
use crate::ffmpeg::args::{build_concat_args, build_process_args, ProcessOptions};
use crate::ffmpeg::progress::compute_trimmed_duration;
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

/// Concatenates every clip in `clip_dir` into `output_file`, emitting
/// `ffmpeg-progress`/`ffmpeg-finished` events as it runs.
#[tauri::command]
pub async fn concat_clips(
    app: AppHandle,
    clip_dir: String,
    output_file: String,
) -> Result<(), String> {
    let dir_path = PathBuf::from(&clip_dir);
    let clip_infos = probed_clip_infos(&app, &dir_path).await?;
    if clip_infos.is_empty() {
        return Err(format!("no .mp4 clips found in {clip_dir}"));
    }

    let filelist_path = clips::write_filelist(&dir_path, &clip_infos)?;
    let total_duration = clips::total_duration_secs(&clip_infos);

    let args = build_concat_args(&filelist_path, &output_file);
    run_ffmpeg(&app, "concat", args, total_duration).await
}

/// Trims/mutes/re-encodes `input_file` into `output_file`, emitting
/// `ffmpeg-progress`/`ffmpeg-finished` events as it runs. `start_time` and
/// `end_time` are only honored (and only need to be provided) as a pair, as
/// `HH:MM:SS`/`MM:SS`/`SS` strings; omit both to process the whole file.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn process_video(
    app: AppHandle,
    input_file: String,
    output_file: String,
    start_time: Option<String>,
    end_time: Option<String>,
    mute: bool,
    re_encode: bool,
    hw_acceleration: bool,
) -> Result<(), String> {
    let full_duration = probe_duration(&app, Path::new(&input_file))
        .await
        .unwrap_or(0.0);
    let trimmed_duration =
        compute_trimmed_duration(full_duration, start_time.as_deref(), end_time.as_deref())?;

    let hw_encoder = if hw_acceleration {
        detect_hardware_encoder()
    } else {
        None
    };

    let opts = ProcessOptions {
        input_file: &input_file,
        output_file: &output_file,
        start_time: start_time.as_deref(),
        end_time: end_time.as_deref(),
        mute,
        re_encode,
        hw_acceleration,
        hw_encoder: hw_encoder.as_deref(),
    };
    let args = build_process_args(&opts);
    run_ffmpeg(&app, "process", args, trimmed_duration).await
}
