import { describe, it, expect } from "vitest";
import { chunkText, ttsUrl, stillUrl, freeTierNote, FREE_VOICES } from "../lib/free";
import { edgeVoiceName, EDGE_VOICES } from "../lib/edgevoice";
import { listProviders } from "../lib/providers";

describe("free pipeline helpers", () => {
  it("uses verified Pollinations endpoints (no invented hosts)", () => {
    expect(stillUrl({ prompt: "a cat", width: 768, height: 1344, seed: 7 })).toMatch(
      /^https:\/\/image\.pollinations\.ai\/prompt\//
    );
    expect(ttsUrl("hello", "nova")).toMatch(/^https:\/\/text\.pollinations\.ai\//);
    expect(ttsUrl("hello", "nova")).toContain("model=openai-audio");
  });

  it("falls back to a known voice for unknown input", () => {
    expect(ttsUrl("hi", "not-a-voice")).toContain("voice=nova");
    expect(FREE_VOICES).toContain("nova");
  });

  it("maps natural voice ids (men + women) to Edge voices", () => {
    expect(edgeVoiceName("aria")).toBe("en-US-AriaNeural");
    expect(edgeVoiceName("guy")).toBe("en-US-GuyNeural");
    expect(edgeVoiceName("jenny")).toBe("en-US-JennyNeural");
    expect(edgeVoiceName("davis")).toBe("en-US-DavisNeural");
    expect(edgeVoiceName("nabanita")).toBe("bn-BD-NabanitaNeural");
    expect(edgeVoiceName("nope")).toBeNull();
    expect(EDGE_VOICES.length).toBeGreaterThanOrEqual(7);
  });

  it("adds AI enhance only for Best quality stills", () => {
    const base = { prompt: "x", width: 768, height: 1344, seed: 1 };
    expect(stillUrl(base)).not.toContain("enhance=true");
    expect(stillUrl({ ...base, enhance: true })).toContain("enhance=true");
  });

  it("requests watermark removal only when authenticated", () => {
    delete process.env.POLLINATIONS_TOKEN;
    expect(stillUrl({ prompt: "x", width: 8, height: 8, seed: 1 })).toContain("nologo=false");
    expect(freeTierNote()).toMatch(/anonymous/);
  });

  it("chunks long narration into GET-safe pieces", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("short text")).toEqual(["short text"]);
    const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} carries the story forward.`).join(" ");
    const chunks = chunkText(long, 700);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(700);
    expect(chunks.join(" ")).toBe(long.replace(/\s+/g, " ").trim());
  });

  it("slideshow provider is free, keyless and configured", () => {
    const s = listProviders().find((p) => p.id === "slideshow")!;
    expect(s.configured).toBe(true);
    expect(s.requiresApiKey).toBe(false);
    expect(s.costNote).toMatch(/free/i);
  });
});
