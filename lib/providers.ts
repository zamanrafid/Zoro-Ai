import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import type { AspectRatio, GenerationJob, ProviderInfo, ScenePlan } from "./types";
import { dataDir, jobsDir } from "./store";

export const PROVIDER_META: Array<{
  id: string;
  label: string;
  kind: ProviderInfo["kind"];
  requiresApiKey: boolean;
  costNote: string;
  supportsReferenceImages: boolean;
  referenceNote: string;
  maxClipSec: number;
  supportedAspects: AspectRatio[];
  resolutions: string[];
}> = [
  {
    id: "slideshow",
    label: "Free Movie Mode (AI stills + motion, 100% free)",
    kind: "slideshow",
    requiresApiKey: false,
    costNote: "100% FREE: AI scene stills via Pollinations (no key) + cinematic zoom/drift motion rendered on your PC with FFmpeg. Honest label: animated AI stills, not AI video diffusion.",
    supportsReferenceImages: true,
    referenceNote: "Approved character descriptions are stamped into every still prompt, and stills reuse the same seed per scene family — good consistency for a free pipeline, but not true identity-locked video.",
    maxClipSec: 5,
    supportedAspects: ["9:16", "16:9", "1:1"],
    resolutions: ["720x1280", "1280x720", "720x720"]
  },
  {
    id: "mock",
    label: "Mock Studio (free test renderer)",
    kind: "mock",
    requiresApiKey: false,
    costNote: "Free. Clearly labeled TEST output — not AI generation. Used to verify the full workflow without spending money.",
    supportsReferenceImages: false,
    referenceNote: "Mock renderer does not do identity preservation. Approve character art here, then use a reference-capable model for real identity.",
    maxClipSec: 5,
    supportedAspects: ["9:16", "16:9", "1:1"],
    resolutions: ["720x1280", "1280x720", "720x720"]
  },
  {
    id: "replicate",
    label: "Replicate (bring your own model)",
    kind: "replicate",
    requiresApiKey: true,
    costNote: "PAID — billed by Replicate per generation second. Check the model's page for current pricing before generating.",
    supportsReferenceImages: true,
    referenceNote: "Reference-image support depends on the model you choose (e.g. image-to-video models accept an input image). ZORO AI passes approved reference stills when the model schema supports it; identity is never guaranteed.",
    maxClipSec: 5,
    supportedAspects: ["9:16", "16:9", "1:1"],
    resolutions: ["model-dependent"]
  },
  {
    id: "huggingface",
    label: "Hugging Face Inference Providers",
    kind: "huggingface",
    requiresApiKey: true,
    costNote: "Requires HF token with Inference permission; usage may bill to your Hugging Face account. Check current plan limits.",
    supportsReferenceImages: true,
    referenceNote: "image-to-video models accept a reference frame; text-to-video models generally do not preserve identity. Never guaranteed.",
    maxClipSec: 5,
    supportedAspects: ["9:16", "16:9", "1:1"],
    resolutions: ["model-dependent"]
  },
  {
    id: "local",
    label: "Local GPU worker (integration point)",
    kind: "local",
    requiresApiKey: false,
    costNote: "No per-generation fee, but needs a CUDA GPU with 12GB+ VRAM. This PC (i3, 8GB, no dedicated GPU) is NOT suitable for local video diffusion.",
    supportsReferenceImages: false,
    referenceNote: "Local worker not connected. Run the worker on suitable hardware and set LOCAL_WORKER_URL.",
    maxClipSec: 5,
    supportedAspects: ["9:16", "16:9", "1:1"],
    resolutions: ["worker-dependent"]
  }
];

