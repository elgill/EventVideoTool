import {
  Component,
  ElementRef,
  computed,
  effect,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { formatHms, parseHms } from "../../models";

type Segment = 0 | 1 | 2;

/** Seconds per unit of each segment: hours, minutes, seconds. */
const UNIT = [3600, 60, 1] as const;
/** Character range of each segment in "HH:MM:SS". */
const RANGE = [
  [0, 2],
  [3, 5],
  [6, 8],
] as const;

/**
 * An HH:MM:SS field edited one segment at a time, like a native time input:
 * clicking selects the segment under the cursor, typing two digits fills it
 * and moves on, so a time never has to be backspaced over.
 *
 * - Digits overwrite the selected segment; a digit that can't start a
 *   two-digit value (e.g. 7 in minutes) fills the segment on its own.
 * - `:`, `.`, space, or ←/→ move between segments.
 * - ↑/↓ step the selected segment, carrying into the others.
 * - Backspace/Delete zero the segment; Enter emits `enter`.
 * - Pasting "1:02:03", "2:03" or bare digits ("430" → 00:04:30) works.
 *
 * The value is always kept within [min, max].
 */
@Component({
  selector: "app-time-input",
  standalone: true,
  template: `<input
    #field
    type="text"
    class="time-input"
    inputmode="numeric"
    spellcheck="false"
    autocomplete="off"
    [attr.aria-label]="label()"
    (focus)="onFocus()"
    (blur)="onBlur()"
    (mousedown)="pointerFocus = true"
    (mouseup)="onMouseUp()"
    (keydown)="onKeyDown($event)"
    (paste)="onPaste($event)"
  />`,
  styles: `
    :host {
      display: inline-block;
    }
    .time-input {
      width: 10ch;
      font-variant-numeric: tabular-nums;
      text-align: center;
      caret-color: transparent;
    }
  `,
})
export class TimeInputComponent {
  /** Seconds. */
  readonly value = model(0);
  readonly min = input(0);
  readonly max = input(99 * 3600 + 59 * 60 + 59);
  readonly label = input<string | null>(null);
  /** Enter was pressed, after committing what was typed. */
  readonly enter = output<void>();

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>("field");

  private active: Segment = 0;
  /** First digit typed into the active segment, waiting for a second. */
  private readonly pending = signal<number | null>(null);
  /** Whether the active segment was reached by auto-advancing, so a typed
   * separator right after is redundant and shouldn't skip another one. */
  private autoAdvanced = false;
  protected pointerFocus = false;

  private readonly display = computed(() => {
    const text = formatHms(this.value());
    const pending = this.pending();
    if (pending === null) return text;
    const [from, to] = RANGE[this.active];
    return `${text.slice(0, from)}0${pending}${text.slice(to)}`;
  });

  constructor() {
    effect(() => {
      this.display();
      untracked(() => this.render());
    });
  }

  protected onFocus(): void {
    // A click picks its own segment once the caret lands (see onMouseUp).
    if (!this.pointerFocus) this.select(0);
  }

  protected onBlur(): void {
    this.commitPending();
    this.pointerFocus = false;
  }

  protected onMouseUp(): void {
    this.pointerFocus = false;
    const caret = this.field().nativeElement.selectionStart ?? 0;
    this.select(caret <= RANGE[0][1] ? 0 : caret <= RANGE[1][1] ? 1 : 2);
  }

  protected onKeyDown(event: KeyboardEvent): void {
    // Leave Tab, copy/paste/select-all, etc. to the browser.
    if (event.key === "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();

    if (/^\d$/.test(event.key)) {
      this.typeDigit(Number(event.key));
      return;
    }

    switch (event.key) {
      case ":":
      case ".":
      case " ":
        if (this.autoAdvanced) this.autoAdvanced = false;
        else this.select(Math.min(this.active + 1, 2) as Segment);
        break;
      case "ArrowRight":
        this.select(Math.min(this.active + 1, 2) as Segment);
        break;
      case "ArrowLeft":
        this.select(Math.max(this.active - 1, 0) as Segment);
        break;
      case "Home":
        this.select(0);
        break;
      case "End":
        this.select(2);
        break;
      case "ArrowUp":
      case "ArrowDown":
        this.commitPending();
        this.setValue(
          Math.floor(this.value()) + (event.key === "ArrowUp" ? 1 : -1) * UNIT[this.active],
        );
        this.autoAdvanced = false;
        break;
      case "Backspace":
      case "Delete":
        this.pending.set(null);
        this.setSegment(this.active, 0);
        this.autoAdvanced = false;
        break;
      case "Enter":
        this.field().nativeElement.blur();
        this.enter.emit();
        break;
      case "Escape":
        this.field().nativeElement.blur();
        break;
    }
  }

  protected onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const secs = parseLenient(event.clipboardData?.getData("text") ?? "");
    if (secs === null) return;
    this.pending.set(null);
    this.setValue(secs);
  }

  private typeDigit(digit: number): void {
    const pending = this.pending();
    if (pending !== null) {
      this.pending.set(null);
      this.setSegment(this.active, pending * 10 + digit);
      this.advance();
    } else if (digit * 10 > this.segmentMax(this.active)) {
      // No second digit could follow, so this one fills the segment.
      this.setSegment(this.active, digit);
      this.advance();
    } else {
      this.pending.set(digit);
      this.autoAdvanced = false;
    }
  }

  private advance(): void {
    if (this.active < 2) {
      this.select((this.active + 1) as Segment);
      this.autoAdvanced = true;
    } else {
      this.render();
    }
  }

  private select(segment: Segment): void {
    this.commitPending();
    this.active = segment;
    this.autoAdvanced = false;
    this.render();
  }

  private commitPending(): void {
    const pending = this.pending();
    if (pending === null) return;
    this.pending.set(null);
    this.setSegment(this.active, pending);
  }

  /** Largest value the segment could hold without exceeding `max`. */
  private segmentMax(segment: Segment): number {
    return segment === 0 ? Math.min(99, Math.floor(this.max() / 3600)) : 59;
  }

  private setSegment(segment: Segment, n: number): void {
    const parts = formatHms(this.value()).split(":").map(Number);
    parts[segment] = Math.min(n, segment === 0 ? 99 : 59);
    this.setValue(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }

  private setValue(secs: number): void {
    const next = Math.min(Math.max(secs, this.min()), this.max());
    if (next !== this.value()) this.value.set(next);
    this.render();
  }

  private render(): void {
    const el = this.field().nativeElement;
    const text = this.display();
    if (el.value !== text) el.value = text;
    const [from, to] = RANGE[this.active];
    if (document.activeElement === el) el.setSelectionRange(from, to);
  }
}

/** Parses "H:MM:SS"/"M:SS" or bare digits read right to left as HHMMSS. */
export function parseLenient(text: string): number | null {
  const trimmed = text.trim();
  if (/^\d+(:\d+){0,2}$/.test(trimmed) && trimmed.includes(":")) return parseHms(trimmed);
  if (/^\d{1,6}$/.test(trimmed)) {
    const padded = trimmed.padStart(6, "0");
    return parseHms(`${padded.slice(0, 2)}:${padded.slice(2, 4)}:${padded.slice(4)}`);
  }
  return null;
}
