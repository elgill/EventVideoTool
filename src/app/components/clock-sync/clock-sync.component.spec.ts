import { TestBed } from "@angular/core/testing";
import { parseHms } from "../../models";
import {
  ClockSyncComponent,
  clockToVideo,
  formatSignedHms,
  videoToClock,
} from "./clock-sync.component";

const t = parseHms;

describe("clockToVideo", () => {
  // The first finisher crossed at race time 25:34, 12:03 into the tape.
  const ref = { clockSecs: t("00:25:34"), videoSecs: t("00:12:03") };

  it("offsets from the sync point", () => {
    expect(clockToVideo(ref, t("00:31:10"), t("01:00:00"))).toBe(t("00:17:39"));
  });

  it("handles a time before the sync point", () => {
    expect(clockToVideo(ref, t("00:20:00"), t("01:00:00"))).toBe(t("00:06:29"));
  });

  it("returns null outside the video", () => {
    expect(clockToVideo(ref, t("00:10:00"), t("01:00:00"))).toBeNull();
    expect(clockToVideo(ref, t("01:30:00"), t("01:00:00"))).toBeNull();
  });
});

describe("videoToClock", () => {
  it("goes negative before the gun", () => {
    const gun = { clockSecs: 0, videoSecs: t("00:02:00") };
    expect(videoToClock(gun, 0)).toBe(-t("00:02:00"));
    expect(formatSignedHms(videoToClock(gun, 0))).toBe("-00:02:00");
  });
});

describe("ClockSyncComponent", () => {
  beforeEach(() => localStorage.clear());

  function create() {
    TestBed.configureTestingModule({ imports: [ClockSyncComponent] });
    const fixture = TestBed.createComponent(ClockSyncComponent);
    fixture.componentRef.setInput("durationSecs", t("01:00:00"));
    fixture.componentRef.setInput("playheadSecs", t("00:12:03"));
    fixture.detectChanges();
    return { fixture, sync: fixture.componentInstance };
  }

  it("starts collapsed and remembers being opened", () => {
    const { sync } = create();
    expect(sync.open()).toBe(false);
    sync.toggle();
    TestBed.tick();
    expect(localStorage.getItem("clockSync.open")).toBe("true");
  });

  it("syncs to the frame on screen, then jumps to typed finish times", () => {
    const { sync } = create();
    const seeks: number[] = [];
    sync.seek.subscribe((s) => seeks.push(s));
    expect(sync.found()).toBeNull();

    sync.syncDraft.set(t("00:25:34"));
    sync.syncToPlayhead();
    expect(seeks).toEqual([]);
    expect(sync.editingSync()).toBe(false);
    // The search starts from the sync time so only differing digits need typing.
    expect(sync.findClock()).toBe(t("00:25:34"));
    expect(sync.playheadClock()).toBe(t("00:25:34"));

    sync.setFindClock(t("00:31:10"));
    expect(seeks).toEqual([t("00:17:39")]);
  });

  it("offers the current frame's race time when re-syncing", () => {
    const { fixture, sync } = create();
    sync.syncDraft.set(t("00:25:34"));
    sync.syncToPlayhead();
    fixture.componentRef.setInput("playheadSecs", t("00:13:03"));

    sync.changeSync();

    expect(sync.editingSync()).toBe(true);
    expect(sync.syncDraft()).toBe(t("00:26:34"));
  });
});
