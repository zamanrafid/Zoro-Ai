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

  it("mock provider is configured and free; paid providers flag missing keys", () => {
    const ps = listProviders();
    const mock = ps.find((p) => p.id === "mock")!;
    expect(mock.configured).toBe(true);
    expect(mock.costNote).toMatch(/free/i);
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
