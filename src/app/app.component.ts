import { Component, OnInit, computed, effect, inject, signal } from "@angular/core";
import { ClipListComponent } from "./components/clip-list/clip-list.component";
import {
  TrimRange,
  VideoPreviewComponent,
} from "./components/video-preview/video-preview.component";
import { TimeUtilitiesDialogComponent } from "./components/time-utilities-dialog/time-utilities-dialog.component";
import { FfmpegEventsService } from "./services/ffmpeg-events.service";
import { VideoToolService } from "./services/video-tool.service";
import { ClipInfo, formatEta, formatHms } from "./models";

function joinPath(dir: string, fileName: string): string {
  return /[/\\]$/.test(dir) ? `${dir}${fileName}` : `${dir}/${fileName}`;
}

@Component({
  selector: "app-root",
  standalone: true,
  imports: [ClipListComponent, VideoPreviewComponent, TimeUtilitiesDialogComponent],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent implements OnInit {
  private readonly videoTool = inject(VideoToolService);
  protected readonly ffmpegEvents = inject(FfmpegEventsService);

  readonly clipDir = signal<string | null>(null);
  readonly outputDir = signal<string | null>(null);
  readonly clips = signal<ClipInfo[]>([]);

  readonly previewPath = signal<string | null>(null);
  /** Bumped whenever a file we might already be previewing gets overwritten,
   * so the <video> element's src actually changes and reloads it instead of
   * reusing a cached, now-stale asset. */
  readonly previewVersion = signal(0);
  readonly previewUrl = computed(() => {
    const path = this.previewPath();
    if (!path) return null;
    const base = this.videoTool.toPreviewUrl(path);
    return `${base}?v=${this.previewVersion()}`;
  });

  readonly mute = signal(false);
  readonly reEncode = signal(false);
  readonly hwAcceleration = signal(false);
  readonly hwEncoderName = signal<string | null | undefined>(undefined); // undefined = not checked yet

  readonly trimActive = signal(false);
  readonly trimRange = signal<TrimRange | null>(null);

  /** True once `concat()` has produced concatenatedFilePath() at least once
   * this session. Guards `process()`, matching the original app's
   * `os.path.isfile(self.concatenated_file)` check. */
  readonly hasConcatenatedOutput = signal(false);

  readonly statusMessage = signal("Choose a clip directory to get started.");
  readonly showTimeUtilities = signal(false);
  readonly busy = signal(false);

  readonly formatHms = formatHms;
  readonly formatEta = formatEta;

  readonly concatenatedFilePath = computed(() => {
    const dir = this.outputDir();
    return dir ? joinPath(dir, "concatenated_output.mp4") : null;
  });
  readonly processedFilePath = computed(() => {
    const dir = this.outputDir();
    return dir ? joinPath(dir, "process_output.mp4") : null;
  });

  readonly trimEnabled = computed(
    () =>
      this.previewPath() !== null && this.previewPath() === this.concatenatedFilePath(),
  );

  readonly canConcat = computed(
    () => this.clipDir() !== null && this.outputDir() !== null && !this.busy(),
  );
  readonly canProcess = computed(() => this.hasConcatenatedOutput() && !this.busy());

  constructor() {
    // Reset any pending trim selection whenever the previewed file changes.
    effect(() => {
      this.previewPath();
      this.trimActive.set(false);
      this.trimRange.set(null);
    });
  }

  async ngOnInit(): Promise<void> {
    await this.ffmpegEvents.ensureListening();
  }

  async browseClipDir(): Promise<void> {
    const dir = await this.videoTool.pickDirectory();
    if (!dir) return;
    this.clipDir.set(dir);
    await this.refreshClips();
  }

  async browseOutputDir(): Promise<void> {
    const dir = await this.videoTool.pickDirectory();
    if (!dir) return;
    this.outputDir.set(dir);
    // A newly chosen output directory doesn't have a concatenated file in
    // it yet (or if it happens to reuse a prior directory, we still want
    // the user to explicitly re-run Concat before Process is enabled).
    this.hasConcatenatedOutput.set(false);
  }

  async refreshClips(): Promise<void> {
    const dir = this.clipDir();
    if (!dir) return;
    try {
      this.clips.set(await this.videoTool.listClips(dir));
    } catch (err) {
      this.statusMessage.set(`Could not list clips: ${err}`);
    }
  }

  selectClip(clip: ClipInfo): void {
    this.previewPath.set(clip.path);
  }

  onTrimChange(range: TrimRange): void {
    this.trimActive.set(true);
    this.trimRange.set(range);
  }

  async onHwAccelerationToggle(): Promise<void> {
    if (this.hwAcceleration() && this.hwEncoderName() === undefined) {
      this.hwEncoderName.set(await this.videoTool.detectHwEncoder());
    }
  }

  async concat(): Promise<void> {
    const clipDir = this.clipDir();
    const outputFile = this.concatenatedFilePath();
    if (!clipDir || !outputFile) return;

    this.busy.set(true);
    this.ffmpegEvents.reset();
    this.statusMessage.set("Starting concatenation...");
    try {
      await this.videoTool.concatClips(clipDir, outputFile);
      this.statusMessage.set("Concatenation completed successfully!");
      this.hasConcatenatedOutput.set(true);
      this.previewVersion.update((v) => v + 1);
      this.previewPath.set(outputFile);
    } catch (err) {
      this.statusMessage.set(`Concatenation failed: ${err}`);
    } finally {
      this.busy.set(false);
    }
  }

  async process(): Promise<void> {
    const inputFile = this.concatenatedFilePath();
    const outputFile = this.processedFilePath();
    if (!inputFile || !outputFile) return;

    const range = this.trimActive() ? this.trimRange() : null;

    this.busy.set(true);
    this.ffmpegEvents.reset();
    this.statusMessage.set("Starting processing...");
    try {
      await this.videoTool.processVideo({
        inputFile,
        outputFile,
        startTime: range ? formatHms(range.startSecs) : null,
        endTime: range ? formatHms(range.endSecs) : null,
        mute: this.mute(),
        reEncode: this.reEncode(),
        hwAcceleration: this.hwAcceleration(),
      });
      this.statusMessage.set("Process completed successfully!");
      this.previewVersion.update((v) => v + 1);
      this.previewPath.set(outputFile);
    } catch (err) {
      this.statusMessage.set(`Process failed: ${err}`);
    } finally {
      this.busy.set(false);
    }
  }
}
