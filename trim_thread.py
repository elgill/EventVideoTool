import os
from PyQt5.QtCore import QThread, pyqtSignal
from ffmpeg import probe

from ffmpeg_binaries import get_ffprobe_path, get_ffmpeg_path
from ffmpeg_wrapper import FfmpegWrapper
from utils import format_eta


class TrimThread(QThread):
    progress_update = pyqtSignal(int)  # Emit progress percentage
    progress_message = pyqtSignal(str)  # Emit detailed progress message
    finished = pyqtSignal(bool, str)  # Emit completion status and message

    def __init__(self, input_file, output_file, start_time, end_time):
        super().__init__()
        self.input_file = input_file
        self.output_file = output_file
        self.start_time = start_time
        self.end_time = end_time

    def run(self):
        # ffmpeg -i "$INPUT_FILE" -ss $START_TIME -to $END_TIME -c:v copy -an "$TRIMMED_FILE"
        process = FfmpegWrapper([
            get_ffmpeg_path(), "-i", self.input_file, "-ss", self.start_time, "-to", self.end_time, "-c:v", "copy",
            "-an", self.output_file
        ])

        process.run(progress_handler=self.handle_progress_info, success_handler=self.handle_success,
                    error_handler=self.handle_error)

    def handle_progress_info(self, percentage, speed, eta, estimated_filesize):
        eta_str = format_eta(eta)
        message = f"Trim Progress: {percentage:.2f}%, Speed: {speed}x, ETA: {eta_str}"
        self.progress_update.emit(int(percentage))
        self.progress_message.emit(message)

    def handle_success(self):
        self.finished.emit(True, "Trim completed successfully!")

    def handle_error(self):
        self.finished.emit(False, f"Failed")
