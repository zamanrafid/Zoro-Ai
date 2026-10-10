export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { checkFfmpeg } from "@/lib/providers";
import { checkEspeak } from "@/lib/free";
import { checkYtdlp } from "@/lib/source";
import { dataDir } from "@/lib/store";

export interface HealthItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

/** Deep self-test: every local capability the video pipeline needs. All free tools. */
export async function GET(): Promise<NextResponse> {
  const isServerless = process.env.VERCEL === "1";
  const items: HealthItem[] = [];
  items.push({ id: "node", label: "App server", ok: true, detail: `Running on ${process.version}` });

  // Storage: writable AND persistent?
  try {
    const probe = path.join(dataDir(), ".health");
    await fs.writeFile(probe, "ok");
    await fs.readFile(probe, "utf-8");
    await fs.unlink(probe);
    items.push(
      isServerless
        ? {
            id: "storage",
            label: "File storage",
            ok: false,
            detail: "Serverless demo storage: files vanish between requests. Projects will 404.",
            fix: "This hosted link is demo-only. Run start-zoro.bat on your PC for real projects."
          }
        : { id: "storage", label: "File storage", ok: true, detail: `Writable: ${dataDir()}` }
    );
  } catch {
    items.push({ id: "storage", label: "File storage", ok: false, detail: "Storage is not writable.", fix: "Run locally (start-zoro.bat)." });
  }

  const [ff, es, yt] = await Promise.all([checkFfmpeg(), checkEspeak(), checkYtdlp()]);
  items.push(
    ff.ok
      ? { id: "ffmpeg", label: "Video renderer (FFmpeg)", ok: true, detail: ff.version ?? "found" }
      : { id: "ffmpeg", label: "Video renderer (FFmpeg)", ok: false, detail: "Not found — no clip or MP4 can render.", fix: "winget install Gyan.FFmpeg, then restart everything." }
  );
  items.push(
    es.ok
      ? { id: "espeak", label: "Offline voice (eSpeak)", ok: true, detail: es.version ?? "found" }
      : { id: "espeak", label: "Offline voice (eSpeak)", ok: false, detail: "Not found — free offline voiceover unavailable.", fix: "winget install eSpeak-NG.eSpeak-NG, then restart everything." }
  );
  items.push(
    yt.ok
      ? { id: "ytdlp", label: "YouTube importer (yt-dlp)", ok: true, detail: `v${yt.version ?? "found"}` }
      : { id: "ytdlp", label: "YouTube importer (yt-dlp)", ok: false, detail: "Not found — YouTube import disabled.", fix: "winget install yt-dlp.yt-dlp, then restart everything." }
  );

  // Free image service reachability (cheap models list, not a generation).
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch("https://image.pollinations.ai/models", { signal: ctrl.signal });
    clearTimeout(t);
    items.push(
      res.ok
        ? { id: "pollinations", label: "Free image service", ok: true, detail: "Reachable." }
        : { id: "pollinations", label: "Free image service", ok: false, detail: `Answered ${res.status} — may be gating free users right now.`, fix: "Wait and retry, or free-register at auth.pollinations.ai and set POLLINATIONS_TOKEN." }
    );
  } catch {
    items.push({ id: "pollinations", label: "Free image service", ok: false, detail: "Unreachable from this server.", fix: "Check internet, then retry. Free tier is flaky — jobs auto-retry." });
  }

  // Own worker (optional).
  const wbase = (process.env.WORKER_URL ?? "").trim();
  if (!wbase) {
    items.push({ id: "worker", label: "Your own model server", ok: true, detail: "Not configured (optional). Free Movie Mode needs none." });
  } else {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(`${wbase.replace(/\/$/, "")}/v1/jobs/__probe__`, { signal: ctrl.signal });
      clearTimeout(t);
      items.push({ id: "worker", label: "Your own model server", ok: true, detail: `Reachable (${res.status}).` });
    } catch {
      items.push({ id: "worker", label: "Your own model server", ok: false, detail: "WORKER_URL set but unreachable.", fix: "Start worker-server/example.py and check WORKER_URL." });
    }
  }

  const allOk = items.every((i) => i.ok);
  return NextResponse.json({
    ok: allOk,
    serverless: isServerless,
    summary: allOk
      ? "All systems ready — Auto Movie will work."
      : "Red items above are exactly why video generation fails here. Fix them, then retry.",
    items
  });
}
