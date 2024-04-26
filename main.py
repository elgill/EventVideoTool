import subprocess
import sys
import os

from PyQt5.QtWidgets import QApplication, QMainWindow, QFileDialog, QLabel, QLineEdit, QPushButton, QVBoxLayout, \
    QWidget
import ffmpeg

from ConcatenationThread import ConcatenationThread


def open_video(video_path):
    if os.path.exists(video_path):
        if sys.platform == 'win32':
            os.startfile(video_path)
        elif sys.platform == 'darwin':
            subprocess.run(['open', video_path])
        else:  # Linux variants
            subprocess.run(['xdg-open', video_path])
    else:
        print(f"Error: Video file '{video_path}' not found.")


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.concatenation_thread = None
        self.setWindowTitle("Video Trimming and Concatenation Tool")
        self.setGeometry(100, 100, 400, 300)

        # Create widgets
        self.clip_dir_label = QLabel("Clip Directory:")
        self.clip_dir_input = QLineEdit()
        self.clip_dir_button = QPushButton("Browse")
        self.clip_dir_button.clicked.connect(self.browse_clip_dir)

        self.trim_button = QPushButton("Trim and Re-encode")
        self.trim_button.clicked.connect(self.trim_and_reencode)

        self.start_time_label = QLabel("Start Time (HH:MM:SS):")
        self.start_time_input = QLineEdit()

        self.end_time_label = QLabel("End Time (HH:MM:SS):")
        self.end_time_input = QLineEdit()

        self.process_button = QPushButton("Concat Videos")
        self.process_button.clicked.connect(self.concat_videos)

        self.preview_button = QPushButton("Preview Video")
        self.preview_button.clicked.connect(self.show_preview)

        # Create layout
        layout = QVBoxLayout()
        layout.addWidget(self.clip_dir_label)
        layout.addWidget(self.clip_dir_input)
        layout.addWidget(self.clip_dir_button)
        layout.addWidget(self.process_button)
        layout.addWidget(self.preview_button)

        # In the layout
        layout.addWidget(self.start_time_label)
        layout.addWidget(self.start_time_input)
        layout.addWidget(self.end_time_label)
        layout.addWidget(self.end_time_input)

        layout.addWidget(self.trim_button)
        layout.addWidget(self.process_button)

        # Create central widget and set layout
        central_widget = QWidget()
        central_widget.setLayout(layout)
        self.setCentralWidget(central_widget)

    def browse_clip_dir(self):
        directory = QFileDialog.getExistingDirectory(self, "Select Clip Directory")
        if directory:
            self.clip_dir_input.setText(directory)

    def concat_videos(self):
        # Get input values
        clip_dir = self.clip_dir_input.text()

        # Concatenate clips
        concatenated_file = os.path.join(clip_dir, "output/concatenated_output.mp4")

        # Start the concatenation thread
        self.concatenation_thread = ConcatenationThread(clip_dir, concatenated_file)
        self.setup_connections()
        self.concatenation_thread.start()

    def show_preview(self):
        clip_dir = self.clip_dir_input.text()
        video_file = os.path.join(clip_dir, "output/concatenated_output.mp4")
        open_video(video_file)

    def trim_and_reencode(self):
        # Get input values
        clip_dir = self.clip_dir_input.text()
        start_time = self.start_time_input.text()
        end_time = self.end_time_input.text()

        # Get file paths
        concatenated_file = os.path.join(clip_dir, "output/concatenated_output.mp4")
        trimmed_file = os.path.join(clip_dir, "output/trimmed_output.mp4")
        youtube_file = os.path.join(clip_dir, "output/youtube_output.mp4")

        # Check if the concatenated file exists
        if os.path.isfile(concatenated_file):
            # Trim and mute the concatenated video
            self.trim_and_mute(concatenated_file, trimmed_file, start_time, end_time)

            # Re-encode for YouTube
            self.re_encode_for_youtube(trimmed_file, youtube_file)
        else:
            print(f"Error: Concatenated file '{concatenated_file}' not found.")

    def trim_and_mute(self, input_file, output_file, start_time, end_time):
        stream = ffmpeg.input(input_file)
        stream = ffmpeg.trim(stream, start=start_time, end=end_time)
        stream = ffmpeg.output(stream, output_file, codec="copy", an=True)
        ffmpeg.run(stream, overwrite_output=True)

    def re_encode_for_youtube(self, input_file, output_file):
        stream = ffmpeg.input(input_file)
        stream = ffmpeg.output(stream, output_file, codec="libx264", preset="fast", b="5M", an=True)
        ffmpeg.run(stream)
    def setup_connections(self):
        # Setup connections once the thread is created somewhere like in concat_videos
        self.concatenation_thread.progress_update.connect(self.update_progress_bar)
        self.concatenation_thread.progress_message.connect(self.display_progress_message)
        self.concatenation_thread.finished.connect(self.process_finished)

    def update_progress_bar(self, value):
        #self.progress_bar.setValue(value)
        pass

    def display_progress_message(self, message):
        self.statusBar().showMessage(message)

    def process_finished(self, success, message):
        self.statusBar().showMessage(message)
        if success:
            print("Operation Successful!")
        else:
            print("Operation Failed:", message)


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec_())