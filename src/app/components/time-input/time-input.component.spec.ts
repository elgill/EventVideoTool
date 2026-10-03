import { TestBed } from "@angular/core/testing";
import { TimeInputComponent, parseLenient } from "./time-input.component";

describe("TimeInputComponent", () => {
  function create(value = 0, max?: number) {
    TestBed.configureTestingModule({ imports: [TimeInputComponent] });
    const fixture = TestBed.createComponent(TimeInputComponent);
    fixture.componentRef.setInput("value", value);
    if (max !== undefined) fixture.componentRef.setInput("max", max);
    fixture.autoDetectChanges();
    document.body.appendChild(fixture.nativeElement);
    const el: HTMLInputElement = fixture.nativeElement.querySelector("input");
    el.focus();
    const type = (...keys: string[]) => {
      for (const key of keys) {
        el.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }));
      }
      TestBed.tick();
    };
    return { input: fixture.componentInstance, el, type };
  }

  it("fills segments left to right from typed digits, no separators needed", () => {
    const { input, el, type } = create();
    type(..."012345");
    expect(input.value()).toBe(1 * 3600 + 23 * 60 + 45);
    expect(el.value).toBe("01:23:45");
  });

  it("ignores a separator typed right after a segment auto-filled", () => {
    const { input, type } = create();
    type("0", "1", ":", "2", "3", ":", "4", "5");
    expect(input.value()).toBe(1 * 3600 + 23 * 60 + 45);
  });

  it("fills a segment from one digit when no second digit could follow", () => {
    const { input, type } = create();
    type("0", "0", "7", "9");
    expect(input.value()).toBe(7 * 60 + 9);
  });

  it("lets a single hour digit through when the max is under 10 hours", () => {
    const { input, type } = create(0, 3600 * 2);
    type("1", "3", "0");
    expect(input.value()).toBe(3600 + 30 * 60);
  });

  it("overwrites only the selected segment", () => {
    const { input, type } = create(1 * 3600 + 23 * 60 + 45);
    type("ArrowRight", "0", "5");
    expect(input.value()).toBe(1 * 3600 + 5 * 60 + 45);
  });

  it("commits a lone pending digit when moving on", () => {
    const { input, type } = create();
    type("End", "3", "ArrowLeft");
    expect(input.value()).toBe(3);
  });

  it("steps the selected segment with the arrow keys, carrying over", () => {
    const { input, type } = create(59 * 60 + 59);
    type("End", "ArrowUp");
    expect(input.value()).toBe(3600);
    type("ArrowLeft", "ArrowDown");
    expect(input.value()).toBe(3600 - 60);
  });

  it("keeps the value within max", () => {
    const { input, type } = create(0, 90);
    type("0", "0", "5", "9");
    expect(input.value()).toBe(90);
  });
});

describe("parseLenient", () => {
  it("reads colon-separated times", () => {
    expect(parseLenient("1:02:03")).toBe(3723);
    expect(parseLenient(" 4:30 ")).toBe(270);
  });

  it("reads bare digits right to left as HHMMSS", () => {
    expect(parseLenient("430")).toBe(270);
    expect(parseLenient("10203")).toBe(3723);
  });

  it("rejects anything else", () => {
    expect(parseLenient("abc")).toBeNull();
    expect(parseLenient("1:2:3:4")).toBeNull();
  });
});
