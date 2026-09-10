import { TestBed } from "@angular/core/testing";
import { AppComponent } from "./app.component";
import { VideoToolService } from "./services/video-tool.service";
import { FfmpegEventsService } from "./services/ffmpeg-events.service";

describe("AppComponent", () => {
  function create(videoToolOverrides: Partial<VideoToolService> = {}) {
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: VideoToolService, useValue: videoToolOverrides },
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

  it("cannot process before any clips/output dir are chosen", () => {
    const app = create();
    expect(app.canProcess()).toBe(false);
    expect(app.canConcat()).toBe(false);
  });

  it("cannot process until concat has actually succeeded, even with an output dir chosen", () => {
    const app = create();
    app.outputDir.set("/tmp/out");
    expect(app.canProcess()).toBe(false);
  });

  it("can process once concat succeeds", async () => {
    const app = create({
      concatClips: () => Promise.resolve(),
      toPreviewUrl: (p: string) => `asset://${p}`,
    });
    app.clipDir.set("/tmp/clips");
    app.outputDir.set("/tmp/out");

    await app.concat();

    expect(app.canProcess()).toBe(true);
    expect(app.hasConcatenatedOutput()).toBe(true);
    expect(app.previewPath()).toBe("/tmp/out/concatenated_output.mp4");
  });

  it("resets hasConcatenatedOutput when a new output directory is chosen", async () => {
    const app = create({
      concatClips: () => Promise.resolve(),
      pickDirectory: () => Promise.resolve("/tmp/other-out"),
    });
    app.clipDir.set("/tmp/clips");
    app.outputDir.set("/tmp/out");
    await app.concat();
    expect(app.hasConcatenatedOutput()).toBe(true);

    await app.browseOutputDir();

    expect(app.outputDir()).toBe("/tmp/other-out");
    expect(app.hasConcatenatedOutput()).toBe(false);
    expect(app.canProcess()).toBe(false);
  });

  it("surfaces a failed concat as a status message instead of throwing", async () => {
    const app = create({ concatClips: () => Promise.reject("ffmpeg exploded") });
    app.clipDir.set("/tmp/clips");
    app.outputDir.set("/tmp/out");

    await app.concat();

    expect(app.hasConcatenatedOutput()).toBe(false);
    expect(app.statusMessage()).toContain("ffmpeg exploded");
  });

  it("only sends a trim range to process() once the user has actually dragged a handle", async () => {
    let capturedArgs: unknown;
    const app = create({
      concatClips: () => Promise.resolve(),
      processVideo: (args: unknown) => {
        capturedArgs = args;
        return Promise.resolve();
      },
    });
    app.clipDir.set("/tmp/clips");
    app.outputDir.set("/tmp/out");
    await app.concat();

    await app.process();

    expect(capturedArgs).toMatchObject({ startTime: null, endTime: null });
  });
});
