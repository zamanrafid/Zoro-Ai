import { describe, it, expect } from "vitest";
import { createProjectSchema } from "../lib/validate";
import { listProviders } from "../lib/providers";

describe("validation + providers honesty", () => {
  it("rejects bad durations with a field-specific message (no silent 400)", () => {
    const r = createProjectSchema.safeParse({
      name: "x",
      prompt: "A detective in old Dhaka uncovers a mystery.",
      settings: { durationSec: 0, aspectRatio: "9:16", style: "fantasy", motionIntensity: "low" },
      providerId: "slideshow"
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const flat = r.error.flatten();
      expect(JSON.stringify(flat.fieldErrors)).toContain("settings");
    }
  });

  it("accepts a clamped valid duration", () => {
    const r = createProjectSchema.safeParse({
      name: "x",
      prompt: "A detective in old Dhaka uncovers a mystery.",
      settings: { durationSec: 20, aspectRatio: "9:16", style: "fantasy", motionIntensity: "low" },
      providerId: "slideshow"
    });
    expect(r.success).toBe(true);
  });

  it("accepts 50k prompts and 30-min videos", () => {
    const r = createProjectSchema.safeParse({
      name: "long epic",
      prompt: "Epic tale. ".repeat(4000).slice(0, 45000),
      settings: { durationSec: 1800, aspectRatio: "16:9", style: "historical", motionIntensity: "medium" },
      providerId: "slideshow"
    });
    expect(r.success).toBe(true);
    const bad = createProjectSchema.safeParse({
      name: "x",
      prompt: "A detective in old Dhaka uncovers a mystery.",
      settings: { durationSec: 1801, aspectRatio: "16:9", style: "fantasy", motionIntensity: "low" },
      providerId: "slideshow"
    });
    expect(bad.success).toBe(false);
  });

  it("slideshow provider is free, keyless and configured; paid providers flag missing keys", () => {
    const ps = listProviders();
    const free = ps.find((p) => p.id === "slideshow")!;
    expect(free.configured).toBe(true);
    expect(free.costNote).toMatch(/free/i);
    const rep = ps.find((p) => p.id === "replicate")!;
    expect(rep.requiresApiKey).toBe(true);
    if (!process.env.REPLICATE_API_TOKEN) {
      expect(rep.configured).toBe(false);
      expect(rep.missing).toMatch(/REPLICATE_API_TOKEN/);
    }
  });

  it("never exposes secrets: provider list carries no tokens", () => {
    const json = JSON.stringify(listProviders());
    expect(json).not.toMatch(/r8_|hf_|sk-/);
  });
});
