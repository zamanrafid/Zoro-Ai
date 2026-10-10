import { promises as fs } from "fs";
import path from "path";
import { dataDir, getProject, saveProject } from "./store";
import { downloadUrlToMedia, getReplicatePrediction } from "./providers";
import { fetchStill } from "./free";
import { renderStillClip } from "./ffmpeg";
import type { AspectRatio, GenerationJob, Project, ScenePlan } from "./types";

export function stillDims(aspect: AspectRatio): { width: number; height: number } {
  if (aspect === "9:16") return { width: 768, height: 1344 };
  if (aspect === "1:1") return { width: 768, height: 768 };
  return { width: 1024, height: 576 };
}

/** Throttle free-service calls across jobs (≈1 req / 15s anonymous tier). Returns true if caller may proceed. */
export async function claimFreeSlot(): Promise<boolean> {
  const lockFile = path.join(dataDir(), "free-lock.json");
  const now = Date.now();
  try {
    const raw = await fs.readFile(lockFile, "utf-8");
    const at = Number(JSON.parse(raw).at ?? 0);
    if (now - at < 16000) return false;
  } catch {
    // no lock yet — proceed
  }
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(lockFile, JSON.stringify({ at: now }), "utf-8");
  return true;
}

export function stillPromptFor(project: Project, scene: ScenePlan): string {
  const cast = scene.characterIds
    .map((cid) => project.characters.find((c) => c.id === cid)?.fixedDescription)
    .filter(Boolean)
    .join(" ");
  return (
    `Cinematic film still, ${project.settings.style} style, ${scene.visualPrompt} ` +
    (cast ? `Characters (keep exact identity): ${cast}. ` : "") +
    `No text, no watermark, no logo, no distorted faces, no extra limbs.`
  ).slice(0, 900);
}

export async function materializeStill(
  project: Project,
  scene: ScenePlan,
  job: GenerationJob
): Promise<{ rel: string }> {
  const dims = stillDims(project.settings.aspectRatio);
  const seed = job.seed ?? Math.floor(Math.random() * 100000);
  const buf = await fetchStill({ prompt: stillPromptFor(project, scene), ...dims, seed });
  const rel = `media/stills/${project.id}/${scene.id}_${seed}.jpg`.replace(/\\/g, "/");
  const abs = path.join(dataDir(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buf);
  scene.stillPath = rel;
  job.posterPath = rel;
  return { rel };
}

/** Advance exactly one job and persist. Handles free stills, slideshow clips, replicate. */
export async function pollOneJob(projectId: string, jobId: string) {
  const p = await getProject(projectId);
  if (!p) return null;
  const job = (p.jobs ?? []).find((j) => j.id === jobId);
  if (!job) return null;
  if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
    return { project: p, job };
  }
  const scene = p.scenes.find((s) => s.id === job.sceneId);

  // FREE still image job (providerId "free-still")
  if (job.providerId === "free-still") {
    if (!scene) {
      job.status = "failed";
      job.error = "Scene for this job no longer exists (storyboard was replanned).";
    } else if (!(await claimFreeSlot())) {
      job.status = "processing";
      job.logs.push("Waiting for a free-service slot (≈1 request / 15s on the anonymous tier)…");
    } else {
      try {
        job.status = "processing";
        await materializeStill(p, scene, job);
        job.status = "succeeded";
        job.progress = 100;
        job.logs.push("Free AI still saved. It will be reused for this scene's movie clip.");
      } catch (e) {
        job.status = "failed";
        job.error = e instanceof Error ? e.message : "Still generation failed.";
        job.logs.push(job.error);
      }
    }
    await saveProject(p);
    return { project: p, job };
  }

  // FREE MOVIE MODE: still (+fetch if needed) then motion render.
  if (job.providerId === "slideshow") {
    if (!scene) {
      job.status = "failed";
      job.error = "Scene for this job no longer exists (storyboard was replanned).";
      await saveProject(p);
      return { project: p, job };
    }
    try {
      if (!scene.stillPath) {
        if (!(await claimFreeSlot())) {
          job.status = "processing";
          job.progress = 10;
          job.logs.push("Waiting for a free-service slot to fetch the scene still…");
        } else {
          job.status = "processing";
          job.progress = 20;
          job.logs.push("Fetching free AI still for this scene…");
          await materializeStill(p, scene, job);
          job.logs.push("Still ready — rendering motion next poll.");
          job.progress = 45;
        }
      } else {
        job.status = "processing";
        job.progress = 70;
        job.logs.push("Rendering cinematic motion locally with FFmpeg (free)…");
        const stillAbs = path.join(dataDir(), scene.stillPath);
        const rel = `media/clips/${p.id}/${job.id}.mp4`.replace(/\\/g, "/");
        await renderStillClip(stillAbs, rel, scene.durationSec, p.settings.aspectRatio, scene.index);
        try {
          const st = await fs.stat(path.join(dataDir(), rel));
          if (st.size < 1024) throw new Error("empty render");
        } catch {
          throw new Error("Motion render produced an empty file — retry the scene.");
        }
        job.clipPath = rel;
        if (!job.posterPath) job.posterPath = scene.stillPath;
        job.status = "succeeded";
        job.progress = 100;
        job.logs.push("Free clip ready: AI still + motion (honestly not AI video diffusion).");
      }
    } catch (e) {
      job.status = "failed";
      job.error = e instanceof Error ? e.message : "Free clip failed.";
      job.logs.push(job.error);
    }
    await saveProject(p);
    return { project: p, job };
  }

  if (job.providerId === "replicate" && job.providerJobId) {
    try {
      const pred = await getReplicatePrediction(job.providerJobId);
      if (pred.status === "succeeded") {
        const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
        if (typeof out === "string" && /^https?:\/\//.test(out)) {
          const rel = `media/clips/${p.id}/${job.id}.mp4`.replace(/\\/g, "/");
          await downloadUrlToMedia(out, rel);
          job.clipPath = rel;
          job.status = "succeeded";
          job.progress = 100;
          job.logs.push("Provider reported success; output downloaded to project storage.");
        } else {
          job.status = "failed";
          job.error = "Provider reported success but returned no downloadable video URL. Treating as failure (no fake success).";
          job.logs.push(job.error);
        }
      } else if (pred.status === "failed" || pred.status === "canceled") {
        job.status = pred.status === "canceled" ? "cancelled" : "failed";
        job.error = pred.error ?? `Provider job ${pred.status}.`;
        job.logs.push(job.error);
      } else {
        job.status = "processing";
        job.progress = Math.min(95, (job.progress ?? 10) + 7);
        job.logs.push(`Provider status: ${pred.status}.`);
      }
    } catch (e) {
      job.status = "failed";
      job.error = e instanceof Error ? e.message : "Status check failed.";
      job.logs.push(job.error);
    }
    await saveProject(p);
    return { project: p, job };
  }
  return { project: p, job };
}
