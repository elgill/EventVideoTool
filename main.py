import subprocess
import sys
import os

from PyQt5.QtWidgets import QApplication, QMainWindow, QFileDialog, QLabel, QLineEdit, QPushButton, QVBoxLayout, \
    QWidget

from concatenation_thread import ConcatenationThread
from reencode_thread import ReencodeThread
from trim_thread import TrimThread


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
        self.output_dir = None
        self.reencode_thread = None
        self.trim_thread = None
        self.clip_dir = None
        self.end_time = None
        self.start_time = None
        self.youtube_file = None
        self.trimmed_file = None
        self.concatenated_file = None
        self.concatenation_thread = None
        self.setWindowTitle("Video Trimming and Concatenation Tool")
        self.setGeometry(100, 100, 400, 300)

        # Create widgets
        self.clip_dir_label = QLabel("Clip Directory:")
        self.clip_dir_input = QLineEdit()
        self.clip_dir_button = QPushButton("Browse")
        self.clip_dir_button.clicked.connect(self.browse_clip_dir)

        self.output_dir_label = QLabel("Output Directory:")
        self.output_dir_input = QLineEdit()
        self.output_dir_button = QPushButton("Browse")
        self.output_dir_button.clicked.connect(self.browse_output_dir)

        self.trim_button = QPushButton("Trim and Mute")
        self.trim_button.clicked.connect(self.trim_and_mute)
        
        self.re_encode_button = QPushButton("Re-encode")
        self.re_encode_button.clicked.connect(self.re_encode_for_youtube)

        self.start_time_label = QLabel("Start Time (HH:MM:SS):")
        self.start_time_input = QLineEdit()

        self.end_time_label = QLabel("End Time (HH:MM:SS):")
        self.end_time_input = QLineEdit()

        self.concat_button = QPushButton("Concat Videos")
        self.concat_button.clicked.connect(self.concat_videos)

        self.preview_button = QPushButton("Preview Video")
        self.preview_button.clicked.connect(self.show_preview)

        # Create layout
        layout = QVBoxLayout()
        layout.addWidget(self.clip_dir_label)
        layout.addWidget(self.clip_dir_input)
        layout.addWidget(self.clip_dir_button)

        layout.addWidget(self.output_dir_label)
        layout.addWidget(self.output_dir_input)
        layout.addWidget(self.output_dir_button)

        layout.addWidget(self.concat_button)
        layout.addWidget(self.preview_button)

        # In the layout
        layout.addWidget(self.start_time_label)
        layout.addWidget(self.start_time_input)
        layout.addWidget(self.end_time_label)
        layout.addWidget(self.end_time_input)

        layout.addWidget(self.trim_button)
        layout.addWidget(self.re_encode_button)

        # Create central widget and set layout
        central_widget = QWidget()
        central_widget.setLayout(layout)
        self.setCentralWidget(central_widget)

    def browse_clip_dir(self):
        directory = QFileDialog.getExistingDirectory(self, "Select Clip Directory")
        if directory:
            self.clip_dir_input.setText(directory)

    def browse_output_dir(self):
        directory = QFileDialog.getExistingDirectory(self, "Select Output Directory")
        if directory:
            self.output_dir_input.setText(directory)

    def concat_videos(self):
        self.set_fields()

        # Start the concatenation thread
        self.concatenation_thread = ConcatenationThread(self.clip_dir, self.concatenated_file)
        self.setup_connections(self.concatenation_thread)
        self.concatenation_thread.start()

    def show_preview(self):
        self.set_fields()
        open_video(self.concatenated_file)

    def set_fields(self):
        self.clip_dir = self.clip_dir_input.text()
        self.output_dir = self.output_dir_input.text()
        self.start_time = self.start_time_input.text()
        self.end_time = self.end_time_input.text()

        self.concatenated_file = os.path.join(self.output_dir, "concatenated_output.mp4")
        self.trimmed_file = os.path.join(self.output_dir, "trimmed_output.mp4")
        self.youtube_file = os.path.join(self.output_dir, "youtube_output.mp4")

    def trim_and_mute(self, ):
        self.set_fields()
        # Start the concatenation thread
        self.trim_thread = TrimThread(self.concatenated_file, self.trimmed_file, self.start_time, self.end_time)
        self.setup_connections(self.trim_thread)
        self.trim_thread.start()

    def re_encode_for_youtube(self):
        self.set_fields()
        # Start the concatenation thread
        self.reencode_thread = ReencodeThread(self.trimmed_file, self.youtube_file)
        self.setup_connections(self.reencode_thread)
        self.reencode_thread.start()
        
    def setup_connections(self, thread):
        # Setup connections once the thread is created somewhere like in concat_videos
        thread.progress_update.connect(self.update_progress_bar)
        thread.progress_message.connect(self.display_progress_message)
        thread.finished.connect(self.process_finished)

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