export function listProviders(): ProviderInfo[] {
  return PROVIDER_META.map((m) => {
    if (m.id === "replicate") {
      const ok = Boolean(process.env.REPLICATE_API_TOKEN && process.env.REPLICATE_VIDEO_MODEL);
      return {
        ...m,
        configured: ok,
        missing: ok ? undefined : "Set REPLICATE_API_TOKEN and REPLICATE_VIDEO_MODEL in .env.local. Verify the exact model ID and pricing on replicate.com before use."
      };
    }
    if (m.id === "huggingface") {
      const ok = Boolean(process.env.HF_TOKEN && process.env.HF_VIDEO_MODEL);
      return {
        ...m,
        configured: ok,
        missing: ok ? undefined : "Set HF_TOKEN and HF_VIDEO_MODEL in .env.local. Verify model, limits and billing on huggingface.co before use."
      };
    }
    if (m.id === "local") {
      const ok = Boolean(process.env.LOCAL_WORKER_URL);
      return {
        ...m,
        configured: ok,
        missing: ok ? undefined : "No local worker connected. This is expected on low-end hardware — use Mock (free test) or configure Replicate / Hugging Face."
      };
    }
    return { ...m, configured: true };
  });
}

export function providerMaxClip(providerId: string): number {
  return PROVIDER_META.find((p) => p.id === providerId)?.maxClipSec ?? 5;
}

/** Advance a MOCK job based on elapsed time and materialize a test clip with FFmpeg if available. */
export async function advanceMockJob(job: GenerationJob, scene: ScenePlan, aspect: AspectRatio): Promise<GenerationJob> {
  const elapsed = Date.now() - new Date(job.createdAt).getTime();
  job.logs = job.logs ?? [];
  if (job.status === "queued" && elapsed > 1500) {
    job.status = "processing";
    job.progress = 25;
    job.logs.push("Mock renderer picked up the job (TEST output, not AI).");
  } else if (job.status === "processing") {
    job.progress = Math.min(95, 25 + Math.floor(elapsed / 200));
    if (elapsed > 9000) {
      const made = await renderMockClip(job, scene, aspect);
      if (made) {
        job.status = "succeeded";
        job.progress = 100;
        job.clipPath = made.clipPath;
        job.posterPath = made.posterPath;
        job.logs.push("Mock test clip rendered with FFmpeg (clearly labeled test pattern).");
      } else {
        job.status = "failed";
        job.error =
          "FFmpeg was not found, so the mock test clip could not be rendered. Install FFmpeg, then retry. " +
          "Your storyboard, characters and scene prompts are saved — nothing was lost.";
        job.logs.push("FFmpeg missing — mock render aborted with a clear error (no fake success).");
      }
    }
  }
  job.updatedAt = new Date().toISOString();
  return job;
}

function dimsFor(aspect: AspectRatio): string {
  if (aspect === "9:16") return "720x1280";
  if (aspect === "1:1") return "720x720";
  return "1280x720";
}

