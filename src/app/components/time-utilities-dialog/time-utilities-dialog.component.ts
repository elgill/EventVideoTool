import { Component, output, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { formatHms, parseHms } from "../../models";

/** Port of time_utilities.py's TimeUtilitiesDialog. */
@Component({
  selector: "app-time-utilities-dialog",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./time-utilities-dialog.component.html",
  styleUrl: "./time-utilities-dialog.component.css",
})
export class TimeUtilitiesDialogComponent {
  readonly closed = output<void>();

  actualTime1 = "00:00:00";
  recordingTime1 = "00:00:00";
  actualTime2 = "00:00:00";
  readonly recordingTime2Result = signal<string | null>(null);

  timeToConvert = "00:00:00";
  readonly secondsResult = signal<string | null>(null);

  calculateRecordingTime2(): void {
    try {
      const actual1 = parseHms(this.actualTime1);
      const recording1 = parseHms(this.recordingTime1);
      const actual2 = parseHms(this.actualTime2);

      const diff = actual2 - actual1;
      const recording2 = recording1 + diff;
      // Match the original's datetime wraparound behavior (mod 24h).
      const wrapped = ((recording2 % 86400) + 86400) % 86400;
      this.recordingTime2Result.set(formatHms(wrapped));
    } catch {
      this.recordingTime2Result.set("Invalid time format");
    }
  }

  convertToSeconds(): void {
    try {
      this.secondsResult.set(String(parseHms(this.timeToConvert)));
    } catch {
      this.secondsResult.set("Invalid time format");
    }
  }
}
