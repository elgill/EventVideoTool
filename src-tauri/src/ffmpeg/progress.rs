//! Parses ffmpeg's `-progress pipe:1 -nostats` machine-readable output
//! (repeated `key=value` lines) into incremental progress snapshots, and the
//! small time-string helpers needed to figure out how long a trimmed clip
//! will be before ffmpeg tells us.

/// A point-in-time read of an in-progress ffmpeg run. Mirrors what the
/// original Python `FfmpegWrapper._update_progress` reported to its
/// progress_handler callback.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ProgressSnapshot {
    pub percentage: f64,
    pub speed: f64,
    pub eta_secs: Option<f64>,
    pub estimated_size_bytes: Option<f64>,
}

impl Default for ProgressSnapshot {
    fn default() -> Self {
        Self {
            percentage: 0.0,
            speed: 0.0,
            eta_secs: None,
            estimated_size_bytes: None,
        }
    }
}

pub struct ProgressParser {
    duration_secs: f64,
    can_get_duration: bool,
    current_size: Option<f64>,
    seconds_processed: f64,
    state: ProgressSnapshot,
}

impl ProgressParser {
    pub fn new(duration_secs: f64) -> Self {
        let can_get_duration = duration_secs > 0.0;
        Self {
            duration_secs,
            can_get_duration,
            current_size: None,
            seconds_processed: 0.0,
            state: ProgressSnapshot::default(),
        }
    }

    /// Feed one line of ffmpeg's `-progress` output. Returns an updated
    /// snapshot for any non-empty line (matching the original's behavior of
    /// invoking the progress handler on every line, not just block
    /// boundaries), or `None` for a blank line.
    pub fn feed_line(&mut self, line: &str) -> Option<ProgressSnapshot> {
        let line = line.trim();
        if line.is_empty() {
            return None;
        }

        if let Some((key, value)) = line.split_once('=') {
            let value = value.trim();

            match key {
                "total_size" if value != "N/A" => {
                    if let Ok(v) = value.parse::<f64>() {
                        self.current_size = Some(v);
                    }
                }
                "out_time_ms" if value != "N/A" => {
                    if let Ok(v) = value.parse::<f64>() {
                        self.seconds_processed = v / 1_000_000.0;
                        if self.can_get_duration && self.duration_secs > 0.0 {
                            self.state.percentage =
                                (self.seconds_processed / self.duration_secs) * 100.0;
                            if let Some(size) = self.current_size {
                                if self.state.percentage != 0.0 {
                                    self.state.estimated_size_bytes =
                                        Some(size * (100.0 / self.state.percentage));
                                }
                            }
                        }
                    }
                }
                "speed" => {
                    let speed_str = value.trim_end_matches('x');
                    if speed_str != "0" && value != "N/A" {
                        if let Ok(v) = speed_str.parse::<f64>() {
                            self.state.speed = v;
                            self.recompute_eta();
                        }
                    }
                }
                _ => {}
            }
        }

        if line == "progress=end" {
            self.state.percentage = 100.0;
            self.state.eta_secs = Some(0.0);
        }

        Some(self.state)
    }

    fn recompute_eta(&mut self) {
        if self.can_get_duration && self.state.speed > 0.0 {
            self.state.eta_secs =
                Some((self.duration_secs - self.seconds_processed) / self.state.speed);
        }
    }
}

/// Parses `HH:MM:SS`, `MM:SS`, or `SS` into total seconds.
pub fn parse_time_str(time_str: &str) -> Result<f64, String> {
    let parts: Vec<&str> = time_str.split(':').collect();
    let nums: Result<Vec<f64>, _> = parts.iter().map(|p| p.parse::<f64>()).collect();
    let nums = nums.map_err(|_| format!("invalid time string: {time_str}"))?;

    match nums.len() {
        3 => Ok(nums[0] * 3600.0 + nums[1] * 60.0 + nums[2]),
        2 => Ok(nums[0] * 60.0 + nums[1]),
        1 => Ok(nums[0]),
        _ => Err(format!("invalid time string: {time_str}")),
    }
}

