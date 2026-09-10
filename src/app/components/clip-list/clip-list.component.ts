import { Component, input, output } from "@angular/core";
import { ClipInfo, formatHms } from "../../models";

@Component({
  selector: "app-clip-list",
  standalone: true,
  templateUrl: "./clip-list.component.html",
  styleUrl: "./clip-list.component.css",
})
export class ClipListComponent {
  readonly clips = input<ClipInfo[]>([]);
  readonly selectedPath = input<string | null>(null);
  readonly clipSelected = output<ClipInfo>();

  readonly formatHms = formatHms;

  totalDuration(clips: ClipInfo[]): number {
    return clips.reduce((sum, c) => sum + (c.duration_secs ?? 0), 0);
  }
}
