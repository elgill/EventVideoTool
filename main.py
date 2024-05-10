import subprocess
import sys
import os

from PyQt5.QtGui import QIcon
from PyQt5.QtWidgets import QApplication, QMainWindow, QFileDialog, QLabel, QLineEdit, QPushButton, QVBoxLayout, \
    QWidget, QCheckBox, QFrame, QMessageBox

from concatenation_thread import ConcatenationThread
from process_thread import ProcessThread
from time_utilities import TimeUtilitiesDialog


def open_video(video_path):
    if os.path.exists(video_path):
        if sys.platform == 'win32':
            os.startfile(video_path)
        elif sys.platform == 'darwin':
            subprocess.run(['open', video_path])
        else:  # Linux variants
            subprocess.run(['xdg-open', video_path])


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.process_thread = None
        self.output_dir = None
        self.clip_dir = None
        self.end_time = None
        self.start_time = None
        self.process_file = None
        self.concatenated_file = None
        self.concatenation_thread = None
        self.setWindowTitle("Video Trimming and Concatenation Tool")
        self.setWindowIcon(self.load_icon("icon.png"))
        self.setGeometry(100, 100, 600, 400)

        self.separator = QFrame()
        self.separator.setFrameShape(QFrame.HLine)
        self.separator.setFrameShadow(QFrame.Sunken)

        # Create widgets
        self.clip_dir_label = QLabel("Clip Directory:")
        self.clip_dir_input = QLineEdit()
        self.clip_dir_button = QPushButton("Browse")
        self.clip_dir_button.clicked.connect(self.browse_clip_dir)

        self.output_dir_label = QLabel("Output Directory:")
        self.output_dir_input = QLineEdit()
        self.output_dir_button = QPushButton("Browse")
        self.output_dir_button.clicked.connect(self.browse_output_dir)

        self.reencode_checkbox = QCheckBox("Re-encode")
        self.mute_checkbox = QCheckBox("Mute")

        self.process_button = QPushButton("Process")
        self.process_button.clicked.connect(self.process)

        self.start_time_label = QLabel("Start Time (HH:MM:SS):")
        self.start_time_input = TimeLineEdit()

        self.end_time_label = QLabel("End Time (HH:MM:SS):")
        self.end_time_input = TimeLineEdit()

        self.concat_button = QPushButton("Concat Videos")
        self.concat_button.clicked.connect(self.concat_videos)

        self.preview_button = QPushButton("Preview Video")
        self.preview_button.clicked.connect(self.show_preview)

        self.time_utilities_button = QPushButton("Time Utilities")
        self.time_utilities_button.clicked.connect(self.open_time_utilities)

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

        layout.addWidget(self.reencode_checkbox)
        layout.addWidget(self.mute_checkbox)

        # In the layout
        layout.addWidget(self.start_time_label)
        layout.addWidget(self.start_time_input)
        layout.addWidget(self.end_time_label)
        layout.addWidget(self.end_time_input)

        layout.addWidget(self.process_button)
        layout.addWidget(self.separator)
        layout.addWidget(self.time_utilities_button)

        # Create central widget and set layout
        central_widget = QWidget()
        central_widget.setLayout(layout)
        self.setCentralWidget(central_widget)

    def load_icon(self, icon_name):
        base_path = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
        icon_path = os.path.join(base_path, icon_name)
        return QIcon(icon_path)

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

        if not os.path.isdir(self.clip_dir):
            error_message = f"Invalid clip directory: {self.clip_dir}"
            self.display_error_message(error_message)
            return

        if not os.path.isdir(self.output_dir):
            error_message = f"Invalid output directory: {self.output_dir}"
            self.display_error_message(error_message)
            return

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

        if self.end_time == "00:00:00":
            self.end_time = None

        self.concatenated_file = os.path.join(self.output_dir, "concatenated_output.mp4")
        self.process_file = os.path.join(self.output_dir, "process_output.mp4")

    def process(self):
        self.set_fields()

        re_encode = self.reencode_checkbox.isChecked()
        mute = self.mute_checkbox.isChecked()

        if not os.path.isdir(self.output_dir):
            error_message = f"Invalid output directory: {self.output_dir}"
            self.display_error_message(error_message)
            return

        if not os.path.isfile(self.concatenated_file):
            error_message = f"Invalid concatenated file: {self.concatenated_file}"
            self.display_error_message(error_message)
            return

        # Start the concatenation thread
        self.process_thread = ProcessThread(self.concatenated_file, self.process_file, self.start_time, self.end_time,
                                            mute, re_encode)
        self.setup_connections(self.process_thread)
        self.process_thread.start()

    def setup_connections(self, thread):
        # Setup connections once the thread is created somewhere like in concat_videos
        thread.progress_update.connect(self.update_progress_bar)
        thread.progress_message.connect(self.display_progress_message)
        thread.finished.connect(self.process_finished)

    def update_progress_bar(self, value):
        # self.progress_bar.setValue(value)
        pass

    def display_progress_message(self, message):
        self.statusBar().showMessage(message)

    def process_finished(self, success, message):
        self.statusBar().showMessage(message)

    def open_time_utilities(self):
        time_utilities_dialog = TimeUtilitiesDialog(self)
        time_utilities_dialog.setWindowIcon(self.load_icon('icon.png'))
        time_utilities_dialog.show()

    def display_error_message(self, message):
        error_dialog = QMessageBox(self)
        error_dialog.setIcon(QMessageBox.Critical)
        error_dialog.setText(message)
        error_dialog.setWindowTitle("Error")
        error_dialog.exec_()


class TimeLineEdit(QLineEdit):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setInputMask("99:99:99;_")  # HH:MM:SS format
        self.setText("00:00:00")
        self.home(False)  # Move cursor to the end


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec_())
