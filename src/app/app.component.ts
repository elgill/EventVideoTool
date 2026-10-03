import { Component, OnInit, computed, effect, inject, signal, viewChild } from "@angular/core";
import { ClipListComponent } from "./components/clip-list/clip-list.component";
import {
  TrimRange,
  VideoPreviewComponent,
} from "./components/video-preview/video-preview.component";
import { ClockSyncComponent } from "./components/clock-sync/clock-sync.component";
import { FfmpegEventsService } from "./services/ffmpeg-events.service";
import { VideoToolService } from "./services/video-tool.service";
import { ClipInfo, formatEta } from "./models";
import { Timeline, buildTimeline } from "./timeline";

function joinPath(dir: string, fileName: string): string {
  return /[/\\]$/.test(dir) ? `${dir}${fileName}` : `${dir}/${fileName}`;
}

const EMPTY_TIMELINE: Timeline = { entries: [], totalSecs: 0 };

@Component({
  selector: "app-root",
  standalone: true,
  imports: [ClipListComponent, VideoPreviewComponent, ClockSyncComponent],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent implements OnInit {
  private readonly videoTool = inject(VideoToolService);
  protected readonly ffmpegEvents = inject(FfmpegEventsService);
  private readonly preview = viewChild(VideoPreviewComponent);

  readonly clipDir = signal<string | null>(null);
  readonly outputDir = signal<string | null>(null);
  readonly clips = signal<ClipInfo[]>([]);

  /** Clips ffprobe couldn't read a duration for. Any of these makes the
   * combined timeline unknowable, so preview and export are blocked. */
  readonly unreadableClips = computed(() =>
    this.clips().filter((c) => c.duration_secs === null),
  );
  readonly timeline = computed(() =>
    this.unreadableClips().length > 0 ? EMPTY_TIMELINE : buildTimeline(this.clips()),
  );
  readonly toPreviewUrl = (path: string) => this.videoTool.toPreviewUrl(path);

  /** Clip under the preview's playhead, highlighted in the clip list. */
  readonly currentClipIndex = signal(0);
  readonly currentClipPath = computed(
    () => this.timeline().entries[this.currentClipIndex()]?.clip.path ?? null,
  );

  readonly mute = signal(false);
  readonly reEncode = signal(false);
  readonly hwAcceleration = signal(false);
  readonly hwEncoderName = signal<string | null | undefined>(undefined); // undefined = not checked yet

  readonly trimActive = signal(false);
  readonly trimRange = signal<TrimRange | null>(null);

  readonly statusMessage = signal("Choose a clip directory to get started.");
  readonly busy = signal(false);

  readonly formatEta = formatEta;

  readonly exportFilePath = computed(() => {
    const dir = this.outputDir();
    return dir ? joinPath(dir, "exported_output.mp4") : null;
  });

  readonly canExport = computed(
    () => this.timeline().entries.length > 0 && this.outputDir() !== null && !this.busy(),
  );

  constructor() {
    // A trim selection only means something for the clips it was made on.
    effect(() => {
      this.timeline();
      this.trimActive.set(false);
      this.trimRange.set(null);
      this.currentClipIndex.set(0);
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
  }

  async refreshClips(): Promise<void> {
    const dir = this.clipDir();
    if (!dir) return;
    try {
      this.clips.set(await this.videoTool.listClips(dir));
    } catch (err) {
      this.statusMessage.set(`Could not list clips: ${err}`);
      return;
    }

    const unreadable = this.unreadableClips();
    if (unreadable.length > 0) {
      this.statusMessage.set(
        `Could not read the duration of ${unreadable.map((c) => c.name).join(", ")}. ` +
          "Remove or repair them to preview and export.",
      );
    } else if (this.clips().length === 0) {
      this.statusMessage.set("No .mp4 clips found in that directory.");
    } else {
      this.statusMessage.set(`Loaded ${this.clips().length} clip(s).`);
    }
  }

  /** Jumps the preview to the start of `clip` on the combined timeline. */
  selectClip(clip: ClipInfo): void {
    const entry = this.timeline().entries.find((e) => e.clip.path === clip.path);
    if (entry) this.preview()?.seek(entry.offsetSecs);
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

  async exportVideo(): Promise<void> {
    const outputFile = this.exportFilePath();
    if (!outputFile || !this.canExport()) return;

    const range = this.trimActive() ? this.trimRange() : null;

    this.busy.set(true);
    this.ffmpegEvents.reset();
    this.statusMessage.set("Starting export...");
    try {
      await this.videoTool.exportVideo({
        clips: this.clips(),
        outputFile,
        startSecs: range?.startSecs ?? null,
        endSecs: range?.endSecs ?? null,
        mute: this.mute(),
        reEncode: this.reEncode(),
        hwAcceleration: this.hwAcceleration(),
      });
      this.statusMessage.set(`Export completed successfully: ${outputFile}`);
    } catch (err) {
      this.statusMessage.set(`Export failed: ${err}`);
    } finally {
      this.busy.set(false);
    }
  }
}
