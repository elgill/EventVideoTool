import { TestBed } from "@angular/core/testing";
import { AppComponent } from "./app.component";
import { VideoToolService } from "./services/video-tool.service";
import { FfmpegEventsService } from "./services/ffmpeg-events.service";
import { ClipInfo } from "./models";

const clips: ClipInfo[] = [
  { name: "a.mp4", path: "/tmp/clips/a.mp4", duration_secs: 10 },
  { name: "b.mp4", path: "/tmp/clips/b.mp4", duration_secs: 20 },
];

describe("AppComponent", () => {
  // jsdom doesn't implement media playback and logs on every call.
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  function create(videoToolOverrides: Partial<VideoToolService> = {}) {
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        {
          provide: VideoToolService,
          useValue: {
            toPreviewUrl: (p: string) => `asset://${p}`,
            ...videoToolOverrides,
          },
        },
        {
          provide: FfmpegEventsService,
          useValue: {
            ensureListening: () => Promise.resolve(),
            reset: () => {},
            running: () => false,
            progress: () => null,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(AppComponent);
    return fixture.componentInstance;
  }

  it("cannot export before clips and an output dir are chosen", () => {
    const app = create();
    expect(app.canExport()).toBe(false);

    app.clips.set(clips);
    expect(app.canExport()).toBe(false);

    app.outputDir.set("/tmp/out");
    expect(app.canExport()).toBe(true);
  });

  it("lays the clips out on one combined timeline", () => {
    const app = create();
    app.clips.set(clips);
    expect(app.timeline().totalSecs).toBe(30);
    expect(app.timeline().entries.map((e) => e.offsetSecs)).toEqual([0, 10]);
  });

  it("blocks preview and export when any clip's duration is unknown", async () => {
    const app = create({
      listClips: () =>
        Promise.resolve([...clips, { name: "bad.mp4", path: "/tmp/clips/bad.mp4", duration_secs: null }]),
    });
    app.clipDir.set("/tmp/clips");
    app.outputDir.set("/tmp/out");

    await app.refreshClips();

    expect(app.timeline().entries).toEqual([]);
    expect(app.canExport()).toBe(false);
    expect(app.statusMessage()).toContain("bad.mp4");
  });

  it("exports the whole timeline until the user has actually dragged a trim handle", async () => {
    let capturedArgs: unknown;
    const app = create({
      exportVideo: (args) => {
        capturedArgs = args;
        return Promise.resolve();
      },
    });
    app.clips.set(clips);
    app.outputDir.set("/tmp/out");

    await app.exportVideo();

    expect(capturedArgs).toMatchObject({
      clips,
      outputFile: "/tmp/out/exported_output.mp4",
      startSecs: null,
      endSecs: null,
    });
  });

  it("sends the trim range as combined-timeline seconds", async () => {
    let capturedArgs: unknown;
    const app = create({
      exportVideo: (args) => {
        capturedArgs = args;
        return Promise.resolve();
      },
    });
    app.clips.set(clips);
    app.outputDir.set("/tmp/out");
    TestBed.tick(); // let the clips-changed effect clear any old trim first

    app.onTrimChange({ startSecs: 4, endSecs: 25 });
    await app.exportVideo();

    expect(capturedArgs).toMatchObject({ startSecs: 4, endSecs: 25 });
  });

  it("drops a trim selection when the clips change", () => {
    const app = create();
    app.clips.set(clips);
    TestBed.tick();
    app.onTrimChange({ startSecs: 4, endSecs: 25 });

    app.clips.set(clips.slice(0, 1));
    TestBed.tick();

    expect(app.trimActive()).toBe(false);
    expect(app.trimRange()).toBeNull();
  });

  it("surfaces a failed export as a status message instead of throwing", async () => {
    const app = create({ exportVideo: () => Promise.reject("ffmpeg exploded") });
    app.clips.set(clips);
    app.outputDir.set("/tmp/out");

    await app.exportVideo();

    expect(app.statusMessage()).toContain("ffmpeg exploded");
    expect(app.busy()).toBe(false);
  });
});