/// Given a clip's full duration and optional trim start/end times, returns
/// the duration ffmpeg will actually produce, for seeding `ProgressParser`.
pub fn compute_trimmed_duration(
    full_duration_secs: f64,
    start_time: Option<&str>,
    end_time: Option<&str>,
) -> Result<f64, String> {
    let start = match start_time {
        Some(s) => parse_time_str(s)?,
        None => 0.0,
    };
    let duration = match end_time {
        Some(e) => parse_time_str(e)? - start,
        None => full_duration_secs,
    };
    Ok(duration)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hh_mm_ss() {
        assert_eq!(parse_time_str("01:02:03").unwrap(), 3723.0);
    }

    #[test]
    fn parses_mm_ss() {
        assert_eq!(parse_time_str("02:03").unwrap(), 123.0);
    }

    #[test]
    fn parses_bare_seconds() {
        assert_eq!(parse_time_str("42").unwrap(), 42.0);
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse_time_str("not-a-time").is_err());
    }

    #[test]
    fn trimmed_duration_defaults_to_full_when_no_trim() {
        assert_eq!(compute_trimmed_duration(120.0, None, None).unwrap(), 120.0);
    }

    #[test]
    fn trimmed_duration_subtracts_start_from_end() {
        // 00:00:10 -> 00:01:40 is 90 seconds
        assert_eq!(
            compute_trimmed_duration(200.0, Some("00:00:10"), Some("00:01:40")).unwrap(),
            90.0
        );
    }

    #[test]
    fn feed_line_ignores_blank_lines() {
        let mut parser = ProgressParser::new(100.0);
        assert_eq!(parser.feed_line(""), None);
        assert_eq!(parser.feed_line("   "), None);
    }

    #[test]
    fn feed_line_tracks_percentage_from_out_time_ms() {
        let mut parser = ProgressParser::new(100.0); // 100 second clip
        let snap = parser.feed_line("out_time_ms=50000000").unwrap(); // 50s in
        assert!((snap.percentage - 50.0).abs() < 1e-9);
    }

    #[test]
    fn feed_line_ignores_na_out_time_ms() {
        let mut parser = ProgressParser::new(100.0);
        let snap = parser.feed_line("out_time_ms=N/A").unwrap();
        assert_eq!(snap.percentage, 0.0);
    }

    #[test]
    fn feed_line_computes_eta_from_speed_and_progress() {
        let mut parser = ProgressParser::new(100.0);
        parser.feed_line("out_time_ms=50000000"); // 50% through
        let snap = parser.feed_line("speed=2x").unwrap();
        // 50 seconds remaining at 2x speed = 25s ETA
        assert!((snap.eta_secs.unwrap() - 25.0).abs() < 1e-9);
        assert_eq!(snap.speed, 2.0);
    }

    #[test]
    fn feed_line_ignores_zero_and_na_speed() {
        let mut parser = ProgressParser::new(100.0);
        parser.feed_line("speed=5x");
        let snap = parser.feed_line("speed=0x").unwrap();
        assert_eq!(snap.speed, 5.0); // unchanged, matches original "!= 0" guard
        let snap = parser.feed_line("speed=N/A").unwrap();
        assert_eq!(snap.speed, 5.0);
    }

    #[test]
    fn feed_line_progress_end_forces_completion() {
        let mut parser = ProgressParser::new(100.0);
        parser.feed_line("out_time_ms=10000000");
        let snap = parser.feed_line("progress=end").unwrap();
        assert_eq!(snap.percentage, 100.0);
        assert_eq!(snap.eta_secs, Some(0.0));
    }

    #[test]
    fn feed_line_estimates_size_from_total_size_and_percentage() {
        let mut parser = ProgressParser::new(100.0);
        parser.feed_line("total_size=1000");
        let snap = parser.feed_line("out_time_ms=25000000").unwrap(); // 25%
        assert!((snap.estimated_size_bytes.unwrap() - 4000.0).abs() < 1e-6);
    }

    #[test]
    fn zero_duration_never_computes_percentage() {
        let mut parser = ProgressParser::new(0.0);
        let snap = parser.feed_line("out_time_ms=50000000").unwrap();
        assert_eq!(snap.percentage, 0.0);
        assert_eq!(snap.eta_secs, None);
    }
}
