import { describe, it, expect } from "vitest";
import { buildSrt, srtTimestamp } from "../lib/ffmpeg";

describe("captions", () => {
  it("formats SRT timestamps", () => {
    expect(srtTimestamp(0)).toBe("00:00:00,000");
    expect(srtTimestamp(65.5)).toBe("00:01:05,500");
  });

  it("builds contiguous caption blocks from scene order", () => {
    const project = {
      scenes: [
        { id: "a", durationSec: 5, caption: "Opening", narrationSegment: "" },
        { id: "b", durationSec: 5, caption: "", narrationSegment: "Middle beat" }
      ]
    } as never;
    const srt = buildSrt(project, ["a", "b"]);
    expect(srt).toContain("00:00:00,000 --> 00:00:05,000");
    expect(srt).toContain("00:00:05,000 --> 00:00:10,000");
    expect(srt).toContain("Middle beat");
  });
});
