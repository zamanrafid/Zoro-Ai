export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { dataDir, getProject, saveProject, newId } from "@/lib/store";
import {
  createReplicatePrediction,
  indexJob,
  listProviders
} from "@/lib/providers";
import { freeTierNote } from "@/lib/free";
import { stillDims } from "@/lib/jobs";
import { getWorkerBase, workerStartJob } from "@/lib/worker";
import type { GenerationJob } from "@/lib/types";

/**
 * POST: start a generation job for one scene.
 * Body: { sceneId, kind?: "video" | "still" }
 * - kind "still": free still, or YOUR worker when the project uses it.
 * - kind "video": per project.providerId (slideshow / worker / replicate / huggingface).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  let body: { sceneId?: string; kind?: string; seed?: number } = {};
  try { body = await req.json(); } catch { /* sceneId required below */ }
  const scene = p.scenes.find((s) => s.id === body.sceneId);
  if (!scene) return NextResponse.json({ error: "sceneId must match a scene in this project." }, { status: 400 });
  const kind = body.kind === "still" ? "still" : "video";

  const now = new Date().toISOString();
  const job: GenerationJob = {
    id: newId("job_"),
    sceneId: scene.id,
    providerId: kind === "still" ? "free-still" : p.providerId,
    status: "queued",
    progress: 0,
    logs: [],
    seed: body.seed ?? Math.floor(Math.random() * 100000),
    createdAt: now,
    updatedAt: now
  };

  if (kind === "still") {
    if (p.providerId === "worker") {
      job.providerId = "worker-still";
      job.logs.push("Still queued on YOUR model server (no third parties).");
    } else {
      job.logs.push(`Free still queued for scene ${scene.index + 1} (Pollinations, no key). ${freeTierNote()}`);
    }
    p.jobs.push(job);
    await saveProject(p);
    await indexJob(p.id, job.id);
    return NextResponse.json({ job }, { status: 201 });
  }

  // kind === "video"
  const provider = listProviders().find((x) => x.id === p.providerId) ?? listProviders()[0];

  if (provider.id === "slideshow") {
    job.logs.push("Free Movie Mode: AI still + cinematic motion, rendered on your PC. No cost, no key.");
    p.jobs.push(job);
    await saveProject(p);
    await indexJob(p.id, job.id);
    return NextResponse.json({ job }, { status: 201 });
  }

  if (provider.requiresApiKey && !provider.configured) {
    return NextResponse.json(
      { error: `${provider.label} is not configured. ${provider.missing} No request was sent and nothing was charged. Tip: switch the project to "Free Movie Mode" for a 100% free pipeline.` },
      { status: 409 }
    );
  }
  if (provider.id === "worker") {
    if (!getWorkerBase()) {
      return NextResponse.json(
        { error: "WORKER_URL is not set. Run worker-server/example.py (or your own server per worker-server/README) and set WORKER_URL in .env.local. Nothing was sent anywhere." },
        { status: 409 }
      );
    }
    try {
      const dims = stillDims(p.settings.aspectRatio);
      // Forward the first approved character reference as data (your model decides how to use it).
      let referenceImageDataUrl: string | undefined;
      for (const cid of scene.characterIds) {
        const ch = p.characters.find((c) => c.id === cid);
        if (ch?.approved && ch.referenceImagePath) {
          try {
            const abs = path.join(dataDir(), ch.referenceImagePath);
            const st = await fs.stat(abs);
            if (st.size < 6 * 1024 * 1024) {
              const ext = ch.referenceImagePath.toLowerCase().endsWith(".png") ? "png" : "jpeg";
              referenceImageDataUrl = `data:image/${ext};base64,${(await fs.readFile(abs)).toString("base64")}`;
            }
          } catch { /* ref unreadable — send without it */ }
          break;
        }
      }
      const started = await workerStartJob({
        kind: "clip",
        prompt: scene.visualPrompt,
        negativePrompt: scene.negativePrompt ?? p.negativePrompt,
        width: dims.width,
        height: dims.height,
        durationSec: scene.durationSec,
        seed: job.seed,
        referenceImageDataUrl
      });
      job.providerJobId = started.jobId;
      job.status = "processing";
      job.model = "worker";
      job.logs.push(`Your worker accepted clip job ${started.jobId}. No third party involved.`);
    } catch (e) {
      job.status = "failed";
      job.error = e instanceof Error ? e.message : "Worker request failed.";
      job.logs.push(job.error);
    }
    p.jobs.push(job);
    await saveProject(p);
    await indexJob(p.id, job.id);
    return NextResponse.json({ job }, { status: 201 });
  }

  if (provider.id === "replicate") {
    try {
      const refUrls: string[] = [];
      const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
      for (const cid of scene.characterIds) {
        const ch = p.characters.find((c) => c.id === cid);
        if (ch?.approved && ch.referenceImagePath && base) {
          refUrls.push(`${base}/api/media/${ch.referenceImagePath}`);
        }
      }
      const pred = await createReplicatePrediction({
        prompt: scene.visualPrompt,
        negativePrompt: scene.negativePrompt ?? p.negativePrompt,
        referenceImageUrls: refUrls
      });
      job.providerJobId = pred.id;
      job.status = "processing";
      job.model = process.env.REPLICATE_VIDEO_MODEL;
      job.logs.push(`Replicate prediction ${pred.id} created (status: ${pred.status}). PAID generation — check Replicate billing.`);
      if (!refUrls.length && scene.characterIds.length) {
        job.logs.push("Note: no approved reference images were attached (approve character art first, and set PUBLIC_BASE_URL so the provider can fetch it).");
      }
    } catch (e) {
      job.status = "failed";
      job.error = e instanceof Error ? e.message : "Replicate request failed.";
      job.logs.push(`Failed before any generation: ${job.error}`);
    }
    p.jobs.push(job);
    await saveProject(p);
    await indexJob(p.id, job.id);
    return NextResponse.json({ job }, { status: 201 });
  }

  if (provider.id === "huggingface") {
    job.status = "failed";
    job.error =
      "Hugging Face video adapter is an integration point in this build: set HF_TOKEN and HF_VIDEO_MODEL, " +
      "then confirm the model's exact router payload on huggingface.co/docs before generating. Nothing was charged.";
    job.logs.push(job.error);
    p.jobs.push(job);
    await saveProject(p);
    await indexJob(p.id, job.id);
    return NextResponse.json({ job }, { status: 201 });
  }

  return NextResponse.json({ error: `Unknown provider: ${provider.id}` }, { status: 400 });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  return NextResponse.json({ jobs: p.jobs ?? [] });
}
