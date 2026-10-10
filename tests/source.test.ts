import { describe, it, expect } from "vitest";
import { isYouTubeUrl, planShorts } from "../lib/source";
import { createProjectSchema } from "../lib/validate";

describe("source import guards", () => {
  it("accepts only real YouTube watch/shorts/live links", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("https://www.youtube.com/shorts/abc123XYZ_-")).toBe(true);
    expect(isYouTubeUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10s")).toBe(true);
    expect(isYouTubeUrl("https://evil.com/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(isYouTubeUrl("https://youtube.com.evil.com/watch?v=abc123")).toBe(false);
    expect(isYouTubeUrl("https://www.youtube.com/playlist?list=xyz")).toBe(false);
    expect(isYouTubeUrl("not a url")).toBe(false);
  });

  it("plans Shorts chunks within 5-60s bounds", () => {
    const plan = planShorts(100, 30);
    expect(plan).toHaveLength(4);
    expect(plan[0]).toEqual({ start: 0, len: 30 });
    expect(plan[3].len).toBe(10);
    const tiny = planShorts(100, 999);
    expect(tiny[0].len).toBe(60);
    expect(planShorts(0, 30)).toEqual([]);
  });

  it("accepts practically unlimited text (200k)", () => {
    const r = createProjectSchema.safeParse({
      name: "x",
      prompt: "Long story. ".repeat(10000).slice(0, 100000),
      settings: { durationSec: 20, aspectRatio: "9:16", style: "fantasy", motionIntensity: "low" },
      providerId: "slideshow"
    });
    expect(r.success).toBe(true);
  });
});
