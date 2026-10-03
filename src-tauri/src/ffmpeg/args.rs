//! Pure functions that build ffmpeg CLI argument lists. Kept free of any
//! process-spawning or Tauri types so they're trivial to unit test; the
//! runner module is responsible for actually executing them.

use std::path::Path;

/// Options for exporting the trimmed clip timeline in a single pass (the
/// combined port of `concatenation_thread.py` and `process_thread.py`).
pub struct ExportOptions<'a> {
    /// Concat-demuxer filelist from [`crate::clips::write_filelist`]; the
    /// trim end is already encoded in it as an `outpoint` directive.
    pub filelist_path: &'a Path,
    /// The first segment's inpoint, applied as an input `-ss` on the concat
    /// demuxer (see [`crate::clips::write_filelist`] for why).
    pub seek_secs: Option<f64>,
    pub output_file: &'a str,
    pub mute: bool,
    pub re_encode: bool,
    pub hw_acceleration: bool,
    /// Hardware encoder name (e.g. "h264_videotoolbox"), if one was detected
    /// and should be used. Passed in rather than detected here so this stays
    /// pure and testable.
    pub hw_encoder: Option<&'a str>,
}

/// Builds the ffmpeg args (excluding the binary path itself) for
/// concatenating, trimming, muting, and/or re-encoding the clips listed in
/// a filelist into one output file.
pub fn build_export_args(opts: &ExportOptions) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    if opts.hw_acceleration {
        args.push("-hwaccel".into());
        args.push("auto".into());
    }

    if let Some(seek) = opts.seek_secs {
        args.push("-ss".into());
        args.push(format!("{seek:.6}"));
    }

    args.push("-f".into());
    args.push("concat".into());
    args.push("-safe".into());
    args.push("0".into());
    args.push("-i".into());
    args.push(opts.filelist_path.to_string_lossy().into_owned());

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
    } else if !opts.re_encode {
        args.push("-c:a".into());
        args.push("copy".into());
    }

    args.push("-y".into());
    args.push(opts.output_file.into());

    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_opts<'a>() -> ExportOptions<'a> {
        ExportOptions {
            filelist_path: Path::new("list.txt"),
            seek_secs: None,
            output_file: "out.mp4",
            mute: false,
            re_encode: false,
            hw_acceleration: false,
            hw_encoder: None,
        }
    }

    #[test]
    fn stream_copies_everything_when_not_re_encoding() {
        let args = build_export_args(&base_opts());
        assert_eq!(
            args,
            vec![
                "-f", "concat", "-safe", "0", "-i", "list.txt", "-c:v", "copy", "-c:a", "copy",
                "-y", "out.mp4"
            ]
        );
    }

    #[test]
    fn seek_is_an_input_option_on_the_concat_demuxer() {
        let mut opts = base_opts();
        opts.seek_secs = Some(4.5);
        let args = build_export_args(&opts);
        assert_eq!(
            &args[..8],
            ["-ss", "4.500000", "-f", "concat", "-safe", "0", "-i", "list.txt"]
        );
    }

    #[test]
    fn re_encode_uses_libx264_without_hw_acceleration() {
        let mut opts = base_opts();
        opts.re_encode = true;
        let args = build_export_args(&opts);
        assert_eq!(
            args,
            vec![
                "-f", "concat", "-safe", "0", "-i", "list.txt", "-c:v", "libx264", "-preset",
                "fast", "-b:v", "5M", "-y", "out.mp4"
            ]
        );
    }

    #[test]
    fn re_encode_uses_hw_encoder_when_available_and_requested() {
        let mut opts = base_opts();
        opts.re_encode = true;
        opts.hw_acceleration = true;
        opts.hw_encoder = Some("h264_videotoolbox");
        let args = build_export_args(&opts);
        assert_eq!(
            args,
            vec![
                "-hwaccel",
                "auto",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                "list.txt",
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
        let args = build_export_args(&opts);
        assert!(args.contains(&"libx264".to_string()));
        assert!(!args.contains(&"h264_videotoolbox".to_string()));
    }

    #[test]
    fn mute_drops_audio_instead_of_copying_it() {
        let mut opts = base_opts();
        opts.mute = true;
        let args = build_export_args(&opts);
        assert!(args.contains(&"-an".to_string()));
        assert!(!args.contains(&"-c:a".to_string()));
    }
}
