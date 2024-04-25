import os

from PyQt5.QtCore import QThread
from better_ffmpeg_progress import FfmpegProcess

from ffmpeg_binaries import get_ffmpeg_binary


class ConcatenationThread(QThread):
    def __init__(self, clip_dir, output_file):
        super().__init__()
        self.clip_dir = clip_dir
        self.output_file = output_file

    def run(self):
        os.chdir(self.clip_dir)
        filelist_path = os.path.join(self.clip_dir, "filelist.txt")

        # Delete existing filelist.txt and create a new one
        if os.path.exists(filelist_path):
            os.remove(filelist_path)

        sorted_files = sorted(
            [file for file in os.listdir(self.clip_dir) if file.endswith(".mp4") or file.endswith(".MP4")])

        with open(filelist_path, "w") as filelist:
            for file in sorted_files:
                file_path = os.path.join(self.clip_dir, file)
                if os.path.getsize(file_path) > 0:
                    filelist.write(f"file '{file_path}'\n")

        # Concatenate clips using ffmpeg
        # ffmpeg -f concat -safe 0 -i filelist.txt -c copy "$CONCATENATED_FILE"
        process = FfmpegProcess([get_ffmpeg_binary(), "-f", "concat", "-safe", "0", "-i", filelist_path, "-c", "copy",
                                 self.output_file])
        # Use the run method to run the FFmpeg command.
        process.run()

        print("Concatenation successful!")
