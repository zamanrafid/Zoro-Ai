export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { dataDir, getProject, saveProject, saveUpload } from "@/lib/store";
import { buildSrt, concatMp3Parts, concatWavParts } from "@/lib/ffmpeg";
import { FREE_VOICES, checkEspeak, chunkText, espeakToWav, fetchTtsMp3, freeTierNote } from "@/lib/free";
import { MAX_SCRIPT } from "@/lib/validate";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST narration:
 * - { narrationScript } → save script (syncs per-scene segments when counts match)
 * - { audioDataUrl, filename } → attach uploaded audio
 * - { clearAudio: true } → remove audio
 * - { tts: true, voice?: "nova"|... } → FREE AI voiceover via Pollinations TTS,
 *   one MP3 per scene segment, joined locally. Anonymous tier ≈1 req/15s so this
 *   can take a minute for 4 scenes — progress is returned, nothing is faked.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  if (typeof body.narrationScript === "string") {
    if (body.narrationScript.length > MAX_SCRIPT) return NextResponse.json({ error: "Narration too long." }, { status: 400 });
    p.narrationScript = body.narrationScript;
    const lines = body.narrationScript.split("\n").filter(Boolean);
    if (lines.length === p.scenes.length) {
      p.scenes = p.scenes.map((s, i) => ({ ...s, narrationSegment: lines[i], caption: s.caption || lines[i].slice(0, 90) }));
    }
  }
  if (typeof body.audioDataUrl === "string") {
    try {
      const rel = await saveUpload(p.id, "audio", String(body.filename ?? "narration.mp3"), body.audioDataUrl, /^audio\/(mpeg|wav|ogg|x-wav)$/, 25 * 1024 * 1024);
      p.narrationAudioPath = rel;
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Audio upload failed." }, { status: 400 });
    }
  }
  if (body.clearAudio === true) p.narrationAudioPath = undefined;

  if (body.tts === true) {
    const voice = (FREE_VOICES as readonly string[]).includes(String(body.voice)) ? String(body.voice) : "nova";
    const ordered = p.sceneOrder
      .map((sid) => p.scenes.find((s) => s.id === sid))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    const segments = ordered.map((s) => s.narrationSegment?.trim() || s.caption?.trim() || "");
    const usable = segments.map((t, i) => ({ text: t, scene: i + 1 })).filter((x) => x.text);
    if (!usable.length) {
      return NextResponse.json({ error: "Write a narration script first (or keep scene captions) — there is no text to speak." }, { status: 400 });
    }
    // Engine choice: hosted AI voice if reachable, else offline eSpeak NG.
    // The hosted endpoint currently refuses anonymous callers (402/404), so the
    // offline engine is the reliable free default — reported honestly either way.
    let engine: "hosted" | "offline" = "hosted";
    try {
      await fetchTtsMp3("voice check", voice);
    } catch {
      engine = "offline";
    }
    if (engine === "offline" && !(await checkEspeak()).ok) {
      return NextResponse.json(
        {
          error:
            "Hosted TTS refused anonymous use (HTTP 402 — needs free registration or a paid tier) and eSpeak NG is not installed. " +
            "Fix (free): register at https://auth.pollinations.ai and set POLLINATIONS_TOKEN, OR install offline voice with: winget install eSpeak-NG.eSpeak-NG"
        },
        { status: 502 }
      );
    }
    try {
      const dir = path.join(dataDir(), "media", p.id, "audio");
      await fs.mkdir(dir, { recursive: true });
      const parts: string[] = [];
      const ext = engine === "hosted" ? "mp3" : "wav";
      for (const u of usable) {
        for (const chunk of chunkText(u.text, engine === "hosted" ? 700 : 1200)) {
          const partAbs = path.join(dir, `tts_${Date.now()}_${parts.length}.${ext}`);
          if (engine === "hosted") {
            // Pace free-tier requests (≈1 / 15s anonymous).
            for (let tries = 0; tries < 40; tries++) {
              const lockFile = path.join(dataDir(), "free-lock.json");
              let last = 0;
              try { last = Number(JSON.parse(await fs.readFile(lockFile, "utf-8")).at ?? 0); } catch { /* none */ }
              if (Date.now() - last >= 16000) break;
              await sleep(5000);
            }
            const buf = await fetchTtsMp3(chunk, voice);
            await fs.writeFile(partAbs, buf);
            await fs.writeFile(path.join(dataDir(), "free-lock.json"), JSON.stringify({ at: Date.now() }), "utf-8");
          } else {
            await espeakToWav(chunk, partAbs);
          }
          parts.push(partAbs);
        }
      }
      const outAbs = path.join(dir, `voiceover_${Date.now()}.${ext}`);
      if (engine === "hosted") await concatMp3Parts(parts, outAbs);
      else await concatWavParts(parts, outAbs);
      for (const part of parts) await fs.unlink(part).catch(() => undefined);
      p.narrationAudioPath = path.relative(dataDir(), outAbs).replace(/\\/g, "/");
      await saveProject(p);
      return NextResponse.json({
        project: p,
        engine,
        note:
          engine === "hosted"
            ? `Free AI voiceover ready (${voice}). ${freeTierNote()}`
            : "Free offline voiceover ready (eSpeak NG, robotic but fully free and local). For a natural AI voice, register free at auth.pollinations.ai and set POLLINATIONS_TOKEN."
      });
    } catch (e) {
      await saveProject(p);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Voiceover failed.", project: p },
        { status: e instanceof Error && /rate-limited/i.test(e.message) ? 429 : 502 }
      );
    }
  }

  await saveProject(p);
  return NextResponse.json({ project: p });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const srt = buildSrt(p, p.sceneOrder);
  return new NextResponse(srt, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
