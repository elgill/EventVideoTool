import { TestBed } from "@angular/core/testing";
import { AppComponent, splitPath, suggestExportPath } from "./app.component";
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
            pickSaveFile: () => Promise.resolve("/tmp/out/race.mp4"),
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

  it("can export once clips are loaded", () => {
    const app = create();
    expect(app.canExport()).toBe(false);

    app.clips.set(clips);
    expect(app.canExport()).toBe(true);
  });

  it("asks where to save, adding .mp4 if left off, and remembers the folder", async () => {
    localStorage.clear();
    const suggested: string[] = [];
    let capturedArgs: { outputFile?: string } = {};
    const app = create({
      pickSaveFile: (path) => {
        suggested.push(path);
        return Promise.resolve("/tmp/out/finish line");
      },
      exportVideo: (args) => {
        capturedArgs = args;
        return Promise.resolve();
      },
    });
    app.clipDir.set("/tmp/clips");
    app.clips.set(clips);

    await app.exportVideo();
    await app.exportVideo();

    expect(capturedArgs.outputFile).toBe("/tmp/out/finish line.mp4");
    expect(app.exportResult()).toEqual({
      ok: true,
      path: "/tmp/out/finish line.mp4",
      fileName: "finish line.mp4",
    });
    expect(suggested).toEqual(["/tmp/clips.mp4", "/tmp/out/clips.mp4"]);
  });

  it("does nothing if the save dialog is cancelled", async () => {
    const exportVideo = vi.fn();
    const app = create({ pickSaveFile: () => Promise.resolve(null), exportVideo });
    app.clips.set(clips);

    await app.exportVideo();

    expect(exportVideo).not.toHaveBeenCalled();
    expect(app.busy()).toBe(false);
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

    await app.exportVideo();

    expect(capturedArgs).toMatchObject({
      clips,
      outputFile: "/tmp/out/race.mp4",
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

    await app.exportVideo();

    expect(app.exportResult()).toEqual({ ok: false, error: "ffmpeg exploded" });
    expect(app.busy()).toBe(false);
  });
});

describe("export paths", () => {
  it("splits Windows and POSIX paths", () => {
    expect(splitPath(String.raw`C:\Races\Spring 5K`)).toEqual({
      dir: String.raw`C:\Races`,
      name: "Spring 5K",
    });
    expect(splitPath(String.raw`C:\Spring 5K\ `.trim())).toEqual({
      dir: String.raw`C:\ `.trim(),
      name: "Spring 5K",
    });
    expect(splitPath("/home/me/clips")).toEqual({ dir: "/home/me", name: "clips" });
  });

  it("suggests a file named after the clip folder, beside it", () => {
    expect(suggestExportPath(String.raw`C:\Races\Spring 5K`, null)).toBe(
      String.raw`C:\Races\Spring 5K.mp4`,
    );
    expect(suggestExportPath(String.raw`C:\Races\Spring 5K`, String.raw`D:\Exports`)).toBe(
      String.raw`D:\Exports\Spring 5K.mp4`,
    );
    expect(suggestExportPath(null, null)).toBe("exported_output.mp4");
  });
});
