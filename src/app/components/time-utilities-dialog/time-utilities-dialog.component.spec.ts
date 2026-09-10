import { TestBed } from "@angular/core/testing";
import { TimeUtilitiesDialogComponent } from "./time-utilities-dialog.component";

describe("TimeUtilitiesDialogComponent", () => {
  function create() {
    TestBed.configureTestingModule({ imports: [TimeUtilitiesDialogComponent] });
    const fixture = TestBed.createComponent(TimeUtilitiesDialogComponent);
    return fixture.componentInstance;
  }

  it("computes recording time 2 from an event-time offset", () => {
    const dialog = create();
    dialog.actualTime1 = "10:00:00";
    dialog.recordingTime1 = "00:05:00";
    dialog.actualTime2 = "10:10:00";

    dialog.calculateRecordingTime2();

    expect(dialog.recordingTime2Result()).toBe("00:15:00");
  });

  it("handles a negative offset (event 2 happened before event 1)", () => {
    const dialog = create();
    dialog.actualTime1 = "10:10:00";
    dialog.recordingTime1 = "00:15:00";
    dialog.actualTime2 = "10:00:00";

    dialog.calculateRecordingTime2();

    expect(dialog.recordingTime2Result()).toBe("00:05:00");
  });

  it("wraps around a 24h boundary", () => {
    const dialog = create();
    dialog.actualTime1 = "23:00:00";
    dialog.recordingTime1 = "00:00:00";
    dialog.actualTime2 = "01:00:00"; // 2 hours later, past midnight

    dialog.calculateRecordingTime2();

    expect(dialog.recordingTime2Result()).toBe("02:00:00");
  });

  it("reports invalid input instead of throwing", () => {
    const dialog = create();
    dialog.actualTime1 = "not-a-time";
    dialog.recordingTime1 = "00:00:00";
    dialog.actualTime2 = "00:00:00";

    dialog.calculateRecordingTime2();

    expect(dialog.recordingTime2Result()).toBe("Invalid time format");
  });

  it("converts a time string to total seconds", () => {
    const dialog = create();
    dialog.timeToConvert = "01:02:03";

    dialog.convertToSeconds();

    expect(dialog.secondsResult()).toBe("3723");
  });

  it("reports invalid input for the seconds converter", () => {
    const dialog = create();
    dialog.timeToConvert = "garbage";

    dialog.convertToSeconds();

    expect(dialog.secondsResult()).toBe("Invalid time format");
  });
});
