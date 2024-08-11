import os
from pathlib import Path
import subprocess
import sys

from ffmpeg import probe
from tqdm import tqdm

from ffmpeg_binaries import get_ffprobe_path


class FfmpegWrapper:
    def __init__(self, command, ffmpeg_loglevel="verbose", expected_duration=0):
        if "-i" not in command:
            raise ValueError("FFmpeg command must include '-i'")

        self._ffmpeg_args = command + ["-hide_banner", "-loglevel", ffmpeg_loglevel]
        self._expected_duration = expected_duration

        self._set_file_info()

        self._estimated_size = None
        self._eta = None
        self._percentage_progress = 0
        self._previous_seconds_processed = 0
        self._progress_bar = None
        self._seconds_processed = 0
        self._speed = 0
        self._current_size = 0
        if sys.platform.startswith("win"):
            self.creationflags = subprocess.CREATE_NO_WINDOW
        else:
            self.creationflags = 0

    def _parse_time(self, time_str):
        """Converts a HH:MM:SS or MM:SS or SS format string into total seconds as float."""
        parts = time_str.split(':')
        if len(parts) == 3:
            hours, minutes, seconds = map(float, parts)
            return hours * 3600 + minutes * 60 + seconds
        elif len(parts) == 2:
            minutes, seconds = map(float, parts)
            return minutes * 60 + seconds
        else:
            return float(parts[0])

    def _set_file_info(self):
        index_of_filepath = self._ffmpeg_args.index("-i") + 1
        self._filepath = self._ffmpeg_args[index_of_filepath]
        self._can_get_duration = True

        if self._expected_duration > 0:
            self._can_get_duration = True
            self._duration_secs = self._expected_duration
        else:
            try:
                self._duration_secs = float(probe(self._filepath, cmd=get_ffprobe_path())["format"]["duration"])
                print(f"The duration of {self._filepath} has been detected as {self._duration_secs} seconds.")
            except Exception:
                self._can_get_duration = False

        # Initialize start time and trimmed duration
        start_time = 0
        trimmed_duration = self._duration_secs

        # Check for start time (-ss)
        if "-ss" in self._ffmpeg_args:
            start_index = self._ffmpeg_args.index("-ss") + 1
            start_time = self._parse_time(self._ffmpeg_args[start_index])

        # Check for duration (-t) or end time (-to)
        if "-t" in self._ffmpeg_args:
            duration_index = self._ffmpeg_args.index("-t") + 1
            trimmed_duration = self._parse_time(self._ffmpeg_args[duration_index])
        elif "-to" in self._ffmpeg_args:
            end_index = self._ffmpeg_args.index("-to") + 1
            end_time = self._parse_time(self._ffmpeg_args[end_index])
            trimmed_duration = end_time - start_time

        self._duration_secs = trimmed_duration

        if self._can_get_duration:
            self._ffmpeg_args += ["-progress", "pipe:1", "-nostats"]

    def _update_progress(self, ffmpeg_output, progress_handler):
        if ffmpeg_output:
            value = ffmpeg_output.split("=")[1].strip()

            if progress_handler is None:
                if "out_time_ms" in ffmpeg_output:
                    seconds_processed = round(int(value) / 1_000_000, 1)
                    seconds_increase = seconds_processed - self._previous_seconds_processed
                    self._progress_bar.update(seconds_increase)
                    self._previous_seconds_processed = seconds_processed

            else:
                if "total_size" in ffmpeg_output and "N/A" not in value:
                    self._current_size = int(value)

                elif "out_time_ms" in ffmpeg_output and "N/A" not in value:
                    # ERROR here
                    #print("SecondsPr")
                    self._seconds_processed = int(value) / 1_000_000

                    if self._can_get_duration:
                        self._percentage_progress = (
                                                            self._seconds_processed / self._duration_secs
                                                    ) * 100

                        if self._current_size is not None and self._percentage_progress != 0.0:
                            self._estimated_size = self._current_size * (
                                    100 / self._percentage_progress
                            )

                elif "speed" in ffmpeg_output:
                    speed_str = value[:-1]
                    if speed_str != "0" and "N/A" not in value:
                        self._speed = float(speed_str)

                        if self._can_get_duration:
                            self._eta = (
                                                self._duration_secs - self._seconds_processed
                                        ) / self._speed

                if ffmpeg_output == "progress=end":
                    self._percentage_progress = 100
                    self._eta = 0

                progress_handler(
                    self._percentage_progress, self._speed, self._eta, self._estimated_size
                )

    def run(
            self,
            progress_handler=None,
            ffmpeg_output_file=None,
            success_handler=None,
            error_handler=None,
    ):

        if ffmpeg_output_file is None:
            os.makedirs("ffmpeg_logs", exist_ok=True)
            ffmpeg_output_file = os.path.join("ffmpeg_logs", f"[{Path(self._filepath).name}].txt")

        print(self._ffmpeg_args)

        with open(ffmpeg_output_file, "a") as f:
            process = subprocess.Popen(self._ffmpeg_args, stdout=subprocess.PIPE, stderr=f, creationflags=self.creationflags)
            print(f"\nRunning: {' '.join(self._ffmpeg_args)}\n")

        if progress_handler is None and self._can_get_duration:
            self._progress_bar = tqdm(
                total=round(self._duration_secs, 1),
                unit="s",
                dynamic_ncols=True,
                leave=False,
            )

        try:
            while process.poll() is None:
                ffmpeg_output = process.stdout.readline().decode().strip()
                self._update_progress(ffmpeg_output, progress_handler)

            if process.returncode != 0:
                if error_handler:
                    error_handler()
                    return

                print(
                    f"The FFmpeg process encountered an error. The output of FFmpeg can be found in {ffmpeg_output_file}"
                )

            if success_handler:
                success_handler()

            print(f"\n\nDone! To see FFmpeg's output, check out {ffmpeg_output_file}")

        except KeyboardInterrupt:
            self._progress_bar.close()
            print("[KeyboardInterrupt] FFmpeg process killed.")
            sys.exit()

        except Exception as e:
            print(f"[Better FFmpeg Process] {e}")