async function renderMockClip(
  job: GenerationJob,
  scene: ScenePlan,
  aspect: AspectRatio
): Promise<{ clipPath: string; posterPath: string } | null> {
  const ff = await checkFfmpeg();
  if (!ff.ok) return null;
  const dims = dimsFor(aspect);
  const rel = `media/mock/${job.id}.mp4`.replace(/\\/g, "/");
  const abs = path.join(dataDir(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const text = `ZORO AI MOCK TEST - Scene ${scene.index + 1}`.replace(/[:']/g, "");
  await new Promise<void>((resolve, reject) => {
    const dur = Math.max(2, Math.min(10, scene.durationSec));
    const args = [
      "-y",
      "-f", "lavfi", "-i", `testsrc2=size=${dims}:rate=30:duration=${dur}`,
      "-vf", `drawtext=text='${text}':fontsize=28:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.6`,
      "-pix_fmt", "yuv420p",
      "-c:v", "libx264",
      "-preset", "veryfast",
      abs
    ];
    const child = spawn("ffmpeg", args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  }).catch(() => null);
  try {
    await fs.stat(abs);
  } catch {
    return null;
  }
  // Poster: simple SVG referencing the clip (served as image).
  const posterRel = `media/mock/${job.id}.svg`.replace(/\\/g, "/");
  const posterAbs = path.join(dataDir(), posterRel);
  const [w, h] = dims.split("x");
  await fs.writeFile(
    posterAbs,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3B82F6"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient></defs><rect width="100%" height="100%" fill="#0B1120"/><rect width="100%" height="100%" fill="url(#g)" opacity="0.25"/><text x="50%" y="48%" fill="#F8FAFC" font-size="34" text-anchor="middle" font-family="sans-serif">MOCK TEST — Scene ${scene.index + 1}</text><text x="50%" y="56%" fill="#94A3B8" font-size="18" text-anchor="middle" font-family="sans-serif">Not AI generation</text></svg>`,
    "utf-8"
  );
  return { clipPath: rel, posterPath: posterRel };
}

/* ---------------- Real providers (verified endpoints, user-supplied keys) ---------------- */

export async function createReplicatePrediction(input: {
  prompt: string;
  negativePrompt?: string;
  referenceImageUrls?: string[];
}): Promise<{ id: string; status: string }> {
  const token = process.env.REPLICATE_API_TOKEN;
  const model = process.env.REPLICATE_VIDEO_MODEL;
  if (!token) throw new Error("REPLICATE_API_TOKEN is not set. Add it to .env.local first.");
  if (!model) throw new Error("REPLICATE_VIDEO_MODEL is not set. Copy a verified video model ID from replicate.com first.");
  // Verified: POST https://api.replicate.com/v1/predictions, Bearer auth.
  // Body accepts official "owner/name" or full "owner/name:version" identifiers.
  const res = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait" },
    body: JSON.stringify({ version: model, input: buildReplicateInput(input) })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Replicate rejected the request (${res.status}). ${t.slice(0, 300)} Check model ID, inputs and billing.`);
  }
  const data = await res.json();
  return { id: String(data.id), status: String(data.status ?? "starting") };
}

function buildReplicateInput(input: { prompt: string; negativePrompt?: string; referenceImageUrls?: string[] }): Record<string, unknown> {
  // Generic keys accepted by most video models; unknown keys are ignored per-model.
  // Users must confirm exact input schema on the chosen model's page.
  const out: Record<string, unknown> = { prompt: input.prompt };
  if (input.negativePrompt) out.negative_prompt = input.negativePrompt;
  if (input.referenceImageUrls?.length) {
    out.image = input.referenceImageUrls[0];
    out.condition_image = input.referenceImageUrls[0];
  }
  return out;
}

export async function getReplicatePrediction(id: string): Promise<{ status: string; output?: unknown; error?: string }> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN is not set.");
  const res = await fetch(`https://api.replicate.com/v1/predictions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Replicate status check failed (${res.status}). ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return { status: String(data.status), output: data.output, error: data.error ? String(data.error) : undefined };
}

export async function downloadUrlToMedia(url: string, relPath: string): Promise<string> {
  const abs = path.join(dataDir(), relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) from provider output URL.`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error("Provider returned an empty file — treating as failure, not success.");
  await fs.writeFile(abs, buf);
  return relPath;
}

/** Touch the job-index so /api/jobs/[id] can find the parent project. */
export async function indexJob(projectId: string, jobId: string): Promise<void> {
  await fs.mkdir(jobsDir(), { recursive: true });
  await fs.writeFile(path.join(jobsDir(), `${jobId}.json`), JSON.stringify({ projectId, jobId }), "utf-8");
}

export async function checkFfmpeg(): Promise<{ ok: boolean; version?: string }> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-version"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout?.on("data", (d) => (out += String(d)));
    child.on("error", () => resolve({ ok: false }));
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true, version: out.split("\n")[0]?.slice(0, 120) });
      else resolve({ ok: false });
    });
    setTimeout(() => resolve({ ok: false }), 8000);
  });
}
