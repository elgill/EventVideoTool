from PyQt5.QtCore import QThread, pyqtSignal

from ffmpeg_binaries import get_ffmpeg_path
from ffmpeg_wrapper import FfmpegWrapper
from utils import format_eta


class ReencodeThread(QThread):
    progress_update = pyqtSignal(int)  # Emit progress percentage
    progress_message = pyqtSignal(str)  # Emit detailed progress message
    finished = pyqtSignal(bool, str)  # Emit completion status and message

    def __init__(self, input_file, output_file):
        super().__init__()
        self.input_file = input_file
        self.output_file = output_file

    def run(self):
        # ffmpeg -i "$TRIMMED_FILE" -codec:v libx264 -preset fast -b:v 5M -an "$YOUTUBE_FILE"
        process = FfmpegWrapper([
            get_ffmpeg_path(), "-i", self.input_file, "-codec:v", "libx264", "-preset", "fast", "-b:v", "5M",
            self.output_file
        ])

        process.run(progress_handler=self.handle_progress_info, success_handler=self.handle_success,
                    error_handler=self.handle_error)

    def handle_progress_info(self, percentage, speed, eta, estimated_filesize):
        eta_str = format_eta(eta)
        message = f"Re-encode Progress: {percentage:.2f}%, Speed: {speed}x, ETA: {eta_str}"
        self.progress_update.emit(int(percentage))
        self.progress_message.emit(message)

    def handle_success(self):
        self.finished.emit(True, "Re-encode completed successfully!")

    def handle_error(self):
        self.finished.emit(False, f"Failed")
