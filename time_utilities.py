from datetime import datetime

from PyQt5.QtWidgets import QDialog, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit, QPushButton


class TimeUtilitiesDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Time Utilities")
        self.setGeometry(100, 100, 400, 200)

        # Create widgets for time difference calculation
        self.actual_time_1_label = QLabel("Actual Time of Event 1 (HH:MM:SS):")
        self.actual_time_1_input = TimeLineEdit()
        self.recording_time_1_label = QLabel("Recording Time 1 (HH:MM:SS):")
        self.recording_time_1_input = TimeLineEdit()
        self.actual_time_2_label = QLabel("Actual Time of Event 2 (HH:MM:SS):")
        self.actual_time_2_input = TimeLineEdit()
        self.calculate_time_diff_button = QPushButton("Calculate Recording Time 2")
        self.calculate_time_diff_button.clicked.connect(self.calculate_time_difference)
        self.recording_time_2_label = QLabel("Recording Time 2:")
        self.recording_time_2_output = QLineEdit()
        self.recording_time_2_output.setReadOnly(True)

        # Create widgets for converting time to seconds
        self.time_to_seconds_label = QLabel("Time (HH:MM:SS):")
        self.time_to_seconds_input = TimeLineEdit()
        self.convert_to_seconds_button = QPushButton("Convert to Seconds")
        self.convert_to_seconds_button.clicked.connect(self.convert_time_to_seconds)
        self.seconds_output_label = QLabel("Seconds:")
        self.seconds_output = QLineEdit()
        self.seconds_output.setReadOnly(True)

        # Create layouts
        time_diff_layout = QVBoxLayout()
        time_diff_layout.addWidget(self.actual_time_1_label)
        time_diff_layout.addWidget(self.actual_time_1_input)
        time_diff_layout.addWidget(self.recording_time_1_label)
        time_diff_layout.addWidget(self.recording_time_1_input)
        time_diff_layout.addWidget(self.actual_time_2_label)
        time_diff_layout.addWidget(self.actual_time_2_input)
        time_diff_layout.addWidget(self.calculate_time_diff_button)
        time_diff_layout.addWidget(self.recording_time_2_label)
        time_diff_layout.addWidget(self.recording_time_2_output)

        time_to_seconds_layout = QVBoxLayout()
        time_to_seconds_layout.addWidget(self.time_to_seconds_label)
        time_to_seconds_layout.addWidget(self.time_to_seconds_input)
        time_to_seconds_layout.addWidget(self.convert_to_seconds_button)
        time_to_seconds_layout.addWidget(self.seconds_output_label)
        time_to_seconds_layout.addWidget(self.seconds_output)

        main_layout = QHBoxLayout()
        main_layout.addLayout(time_diff_layout)
        main_layout.addLayout(time_to_seconds_layout)

        self.setLayout(main_layout)

    def calculate_time_difference(self):
        try:
            actual_time_1 = datetime.strptime(self.actual_time_1_input.text(), "%H:%M:%S")
            recording_time_1 = datetime.strptime(self.recording_time_1_input.text(), "%H:%M:%S")
            actual_time_2 = datetime.strptime(self.actual_time_2_input.text(), "%H:%M:%S")

            time_diff = actual_time_2 - actual_time_1
            recording_time_2 = recording_time_1 + time_diff

            self.recording_time_2_output.setText(recording_time_2.strftime("%H:%M:%S"))
        except ValueError:
            self.recording_time_2_output.setText("Invalid time format")

    def convert_time_to_seconds(self):
        try:
            time_str = self.time_to_seconds_input.text()
            time_obj = datetime.strptime(time_str, "%H:%M:%S")

            total_seconds = time_obj.hour * 3600 + time_obj.minute * 60 + time_obj.second
            self.seconds_output.setText(str(total_seconds))
        except ValueError:
            self.seconds_output.setText("Invalid time format")


class TimeLineEdit(QLineEdit):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setInputMask("99:99:99;_")  # HH:MM:SS format
        self.setText("00:00:00")
        self.home(False)
