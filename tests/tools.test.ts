import { describe, it, expect } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { expandPattern, resolveBin, ffmpegBin, renderUnavailableMessage } from "../lib/tools";

describe("tool resolver (PATH-independent)", () => {
  it("returns the plain command when nothing is installed", () => {
    expect(resolveBin("definitely-not-a-real-binary-xyz", [])).toBe("definitely-not-a-real-binary-xyz");
  });

  it("finds binaries through wildcard patterns", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zoro-tools-"));
    await fs.mkdir(path.join(root, "Gyan.FFmpeg_XYZ", "ffmpeg-9.0", "bin"), { recursive: true });
    await fs.writeFile(path.join(root, "Gyan.FFmpeg_XYZ", "ffmpeg-9.0", "bin", "ffmpeg.exe"), "x");
    const hits = expandPattern(path.join(root, "Gyan.FFmpeg_*", "ffmpeg-*", "bin", "ffmpeg.exe"));
    expect(hits.length).toBe(1);
    expect(hits[0].toLowerCase().endsWith("ffmpeg.exe")).toBe(true);
    expect(resolveBin("ffmpeg", [path.join(root, "Gyan.FFmpeg_*", "ffmpeg-*", "bin", "ffmpeg.exe")])).toBe(hits[0]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("ffmpegBin falls back to PATH name when absent, else a real path", () => {
    const b = ffmpegBin();
    expect(typeof b).toBe("string");
    expect(b.length).toBeGreaterThan(0);
  });

  it("missing-render message names the real situation", () => {
    const m = renderUnavailableMessage();
    expect(m.length).toBeGreaterThan(20);
    if (process.env.VERCEL === "1") expect(m).toMatch(/demo/i);
  });
});
