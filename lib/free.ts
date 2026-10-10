/**
 * Free-tier helpers (Pollinations.ai — no API key required).
 *
 * Verified against https://github.com/pollinations/pollinations/blob/master/APIDOCS.md :
 * - Images: GET https://image.pollinations.ai/prompt/{prompt}?width=&height=&seed=&model=&nologo=&referrer=
 * - TTS:    GET https://text.pollinations.ai/{text}?model=openai-audio&voice={voice}  → MP3
 * - Text:   GET https://text.pollinations.ai/{prompt}?model=&json=
 *
 * Tiers: anonymous ≈1 req/15s; free registration (auth.pollinations.ai) raises
 * limits and unlocks nologo. Free-tier images MAY carry a watermark — never
 * hidden from the user. Optional POLLINATIONS_TOKEN env adds Bearer auth.
 */

import { spawn } from "child_process";
import { espeakBin } from "./tools";

export const FREE_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
export type FreeVoice = (typeof FREE_VOICES)[number];

function authHeaders(): Record<string, string> {
  const t = process.env.POLLINATIONS_TOKEN;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function referrerParam(): string {
  const r = process.env.POLLINATIONS_REFERRER ?? "zoro-ai-local";
  return `referrer=${encodeURIComponent(r)}`;
}

export async function fetchBuffer(url: string, timeoutMs = 120000, minBytes = 2048): Promise<Buffer> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: authHeaders(), signal: ctrl.signal });
    if (res.status === 429) {
      throw new Error("Free image/voice service is rate-limited (anonymous ≈1 request / 15s). Wait a little and retry — your project is saved.");
    }
    if (res.status >= 500 && res.status <= 599) {
      throw new Error(
        `Free service is struggling on its side (HTTP ${res.status}). Nothing is lost — keep the page open, retrying automatically.`
      );
    }
    if (res.status === 402) {
      throw new Error(
        "Free service refused with HTTP 402 (registration or payment required right now). Fix (free): register at https://auth.pollinations.ai and set POLLINATIONS_TOKEN in .env.local — or wait and retry, limits reset over time. Your project is saved."
      );
    }
    if (!res.ok) throw new Error(`Free service returned ${res.status}. It may be busy — wait and retry.`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < minBytes) throw new Error("Free service returned an empty response — treating as failure, not success.");
    return buf;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("Free service timed out. Check your internet connection and retry.");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export interface StillSpec {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  model?: string;
}

export function stillUrl(s: StillSpec): string {
  const nologo = process.env.POLLINATIONS_TOKEN ? "true" : "false";
  const q = `width=${s.width}&height=${s.height}&seed=${s.seed}&model=${encodeURIComponent(s.model ?? "flux")}&nologo=${nologo}&${referrerParam()}`;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(s.prompt)}?${q}`;
}

export async function fetchStill(s: StillSpec): Promise<Buffer> {
  return fetchBuffer(stillUrl(s), 180000);
}

/** Split long narration into GET-safe chunks (URL length limits). */
export function chunkText(text: string, maxLen = 700): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + " " + s).trim().length > maxLen && cur) {
      out.push(cur.trim());
      cur = s;
    } else {
      cur = (cur + " " + s).trim();
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

export function ttsUrl(text: string, voice: string): string {
  const v = (FREE_VOICES as readonly string[]).includes(voice) ? voice : "nova";
  return `https://text.pollinations.ai/${encodeURIComponent(text)}?model=openai-audio&voice=${v}&${referrerParam()}`;
}

export async function fetchTtsMp3(text: string, voice: string): Promise<Buffer> {
  return fetchBuffer(ttsUrl(text, voice), 120000);
}

/** Free-tier busy signals worth retrying automatically instead of failing instantly. */
export function isRetriableFreeError(msg: string): boolean {
  return /(402|429|rate-limited|timed out|empty response|fetch failed|econn|socket hang up|eai_again|temporarily|http 50[0234]|struggling on its side)/i.test(msg);
}

/** Free LLM call for storyboard planning. Returns parsed JSON or throws (caller falls back to offline). */
export async function fetchFreePlannerJson(system: string, user: string): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        model: process.env.POLLINATIONS_TEXT_MODEL ?? "openai",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.7,
        max_tokens: 3000
      }),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`free planner ${res.status}`);
    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    // Never execute model text — strict JSON parse only, then shape-checked by caller.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no json");
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } finally {
    clearTimeout(t);
  }
}

export function freeTierNote(): string {
  return process.env.POLLINATIONS_TOKEN
    ? "Pollinations authenticated (higher limits, watermark removal requested)."
    : "Pollinations free anonymous tier (≈1 request / 15s). Free-tier images may include a watermark — free registration at auth.pollinations.ai raises limits and unlocks removal.";
}

/* ---------------- Offline fallback: eSpeak NG (free, local, robotic) ---------------- */

export async function checkEspeak(): Promise<{ ok: boolean; version?: string }> {
  const bins = [espeakBin(), "espeak-ng", "espeak"].filter((b): b is string => Boolean(b));
  for (const bin of [...new Set(bins)]) {
    const found = await new Promise<{ ok: boolean; version?: string }>((resolve) => {
      const child = spawn(bin, ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      child.stdout?.on("data", (d) => (out += String(d)));
      child.on("error", () => resolve({ ok: false }));
      child.on("close", (code) =>
        code === 0 ? resolve({ ok: true, version: out.split("\n")[0]?.slice(0, 80) }) : resolve({ ok: false })
      );
      setTimeout(() => resolve({ ok: false }), 8000);
    });
    if (found.ok) return found;
  }
  return { ok: false };
}

/** Speak text to a WAV file with eSpeak NG. Throws with install help if missing. */
export async function espeakToWav(text: string, wavAbsPath: string, speed = 170): Promise<void> {
  const es = await checkEspeak();
  if (!es.ok) {
    throw new Error(
      "No free voice engine available: hosted TTS refused (likely needs free registration or paid tier) " +
        "and eSpeak NG is not installed. Install it free with: winget install eSpeak-NG.eSpeak-NG"
    );
  }
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 1500);
  if (!clean) throw new Error("Empty narration text.");
  await new Promise<void>((resolve, reject) => {
    const first = espeakBin() ?? "espeak-ng";
    const tryBin = (bin: string) => {
      const child = spawn(bin, ["-v", "en", "-s", String(speed), "-w", wavAbsPath, clean], { stdio: "ignore" });
      child.on("error", () => (bin !== "espeak" ? tryBin("espeak") : reject(new Error("Could not launch eSpeak."))));
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`eSpeak failed (exit ${code}).`))));
    };
    tryBin(first);
  });
}
