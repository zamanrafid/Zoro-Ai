import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import type { AspectRatio, ProviderInfo } from "./types";
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
    return { ...m, configured: true };
  });
}

export function providerMaxClip(providerId: string): number {
  return PROVIDER_META.find((p) => p.id === providerId)?.maxClipSec ?? 5;
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
