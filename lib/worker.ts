/**
 * "Your own model" worker contract (ZORO AI side).
 *
 * Run ANY image/video model on YOUR hardware, expose these two endpoints,
 * set WORKER_URL — ZORO AI drives it with zero third-party dependence:
 *
 *   POST {WORKER_URL}/v1/generate
 *     { kind: "still"|"clip", prompt, negativePrompt?, width, height,
 *       durationSec?, seed?, referenceImageDataUrl? }
 *     → 201 { jobId }
 *
 *   GET {WORKER_URL}/v1/jobs/{jobId}
 *     → { status: "queued"|"processing"|"succeeded"|"failed",
 *         outputUrl?, error? }
 *     outputUrl must be directly downloadable (jpg/png/mp4/webm).
 *
 * See worker-server/example.py for a runnable reference server.
 */

export interface WorkerGenerateInput {
  kind: "still" | "clip";
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  durationSec?: number;
  seed?: number;
  referenceImageDataUrl?: string;
}

export function getWorkerBase(): string | null {
  const u = (process.env.WORKER_URL ?? "").trim().replace(/\/$/, "");
  if (!u) return null;
  if (!/^https?:\/\/.+/.test(u) || u.length > 300) return null;
  return u;
}

/** Pure builder (unit-tested) — shapes the request your server receives. */
export function buildWorkerRequest(input: WorkerGenerateInput): Record<string, unknown> {
  return {
    kind: input.kind,
    prompt: input.prompt.slice(0, 4000),
    negativePrompt: (input.negativePrompt ?? "").slice(0, 1000),
    width: Math.max(64, Math.min(2048, Math.round(input.width))),
    height: Math.max(64, Math.min(2048, Math.round(input.height))),
    durationSec: input.kind === "clip" ? Math.max(1, Math.min(30, Math.round(input.durationSec ?? 5))) : undefined,
    seed: Math.floor(input.seed ?? Math.random() * 100000),
    referenceImageDataUrl: input.referenceImageDataUrl
  };
}

export async function workerStartJob(input: WorkerGenerateInput): Promise<{ jobId: string }> {
  const base = getWorkerBase();
  if (!base) throw new Error("WORKER_URL is not set. Run your own model server and set WORKER_URL in .env.local — see worker-server/README.");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(`${base}/v1/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildWorkerRequest(input)),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Your worker refused the job (${res.status}). ${txt.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!data?.jobId) throw new Error("Your worker answered without a jobId. It must follow the contract in worker-server/README.");
    return { jobId: String(data.jobId) };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("Your worker did not answer in 30s. Is it running? Check WORKER_URL.");
    }
    throw e instanceof Error ? e : new Error("Worker request failed.");
  } finally {
    clearTimeout(t);
  }
}

export interface WorkerStatus {
  status: "queued" | "processing" | "succeeded" | "failed" | "cancelled";
  outputUrl?: string;
  error?: string;
}

export async function workerPoll(jobId: string): Promise<WorkerStatus> {
  const base = getWorkerBase();
  if (!base) throw new Error("WORKER_URL is not set.");
  const res = await fetch(`${base}/v1/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error(`Worker status check failed (${res.status}). Is your server still running?`);
  const data = await res.json();
  const st = String(data?.status ?? "");
  if (!["queued", "processing", "succeeded", "failed", "cancelled"].includes(st)) {
    throw new Error("Your worker returned an unknown status. Contract: queued|processing|succeeded|failed|cancelled.");
  }
  return { status: st as WorkerStatus["status"], outputUrl: data?.outputUrl, error: data?.error };
}
