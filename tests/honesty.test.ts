import { describe, it, expect } from "vitest";
import { createProjectSchema } from "../lib/validate";
import { listProviders } from "../lib/providers";

describe("validation + providers honesty", () => {
  it("rejects short prompts at the schema level", () => {
    const r = createProjectSchema.safeParse({
      name: "x",
      prompt: "short",
      settings: { durationSec: 20, aspectRatio: "9:16", style: "fantasy", motionIntensity: "low" },
      providerId: "mock"
    });
    expect(r.success).toBe(false);
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
