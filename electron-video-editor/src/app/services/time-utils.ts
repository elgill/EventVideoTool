import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class TimeUtilsService {
  /**
   * Convert time string (HH:MM:SS) to total seconds
   */
  timeToSeconds(timeStr: string): number {
    const parts = timeStr.split(':').map(p => parseInt(p, 10));
    if (parts.length !== 3) return 0;

    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Convert seconds to time string (HH:MM:SS)
   */
  secondsToTime(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    return `${this.pad(hours)}:${this.pad(minutes)}:${this.pad(seconds)}`;
  }

  /**
   * Calculate time difference
   * Given: Event time 1, Recording time 1, Event time 2
   * Calculate: Recording time 2
   *
   * Use case: If event happened at time A and was recorded at time B,
   * and another event happened at time C, what was the recording time?
   */
  calculateTimeDifference(
    eventTime1: string,
    recordingTime1: string,
    eventTime2: string
  ): string {
    const event1Seconds = this.timeToSeconds(eventTime1);
    const recording1Seconds = this.timeToSeconds(recordingTime1);
    const event2Seconds = this.timeToSeconds(eventTime2);

    // Calculate the offset between event and recording
    const offset = recording1Seconds - event1Seconds;

    // Apply the same offset to event2
    const recording2Seconds = event2Seconds + offset;

    return this.secondsToTime(recording2Seconds);
  }

  /**
   * Format duration in seconds to human-readable string
   */
  formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  /**
   * Validate time string format (HH:MM:SS)
   */
  isValidTimeFormat(timeStr: string): boolean {
    const regex = /^([0-1]?[0-9]|2[0-3]):([0-5]?[0-9]):([0-5]?[0-9])$/;
    return regex.test(timeStr);
  }

  /**
   * Pad number with leading zero if needed
   */
  private pad(num: number): string {
    return num.toString().padStart(2, '0');
  }

  /**
   * Get current timestamp as HH:MM:SS
   */
  getCurrentTime(): string {
    const now = new Date();
    return `${this.pad(now.getHours())}:${this.pad(now.getMinutes())}:${this.pad(now.getSeconds())}`;
  }
}
