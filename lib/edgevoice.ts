import { spawn } from "child_process";
import { existsSync, readdirSync } from "fs";
import path from "path";

/**
 * Natural neural voiceover via the free Microsoft Edge TTS service
 * (edge-tts CLI — no key, no account, human-like voices incl. Bangla).
 * Verified: edge-tts 7.x, voices like en-US-AriaNeural, bn-BD-NabanitaNeural.
 * Install: pip install edge-tts
 */

export const EDGE_VOICES = [
  { id: "aria", label: "Aria — English female, natural", edge: "en-US-AriaNeural" },
  { id: "guy", label: "Guy — English male, natural", edge: "en-US-GuyNeural" },
  { id: "emma", label: "Emma — English, expressive", edge: "en-US-EmmaMultilingualNeural" },
  { id: "nabanita", label: "Nabanita — Bangla female", edge: "bn-BD-NabanitaNeural" },
  { id: "pradeep", label: "Pradeep — Bangla male", edge: "bn-BD-PradeepNeural" }
] as const;

export type EdgeVoiceId = (typeof EDGE_VOICES)[number]["id"];

export function edgeVoiceName(id: string): string | null {
  return EDGE_VOICES.find((v) => v.id === id)?.edge ?? null;
}

function candidateCmds(): Array<{ cmd: string; args: string[] }> {
  const out: Array<{ cmd: string; args: string[] }> = [{ cmd: "edge-tts", args: [] }];
  const pyRoots = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Python") : "",
    process.env.APPDATA ? path.join(process.env.APPDATA, "Python") : ""
  ];
  for (const root of pyRoots) {
    if (!root || !existsSync(root)) continue;
    // Python312/Scripts/edge-tts.exe (any 3.x version dir)
    try {
      for (const d of readdirSync(root)) {
        const exe = path.join(root, d, "Scripts", "edge-tts.exe");
        if (existsSync(exe)) out.push({ cmd: exe, args: [] });
      }
    } catch {
      // ignore
    }
  }
  out.push({ cmd: "python", args: ["-m", "edge_tts"] });
  return out;
}

let cached: { cmd: string; args: string[] } | null | undefined;

async function resolveEdgeTts(): Promise<{ cmd: string; args: string[] } | null> {
  if (cached !== undefined) return cached;
  for (const c of candidateCmds()) {
    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn(c.cmd, [...c.args, "--help"], { stdio: "ignore" });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
      setTimeout(() => resolve(false), 10000);
    });
    if (ok) {
      cached = c;
      return c;
    }
  }
  cached = null;
  return null;
}

export async function checkEdgeTts(): Promise<{ ok: boolean; detail?: string }> {
  const c = await resolveEdgeTts();
  return c ? { ok: true, detail: "edge-tts ready (natural neural voices, free)" } : { ok: false };
}

/** Synthesize one chunk to MP3. Throws with install help when unavailable. */
export async function edgeTtsMp3(text: string, voiceId: string, mp3AbsPath: string): Promise<void> {
  const c = await resolveEdgeTts();
  if (!c) {
    throw new Error("Natural voice needs the free edge-tts tool. Install with: pip install edge-tts (then restart the server).");
  }
  const edge = edgeVoiceName(voiceId) ?? "en-US-AriaNeural";
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 1500);
  if (!clean) throw new Error("Empty narration text.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(c.cmd, [...c.args, "--voice", edge, "--text", clean, "--write-media", mp3AbsPath], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let err = "";
    child.stderr?.on("data", (d) => (err += String(d).slice(-500)));
    child.on("error", (e) => reject(new Error(`Could not launch edge-tts: ${e.message}`)));
    const killer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      reject(new Error("Natural voice timed out (2 min). Check internet and retry."));
    }, 120000);
    child.on("close", (code) => {
      clearTimeout(killer);
      if (code === 0) resolve();
      else reject(new Error(`Natural voice failed (exit ${code}). ${err || "Check internet and retry."}`));
    });
  });
}
