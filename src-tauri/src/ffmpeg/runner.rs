//! Spawns the bundled ffmpeg sidecar and streams progress back to the
//! frontend as Tauri events, replacing the QThread + pyqtSignal plumbing of
//! `process_thread.py`/`concatenation_thread.py`.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use super::progress::ProgressParser;

pub const PROGRESS_EVENT: &str = "ffmpeg-progress";
pub const FINISHED_EVENT: &str = "ffmpeg-finished";

/// How much stderr to retain for an error message if ffmpeg fails.
const STDERR_TAIL_LIMIT: usize = 4000;

#[derive(Clone, Serialize)]
pub struct ProgressEvent {
    pub operation: String,
    pub percentage: f64,
    pub speed: f64,
    pub eta_secs: Option<f64>,
    pub estimated_size_bytes: Option<f64>,
}

#[derive(Clone, Serialize)]
pub struct FinishedEvent {
    pub operation: String,
    pub success: bool,
    pub message: String,
}

/// Runs the `ffmpeg` sidecar with `args`, emitting [`PROGRESS_EVENT`] as it
/// reports progress and [`FINISHED_EVENT`] once it exits. `duration_secs`
/// seeds the progress parser so percentage/ETA can be computed (pass `0.0`
/// if unknown; percentage will then simply stay at 0 until completion).
pub async fn run_ffmpeg<R: Runtime>(
    app: &AppHandle<R>,
    operation: &str,
    args: Vec<String>,
    duration_secs: f64,
) -> Result<(), String> {
    let (mut rx, _child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("could not resolve bundled ffmpeg: {e}"))?
        .args(args)
        .spawn()
        .map_err(|e| format!("could not start ffmpeg: {e}"))?;

    let mut parser = ProgressParser::new(duration_secs);
    let mut exit_code: Option<i32> = None;
    let mut stderr_tail = String::new();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes);
                if let Some(snapshot) = parser.feed_line(&line) {
                    let _ = app.emit(
                        PROGRESS_EVENT,
                        ProgressEvent {
                            operation: operation.to_string(),
                            percentage: snapshot.percentage,
                            speed: snapshot.speed,
                            eta_secs: snapshot.eta_secs,
                            estimated_size_bytes: snapshot.estimated_size_bytes,
                        },
                    );
                }
            }
            CommandEvent::Stderr(bytes) => {
                stderr_tail.push_str(&String::from_utf8_lossy(&bytes));
                stderr_tail.push('\n');
                if stderr_tail.len() > STDERR_TAIL_LIMIT {
                    let excess = stderr_tail.len() - STDERR_TAIL_LIMIT;
                    stderr_tail.drain(0..excess);
                }
            }
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
            }
            CommandEvent::Error(err) => {
                stderr_tail.push_str(&err);
                stderr_tail.push('\n');
            }
            _ => {}
        }
    }

    let success = exit_code == Some(0);
    let message = if success {
        format!("{operation} completed successfully!")
    } else {
        format!(
            "{operation} failed (exit code {:?}): {}",
            exit_code,
            stderr_tail.trim()
        )
    };

    let _ = app.emit(
        FINISHED_EVENT,
        FinishedEvent {
            operation: operation.to_string(),
            success,
            message: message.clone(),
        },
    );

    if success {
        Ok(())
    } else {
        Err(message)
    }
}
