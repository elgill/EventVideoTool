from PyQt5.QtCore import QThread, pyqtSignal

from ffmpeg_binaries import get_ffmpeg_path
from ffmpeg_wrapper import FfmpegWrapper
from hardware_encoder_util import get_hardware_encoder
from utils import format_eta


class ProcessThread(QThread):
    progress_update = pyqtSignal(int)  # Emit progress percentage
    progress_message = pyqtSignal(str)  # Emit detailed progress message
    finished = pyqtSignal(bool, str)  # Emit completion status and message

    def __init__(self, input_file, output_file, start_time, end_time, mute, re_encode, hw_acceleration):
        super().__init__()
        self.input_file = input_file
        self.output_file = output_file
        self.start_time = start_time
        self.end_time = end_time
        self.mute = mute
        self.re_encode = re_encode
        self.hw_acceleration = hw_acceleration

    def run(self):
        ffmpeg_cmd = [get_ffmpeg_path()]

        if self.hw_acceleration:
            ffmpeg_cmd.extend(["-hwaccel", "auto"])

        ffmpeg_cmd.extend(["-i", self.input_file])

        if self.start_time and self.end_time:
            ffmpeg_cmd.extend(["-ss", self.start_time, "-to", self.end_time])

        if self.re_encode:
            hw_encoder = get_hardware_encoder()
            if hw_encoder and self.hw_acceleration:
                ffmpeg_cmd.extend(["-c:v", hw_encoder, "-preset", "fast", "-b:v", "5M"])
            else:
                ffmpeg_cmd.extend(["-c:v", "libx264", "-preset", "fast", "-b:v", "5M"])
        else:
            ffmpeg_cmd.extend(["-c:v", "copy"])

        if self.mute:
            ffmpeg_cmd.extend(["-an"])

        # overwrite
        ffmpeg_cmd.extend(["-y"])

        if self.output_file:
            ffmpeg_cmd.extend([self.output_file])

        process = FfmpegWrapper(ffmpeg_cmd)

        self.progress_message.emit("Starting processing..")

        process.run(progress_handler=self.handle_progress_info, success_handler=self.handle_success,
                    error_handler=self.handle_error)

    def handle_progress_info(self, percentage, speed, eta, estimated_filesize):
        eta_str = format_eta(eta)
        message = f"Process Progress: {percentage:.2f}%, Speed: {speed}x, ETA: {eta_str}"
        self.progress_message.emit(message)

    def handle_success(self):
        self.finished.emit(True, "Process completed successfully!")

    def handle_error(self):
        self.finished.emit(False, "Failed")
