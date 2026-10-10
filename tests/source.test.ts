import { describe, it, expect } from "vitest";
import { isYouTubeUrl, planShorts } from "../lib/source";
import { isRetriableFreeError } from "../lib/free";
import { stillPromptFor } from "../lib/jobs";
import type { Project, ScenePlan } from "../lib/types";
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

  it("builds face-first still prompts with strong face negatives", () => {
    const project = {
      settings: { style: "cinematic-documentary", quality: "best" },
      characters: [{ id: "c1", fixedDescription: "Maya, brave archivist" }]
    } as unknown as Project;
    const scene = { characterIds: ["c1"], visualPrompt: "Maya enters a dusty library." } as unknown as ScenePlan;
    const pr = stillPromptFor(project, scene);
    expect(pr).toContain("symmetrical faces");
    expect(pr).toContain("detailed expressive eyes");
    expect(pr).toContain("no deformed");
    expect(pr).toContain("Maya, brave archivist");
  });

  it("retries flaky free-tier errors instead of failing instantly", () => {
    expect(isRetriableFreeError("Free service returned 402.")).toBe(true);
    expect(isRetriableFreeError("rate-limited, wait and retry")).toBe(true);
    expect(isRetriableFreeError("Free service timed out.")).toBe(true);
    expect(isRetriableFreeError("fetch failed")).toBe(true);
    expect(isRetriableFreeError("Free service is struggling on its side (HTTP 500).")).toBe(true);
    expect(isRetriableFreeError("Scene for this job no longer exists.")).toBe(false);
    expect(isRetriableFreeError("Invalid project data.")).toBe(false);
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
