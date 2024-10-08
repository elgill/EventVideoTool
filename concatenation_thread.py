import os
from PyQt5.QtCore import QThread, pyqtSignal
from ffmpeg import probe

from ffmpeg_binaries import get_ffprobe_path, get_ffmpeg_path
from ffmpeg_wrapper import FfmpegWrapper
from utils import format_eta


class ConcatenationThread(QThread):
    progress_update = pyqtSignal(int)  # Emit progress percentage
    progress_message = pyqtSignal(str)  # Emit detailed progress message
    finished = pyqtSignal(bool, str)  # Emit completion status and message

    def __init__(self, clip_dir, output_file):
        super().__init__()
        self.clip_dir = clip_dir
        self.output_file = output_file

    def run(self):
        filelist_path = os.path.join(self.clip_dir, "filelist.txt")
        total_duration = 0  # Initialize total duration

        # Delete existing filelist.txt and create a new one
        if os.path.exists(filelist_path):
            os.remove(filelist_path)

        with open(filelist_path, "w") as filelist:
            for file in sorted(os.listdir(self.clip_dir)):
                if (file.endswith(".mp4") or file.endswith(".MP4")) and not file.startswith("."):
                    file_path = os.path.join(self.clip_dir, file)
                    if os.path.getsize(file_path) > 0:
                        filelist.write(f"file '{file_path}'\n")
                        # Calculate duration of each file
                        try:
                            video_info = probe(file_path, cmd=get_ffprobe_path())
                            duration = float(video_info['format']['duration'])
                            total_duration += duration
                        except Exception as e:
                            print(f"Error reading video duration for {file}: {e}")

        print(f"Total Duration: {total_duration}")
        process = FfmpegWrapper([
            get_ffmpeg_path(), "-f", "concat", "-safe", "0", "-hwaccel", "auto", "-i", filelist_path, "-c", "copy", self.output_file, "-y"
        ], expected_duration=total_duration)

        self.progress_message.emit("Starting concatenation..")

        process.run(progress_handler=self.handle_progress_info, success_handler=self.handle_success,
                    error_handler=self.handle_error)

    def handle_progress_info(self, percentage, speed, eta, estimated_filesize):
        eta_str = format_eta(eta)
        message = f"Concat Progress: {percentage:.2f}%, Speed: {speed}x, ETA: {eta_str}"
        self.progress_update.emit(int(percentage))
        self.progress_message.emit(message)

    def handle_success(self):
        self.finished.emit(True, "Concatenation completed successfully!")

    def handle_error(self):
        self.finished.emit(False, "Failed")
