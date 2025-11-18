import { Component, signal, computed, OnDestroy, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VideoService } from './services/video';
import { TimeUtilsService } from './services/time-utils';
import { VideoFile } from '../electron';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  standalone: true,
})
export class App implements OnDestroy {
  // Directory paths
  clipDirectory = signal<string>('');
  outputDirectory = signal<string>('');

  // Video files
  videoFiles = signal<VideoFile[]>([]);
  concatenatedFile = signal<string>('');
  processedFile = signal<string>('');

  // Processing options
  startTime = signal<string>('00:00:00');
  endTime = signal<string>('00:00:00');
  reEncode = signal<boolean>(false);
  mute = signal<boolean>(false);
  useHardwareAcceleration = signal<boolean>(true);

  // Video preview
  previewVideoUrl = signal<string>('');
  showPreview = signal<boolean>(false);
  currentPlaybackTime = signal<number>(0);
  videoDuration = signal<number>(0);

  // Event time sync
  eventStartTime = signal<string>('00:00:00');
  recordingStartTime = signal<string>('00:00:00');

  // Computed event time based on playback
  currentEventTime = computed(() => {
    const playbackSeconds = this.currentPlaybackTime();
    const recordingStartSeconds = this.timeUtils.timeToSeconds(this.recordingStartTime());
    const eventStartSeconds = this.timeUtils.timeToSeconds(this.eventStartTime());

    const offset = recordingStartSeconds - eventStartSeconds;
    const eventSeconds = playbackSeconds + offset;

    return this.timeUtils.secondsToTime(eventSeconds);
  });

  // Time utilities dialog
  showTimeUtilities = signal<boolean>(false);

  // Time utilities inputs
  eventTime1 = signal<string>('00:00:00');
  recordingTime1 = signal<string>('00:00:00');
  eventTime2 = signal<string>('00:00:00');
  calculatedRecordingTime2 = signal<string>('00:00:00');
  timeToConvert = signal<string>('00:00:00');
  convertedSeconds = signal<number>(0);

  // Computed values
  totalDuration = computed(() => {
    return this.videoFiles().reduce((sum, file) => sum + file.duration, 0);
  });

  canConcatenate = computed(() => {
    return this.videoFiles().length > 0 && this.outputDirectory() !== '';
  });

  canProcess = computed(() => {
    return this.concatenatedFile() !== '';
  });

  // Progress tracking
  progressMessage = computed(() => this.videoService.getProgressMessage());
  isProcessing = computed(() => this.videoService.isProcessing());

  constructor(
    public videoService: VideoService,
    public timeUtils: TimeUtilsService
  ) {
    // Set up effect to update preview when concatenated file changes
    effect(() => {
      const file = this.concatenatedFile();
      if (file) {
        this.updatePreview(file);
      }
    });

    // Set up effect to update preview when processed file changes
    effect(() => {
      const file = this.processedFile();
      if (file) {
        this.updatePreview(file);
      }
    });
  }

  ngOnDestroy() {
    this.videoService.destroy();
  }

  async selectClipDirectory() {
    const dir = await this.videoService.selectDirectory('Select Clip Directory');
    if (dir) {
      this.clipDirectory.set(dir);
      await this.loadVideoFiles(dir);
    }
  }

  async selectOutputDirectory() {
    const dir = await this.videoService.selectDirectory('Select Output Directory');
    if (dir) {
      this.outputDirectory.set(dir);
    }
  }

  async loadVideoFiles(directory: string) {
    try {
      const files = await this.videoService.getFilesFromDirectory(directory);
      this.videoFiles.set(files);
    } catch (err: any) {
      alert(`Error loading video files: ${err.message}`);
    }
  }

