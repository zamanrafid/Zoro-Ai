export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { dataDir, getProject, saveProject, saveUpload, newId } from "@/lib/store";
import { checkFfmpeg } from "@/lib/providers";
import {
  MAX_SOURCE_BYTES,
  cutSegment,
  downloadYouTube,
  isYouTubeUrl,
  planShorts,
  probeVideo,
  toVertical720x1280
} from "@/lib/source";
import { indexJob } from "@/lib/providers";
import type { GenerationJob, ScenePlan } from "@/lib/types";

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Source-video hub (all FREE, local tools):
 * - POST { youtubeUrl } → import a public YouTube video (rights: only yours / licensed).
 * - POST { upload: { filename, dataUrl } } → upload mp4/webm/mov (≤300MB via form).
 * - POST { action: "shorts", segSec?, startSec? } → cut vertical Shorts + attach as scenes.
 * - GET → source info + shorts list.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  // ---- YouTube import ----
  if (typeof body.youtubeUrl === "string") {
    const url = body.youtubeUrl.trim();
    if (!isYouTubeUrl(url)) {
      return NextResponse.json({ error: "Only youtube.com/watch, /shorts, /live or youtu.be links are accepted." }, { status: 400 });
    }
    try {
      const rel = `media/source/${p.id}/source.mp4`.replace(/\\/g, "/");
      await downloadYouTube(url, path.join(dataDir(), rel));
      const probe = await probeVideo(path.join(dataDir(), rel));
      p.sourceVideoPath = rel;
      p.sourceDurationSec = Math.round(probe.durationSec * 10) / 10;
      p.sourceTitle = url;
      await saveProject(p);
      return NextResponse.json({
        project: p,
        note: `Imported ${fmtTime(probe.durationSec)} of video (${probe.width}x${probe.height}). Only use videos you own or have rights to.`
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Import failed." }, { status: 422 });
    }
  }

  // ---- Direct upload ----
  if (body.upload && typeof body.upload === "object") {
    const up = body.upload as Record<string, string>;
    try {
      const rel = await saveUpload(
        p.id, "source", up.filename ?? "upload.mp4", up.dataUrl ?? "",
        /^video\/(mp4|webm|quicktime|x-matroska)$/, 300 * 1024 * 1024
      );
      const probe = await probeVideo(path.join(dataDir(), rel));
      if (probe.durationSec > 1800) {
        await fs.unlink(path.join(dataDir(), rel)).catch(() => undefined);
        return NextResponse.json({ error: "Video is longer than 30 minutes — use a shorter one." }, { status: 400 });
      }
      p.sourceVideoPath = rel;
      p.sourceDurationSec = Math.round(probe.durationSec * 10) / 10;
      p.sourceTitle = up.filename ?? "upload";
      await saveProject(p);
      return NextResponse.json({ project: p, note: `Uploaded ${fmtTime(probe.durationSec)} of video.` });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed." }, { status: 400 });
    }
  }

  // ---- Cut Shorts ----
  if (body.action === "shorts") {
    if (!p.sourceVideoPath) {
      return NextResponse.json({ error: "Import a YouTube video or upload one first." }, { status: 400 });
    }
    const ff = await checkFfmpeg();
    if (!ff.ok) {
      return NextResponse.json({ error: "FFmpeg is required for cutting. Install with: winget install Gyan.FFmpeg" }, { status: 422 });
    }
    const segSec = Math.max(5, Math.min(60, Math.round(Number(body.segSec) || 30)));
    const startSec = Math.max(0, Number(body.startSec) || 0);
    const total = Math.max(0, (p.sourceDurationSec ?? 0) - startSec);
    if (total < 3) return NextResponse.json({ error: "Start time is past the end of the video." }, { status: 400 });
    const maxParts = Math.max(1, Math.min(40, Math.round(Number(body.maxParts) || 12)));
    const plan = planShorts(total, segSec).slice(0, maxParts);
    try {
      const srcAbs = path.join(dataDir(), p.sourceVideoPath);
      const shorts: Array<{ path: string; startSec: number; lenSec: number }> = [];
      const now = new Date().toISOString();
      for (const [i, seg] of plan.entries()) {
        const absStart = Math.round((startSec + seg.start) * 10) / 10;
        // Cut horizontal segment, then convert to vertical Shorts.
        const cutRel = `media/source/${p.id}/cut_${i}.mp4`.replace(/\\/g, "/");
        await cutSegment(srcAbs, absStart, seg.len, cutRel);
        const vRel = `media/shorts/${p.id}/short_${i}_${Date.now()}.mp4`.replace(/\\/g, "/");
        await toVertical720x1280(path.join(dataDir(), cutRel), vRel, p.settings.quality === "best");
        await fs.unlink(path.join(dataDir(), cutRel)).catch(() => undefined);
        shorts.push({ path: vRel, startSec: absStart, lenSec: seg.len });
      }
      p.shorts = shorts;
      // Attach every Short as a real scene + finished take, so preview / takes /
      // voiceover / export flows work unchanged. Appended after existing scenes.
      const base = p.scenes.length;
      for (const [i, sh] of shorts.entries()) {
        const scene: ScenePlan = {
          id: uuidv4(),
          index: base + i,
          durationSec: Math.max(2, Math.min(60, Math.round(sh.lenSec))),
          title: `Short ${base + i + 1}`,
          visualPrompt: `Imported vertical short ${base + i + 1} (source ${fmtTime(sh.startSec)}–${fmtTime(sh.startSec + sh.lenSec)}). No text overlays, no watermark.`,
          camera: "Center-cropped vertical 9:16",
          lighting: "Source lighting",
          transitionIn: i === 0 ? "Fade in from black" : "Hard cut",
          transitionOut: "Fade to black",
          characterIds: [],
          narrationSegment: "",
          caption: `Short ${base + i + 1} (${fmtTime(sh.startSec)}–${fmtTime(sh.startSec + sh.lenSec)})`,
          sound: "Source audio"
        };
        p.scenes.push(scene);
        p.sceneOrder.push(scene.id);
        const job: GenerationJob = {
          id: newId("job_"),
          sceneId: scene.id,
          providerId: "import",
          status: "succeeded",
          progress: 100,
          clipPath: sh.path,
          posterPath: sh.path,
          logs: [`Imported Short ${i + 1}: ${fmtTime(sh.startSec)}–${fmtTime(sh.startSec + sh.lenSec)} of source, vertical 9:16.`],
          createdAt: now,
          updatedAt: now
        };
        p.jobs.push(job);
        await indexJob(p.id, job.id);
      }
      await saveProject(p);
      return NextResponse.json({
        project: p,
        note: `${shorts.length} Shorts cut (vertical 9:16) and attached as scenes — preview, voiceover and export work on them directly.`
      });
    } catch (e) {
      await saveProject(p);
      return NextResponse.json({ error: e instanceof Error ? e.message : "Cutting failed.", project: p }, { status: 422 });
    }
  }

  return NextResponse.json({ error: "Give youtubeUrl, upload {filename,dataUrl}, or action 'shorts'." }, { status: 400 });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const [yt, ff] = await Promise.all([
    import("@/lib/source").then((m) => m.checkYtdlp()),
    checkFfmpeg()
  ]);
  return NextResponse.json({
    source: p.sourceVideoPath
      ? { path: p.sourceVideoPath, durationSec: p.sourceDurationSec ?? 0, title: p.sourceTitle ?? "" }
      : null,
    shorts: p.shorts ?? [],
    tools: {
      ytdlp: yt.ok
        ? { ok: true }
        : { ok: false, help: "Install free with: winget install yt-dlp.yt-dlp" },
      ffmpeg: ff.ok ? { ok: true } : { ok: false, help: "Install free with: winget install Gyan.FFmpeg" }
    },
    limits: { maxBytes: MAX_SOURCE_BYTES, maxSec: 1800, segMin: 5, segMax: 60 },
    rights: "Only import videos you own or have rights to use."
  });
}
