import { TestBed } from "@angular/core/testing";
import { check } from "@tauri-apps/plugin-updater";
import { UpdateService } from "./update.service";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("1.0.0") }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

describe("UpdateService", () => {
  afterEach(() => vi.clearAllMocks());

  function create() {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    return TestBed.inject(UpdateService);
  }

  it("reports the current version and that it is up to date", async () => {
    vi.mocked(check).mockResolvedValue(null);
    const updates = create();
    await updates.checkForUpdate();
    expect(updates.currentVersion()).toBe("1.0.0");
    expect(updates.state()).toEqual({ kind: "upToDate" });
  });

  it("reports a failed check instead of looking up to date", async () => {
    vi.mocked(check).mockRejectedValue(new Error("offline"));
    const updates = create();
    await updates.checkForUpdate();
    expect(updates.state()).toEqual({ kind: "checkFailed", message: "Error: offline" });
  });

  it("keeps a dismissed update installable", async () => {
    vi.mocked(check).mockResolvedValue({ version: "1.1.0" } as Awaited<ReturnType<typeof check>>);
    const updates = create();
    await updates.checkForUpdate();
    expect(updates.state()).toEqual({ kind: "available", version: "1.1.0" });
    updates.dismiss();
    expect(updates.state()).toEqual({ kind: "dismissed", version: "1.1.0" });
  });
});
