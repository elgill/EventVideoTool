//! Pure functions that build ffmpeg CLI argument lists. Kept free of any
//! process-spawning or Tauri types so they're trivial to unit test; the
//! runner module is responsible for actually executing them.

use std::path::Path;

/// Options for the trim / mute / re-encode step (port of `process_thread.py`).
pub struct ProcessOptions<'a> {
    pub input_file: &'a str,
    pub output_file: &'a str,
    pub start_time: Option<&'a str>,
    pub end_time: Option<&'a str>,
    pub mute: bool,
    pub re_encode: bool,
    pub hw_acceleration: bool,
    /// Hardware encoder name (e.g. "h264_videotoolbox"), if one was detected
    /// and should be used. Passed in rather than detected here so this stays
    /// pure and testable.
    pub hw_encoder: Option<&'a str>,
}

/// Builds the ffmpeg args (excluding the binary path itself) for trimming,
/// muting, and/or re-encoding a single video.
pub fn build_process_args(opts: &ProcessOptions) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    if opts.hw_acceleration {
        args.push("-hwaccel".into());
        args.push("auto".into());
    }

    args.push("-i".into());
    args.push(opts.input_file.into());

    if let (Some(start), Some(end)) = (opts.start_time, opts.end_time) {
        args.push("-ss".into());
        args.push(start.into());
        args.push("-to".into());
        args.push(end.into());
    }

    if opts.re_encode {
        match (opts.hw_encoder, opts.hw_acceleration) {
            (Some(encoder), true) => {
                args.push("-c:v".into());
                args.push(encoder.into());
            }
            _ => {
                args.push("-c:v".into());
                args.push("libx264".into());
            }
        }
        args.push("-preset".into());
        args.push("fast".into());
        args.push("-b:v".into());
        args.push("5M".into());
    } else {
        args.push("-c:v".into());
        args.push("copy".into());
    }

    if opts.mute {
        args.push("-an".into());
    }

    args.push("-y".into());
    args.push(opts.output_file.into());

    args
}

/// Builds the ffmpeg args for concatenating a filelist produced by
/// [`crate::clips::write_concat_filelist`].
pub fn build_concat_args(filelist_path: &Path, output_file: &str) -> Vec<String> {
    vec![
        "-f".into(),
        "concat".into(),
        "-safe".into(),
        "0".into(),
        "-hwaccel".into(),
        "auto".into(),
        "-i".into(),
        filelist_path.to_string_lossy().into_owned(),
        "-c".into(),
        "copy".into(),
        output_file.into(),
        "-y".into(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_opts<'a>() -> ProcessOptions<'a> {
        ProcessOptions {
            input_file: "in.mp4",
            output_file: "out.mp4",
            start_time: None,
            end_time: None,
            mute: false,
            re_encode: false,
            hw_acceleration: false,
            hw_encoder: None,
        }
    }

    #[test]
    fn copy_codec_when_not_re_encoding() {
        let args = build_process_args(&base_opts());
        assert_eq!(args, vec!["-i", "in.mp4", "-c:v", "copy", "-y", "out.mp4"]);
    }

    #[test]
    fn adds_trim_window_when_both_times_set() {
        let mut opts = base_opts();
        opts.start_time = Some("00:00:05");
        opts.end_time = Some("00:00:15");
        let args = build_process_args(&opts);
        assert_eq!(
            args,
            vec![
                "-i", "in.mp4", "-ss", "00:00:05", "-to", "00:00:15", "-c:v", "copy", "-y",
                "out.mp4"
            ]
        );
    }

    #[test]
    fn omits_trim_window_when_only_start_set() {
        let mut opts = base_opts();
        opts.start_time = Some("00:00:05");
        let args = build_process_args(&opts);
        assert!(!args.contains(&"-ss".to_string()));
    }

    #[test]
    fn re_encode_uses_libx264_without_hw_acceleration() {
        let mut opts = base_opts();
        opts.re_encode = true;
        let args = build_process_args(&opts);
        assert_eq!(
            args,
            vec![
                "-i", "in.mp4", "-c:v", "libx264", "-preset", "fast", "-b:v", "5M", "-y", "out.mp4"
            ]
        );
    }

    #[test]
    fn re_encode_uses_hw_encoder_when_available_and_requested() {
        let mut opts = base_opts();
        opts.re_encode = true;
        opts.hw_acceleration = true;
        opts.hw_encoder = Some("h264_videotoolbox");
        let args = build_process_args(&opts);
        assert_eq!(
            args,
            vec![
                "-hwaccel",
                "auto",
                "-i",
                "in.mp4",
                "-c:v",
                "h264_videotoolbox",
                "-preset",
                "fast",
                "-b:v",
                "5M",
                "-y",
                "out.mp4"
            ]
        );
    }

    #[test]
    fn re_encode_falls_back_to_libx264_when_hw_acceleration_off_even_with_encoder() {
        let mut opts = base_opts();
        opts.re_encode = true;
        opts.hw_acceleration = false;
        opts.hw_encoder = Some("h264_videotoolbox");
        let args = build_process_args(&opts);
        assert!(args.contains(&"libx264".to_string()));
        assert!(!args.contains(&"h264_videotoolbox".to_string()));
    }

    #[test]
    fn mute_adds_an_flag() {
        let mut opts = base_opts();
        opts.mute = true;
        let args = build_process_args(&opts);
        assert!(args.contains(&"-an".to_string()));
    }

    #[test]
    fn concat_args_reference_filelist_and_output() {
        let args = build_concat_args(Path::new("/tmp/filelist.txt"), "/tmp/out.mp4");
        assert_eq!(
            args,
            vec![
                "-f",
                "concat",
                "-safe",
                "0",
                "-hwaccel",
                "auto",
                "-i",
                "/tmp/filelist.txt",
                "-c",
                "copy",
                "/tmp/out.mp4",
                "-y"
            ]
        );
    }
}
