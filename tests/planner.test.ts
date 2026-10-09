import { describe, it, expect } from "vitest";
import { planStoryboard } from "../lib/planner";

const settings = {
  durationSec: 20,
  aspectRatio: "9:16" as const,
  style: "dark-mystery" as const,
  motionIntensity: "medium" as const
};

describe("offline storyboard planner", () => {
  it("splits 20s into four ~5s scenes", () => {
    const b = planStoryboard({ prompt: "A detective in old Dhaka uncovers a 200-year-old mystery.", settings });
    expect(b.scenes).toHaveLength(4);
    expect(b.scenes.reduce((a, s) => a + s.durationSec, 0)).toBe(20);
    for (const s of b.scenes) expect(s.durationSec).toBeLessThanOrEqual(5);
  });

  it("adapts to provider clip limits", () => {
    const b = planStoryboard({
      prompt: "An astronaut finds a glowing garden on a station.",
      settings: { ...settings, durationSec: 20 },
      providerMaxClipSec: 10
    });
    expect(b.scenes).toHaveLength(2);
  });

  it("extracts characters with reusable fixed descriptions", () => {
    const b = planStoryboard({ prompt: "Detective Elena Marsh investigates the haunted lighthouse.", settings });
    expect(b.characters.length).toBeGreaterThanOrEqual(1);
    for (const c of b.characters) expect(c.fixedDescription.length).toBeGreaterThan(20);
    // every scene references the cast and stamps identity
    for (const s of b.scenes) {
      expect(s.characterIds.length).toBe(b.characters.length);
      expect(s.visualPrompt).toContain(b.characters[0].fixedDescription.slice(0, 30));
    }
  });

  it("keeps narrative continuity (no unexplained teleports)", () => {
    const b = planStoryboard({ prompt: "A young chef opens a restaurant by the sea.", settings });
    expect(b.scenes[1].visualPrompt).toMatch(/Continues directly from scene 1/i);
  });

  it("rejects too-short prompts instead of faking a plan", () => {
    expect(() => planStoryboard({ prompt: "hi", settings })).toThrow();
  });

  it("is deterministic for the same prompt", () => {
    const a = planStoryboard({ prompt: "A haunted lighthouse keeper finds a lost letter.", settings });
    const b2 = planStoryboard({ prompt: "A haunted lighthouse keeper finds a lost letter.", settings });
    expect(a.characters[0].fixedDescription).toBe(b2.characters[0].fixedDescription);
  });
});
