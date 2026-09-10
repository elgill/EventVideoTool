import { TestBed } from "@angular/core/testing";
import { ClipListComponent } from "./clip-list.component";
import { ClipInfo } from "../../models";

describe("ClipListComponent", () => {
  function create() {
    TestBed.configureTestingModule({ imports: [ClipListComponent] });
    const fixture = TestBed.createComponent(ClipListComponent);
    return fixture;
  }

  const clips: ClipInfo[] = [
    { path: "/a.mp4", name: "a.mp4", duration_secs: 10 },
    { path: "/b.mp4", name: "b.mp4", duration_secs: 20.5 },
    { path: "/c.mp4", name: "c.mp4", duration_secs: null },
  ];

  it("sums known clip durations and treats unknown durations as zero", () => {
    const fixture = create();
    expect(fixture.componentInstance.totalDuration(clips)).toBe(30.5);
  });

  it("returns zero for an empty clip list", () => {
    const fixture = create();
    expect(fixture.componentInstance.totalDuration([])).toBe(0);
  });

  it("emits clipSelected when a clip row is clicked", () => {
    const fixture = create();
    fixture.componentRef.setInput("clips", clips);
    fixture.detectChanges();

    let selected: ClipInfo | undefined;
    fixture.componentInstance.clipSelected.subscribe((c: ClipInfo) => (selected = c));

    const rows = fixture.nativeElement.querySelectorAll("li");
    expect(rows.length).toBe(3);
    rows[1].dispatchEvent(new MouseEvent("click"));

    expect(selected?.path).toBe("/b.mp4");
  });

  it("shows an empty-state hint when there are no clips", () => {
    const fixture = create();
    fixture.componentRef.setInput("clips", []);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector(".empty-hint")).toBeTruthy();
  });
});