  async concatenateVideos() {
    if (!this.canConcatenate()) return;

    try {
      const outputPath = `${this.outputDirectory()}/concatenated_output.mp4`;
      const result = await this.videoService.concatenateVideos({
        inputFiles: this.videoFiles().map(f => f.path),
        outputPath,
        useHardwareAcceleration: this.useHardwareAcceleration(),
      });

      if (result.success) {
        this.concatenatedFile.set(result.outputPath);
        alert('Concatenation completed successfully!');
      }
    } catch (err: any) {
      alert(`Concatenation error: ${err.message}`);
    }
  }

  async processVideo() {
    if (!this.canProcess()) return;

    try {
      const outputPath = `${this.outputDirectory()}/processed_output.mp4`;
      const result = await this.videoService.processVideo({
        inputPath: this.concatenatedFile(),
        outputPath,
        startTime: this.startTime(),
        endTime: this.endTime(),
        reEncode: this.reEncode(),
        mute: this.mute(),
        useHardwareAcceleration: this.useHardwareAcceleration(),
        bitrate: '5M',
      });

      if (result.success) {
        this.processedFile.set(result.outputPath);
        alert('Processing completed successfully!');
      }
    } catch (err: any) {
      alert(`Processing error: ${err.message}`);
    }
  }

  async previewVideo() {
    const videoPath = this.processedFile() || this.concatenatedFile();
    if (videoPath) {
      await this.videoService.openExternal(videoPath);
    }
  }

  updatePreview(filePath: string) {
    // Use custom media:// protocol to load local video files securely
    const mediaUrl = (window as any).electronAPI?.getMediaUrl(filePath) || filePath;
    this.previewVideoUrl.set(mediaUrl);
    this.showPreview.set(true);
  }

  onVideoTimeUpdate(event: Event) {
    const video = event.target as HTMLVideoElement;
    this.currentPlaybackTime.set(video.currentTime);
  }

  onVideoLoadedMetadata(event: Event) {
    const video = event.target as HTMLVideoElement;
    this.videoDuration.set(video.duration);
  }

  setStartTimeFromPlayback() {
    const currentTime = this.currentPlaybackTime();
    this.startTime.set(this.timeUtils.secondsToTime(currentTime));
  }

  setEndTimeFromPlayback() {
    const currentTime = this.currentPlaybackTime();
    this.endTime.set(this.timeUtils.secondsToTime(currentTime));
  }

  seekToStartTime() {
    const startSeconds = this.timeUtils.timeToSeconds(this.startTime());
    const video = document.querySelector('video');
    if (video) {
      video.currentTime = startSeconds;
    }
  }

  seekToEndTime() {
    const endSeconds = this.timeUtils.timeToSeconds(this.endTime());
    const video = document.querySelector('video');
    if (video) {
      video.currentTime = endSeconds;
    }
  }

  getStartTimePercentage(): number {
    if (this.videoDuration() === 0) return 0;
    const startSeconds = this.timeUtils.timeToSeconds(this.startTime());
    return (startSeconds / this.videoDuration()) * 100;
  }

  getEndTimePercentage(): number {
    if (this.videoDuration() === 0) return 0;
    const endSeconds = this.timeUtils.timeToSeconds(this.endTime());
    return (endSeconds / this.videoDuration()) * 100;
  }

  toggleTimeUtilities() {
    this.showTimeUtilities.set(!this.showTimeUtilities());
  }

  calculateTimeDifference() {
    const result = this.timeUtils.calculateTimeDifference(
      this.eventTime1(),
      this.recordingTime1(),
      this.eventTime2()
    );
    this.calculatedRecordingTime2.set(result);
  }

  convertTimeToSeconds() {
    const seconds = this.timeUtils.timeToSeconds(this.timeToConvert());
    this.convertedSeconds.set(seconds);
  }

  formatDuration(seconds: number): string {
    return this.timeUtils.formatDuration(seconds);
  }

  formatFileSize(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    if (mb >= 1000) {
      return `${(mb / 1024).toFixed(2)} GB`;
    }
    return `${mb.toFixed(2)} MB`;
  }
}
