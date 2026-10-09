export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getProject, saveProject, deleteProjectFiles, newId } from "@/lib/store";
import { MAX_PROMPT, MAX_DURATION, MIN_DURATION } from "@/lib/validate";
import { z } from "zod";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) {
    return NextResponse.json(
      {
        error:
          "Project not found. Hoy delete hoye geche, noy host kora demo link-e storage reset hoyeche " +
          "(Vercel-e prottek request-e file muche jete pare). Permanent project-er jonno PC-te (npm run dev / start-zoro.bat) chalan."
      },
      { status: 404 }
    );
  }
  return NextResponse.json({ project: p });
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  prompt: z.string().min(10).max(MAX_PROMPT).optional(),
  providerId: z.string().min(1).optional(),
  settings: z
    .object({
      durationSec: z.number().min(MIN_DURATION).max(MAX_DURATION).optional(),
      aspectRatio: z.enum(["9:16", "16:9", "1:1"]).optional(),
      style: z.enum(["realistic", "cinematic-documentary", "historical", "dark-mystery", "fantasy", "animation", "custom"]).optional(),
      customStyle: z.string().max(200).optional(),
      motionIntensity: z.enum(["low", "medium", "high"]).optional(),
      cameraMovement: z.string().max(200).optional(),
      resolution: z.string().max(40).optional(),
      negativePrompt: z.string().max(1000).optional()
    })
    .optional(),
  narrationScript: z.string().max(20000).optional(),
  sceneOrder: z.array(z.string()).optional(),
  narrationVolume: z.number().min(0).max(2).optional(),
  musicVolume: z.number().min(0).max(2).optional(),
  burnCaptions: z.boolean().optional(),
  scene: z.object({ id: z.string(), data: z.record(z.unknown()) }).optional(),
  deleteSceneId: z.string().optional(),
  duplicateSceneId: z.string().optional()
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  // Rename / duplicate / delete via ?action=
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  if (action === "duplicate") {
    const now = new Date().toISOString();
    const copy = JSON.parse(JSON.stringify(p));
    copy.id = newId("proj_");
    copy.name = `${p.name} (copy)`;
    copy.jobs = [];
    copy.output = { status: "idle" as const, updatedAt: now };
    copy.createdAt = now;
    await saveProject(copy);
    return NextResponse.json({ project: copy }, { status: 201 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update.", details: parsed.error.flatten() }, { status: 400 });
  }
  const v = parsed.data;
  if (v.name !== undefined) p.name = v.name.trim() || p.name;
  if (v.prompt !== undefined) p.prompt = v.prompt;
  if (v.providerId !== undefined) p.providerId = v.providerId;
  if (v.settings !== undefined) p.settings = { ...p.settings, ...v.settings };
  if (v.narrationScript !== undefined) {
    if (v.narrationScript.length > 20000) return NextResponse.json({ error: "Narration too long." }, { status: 400 });
    p.narrationScript = v.narrationScript;
    // Keep per-scene segments in sync when line counts match
    const lines = v.narrationScript.split("\n").filter(Boolean);
    if (lines.length === p.scenes.length) {
      p.scenes = p.scenes.map((s, i) => ({ ...s, narrationSegment: lines[i] }));
    }
  }
  if (v.sceneOrder !== undefined) {
    const valid = v.sceneOrder.filter((id) => p.scenes.some((s) => s.id === id));
    if (valid.length !== p.scenes.length) {
      return NextResponse.json({ error: "sceneOrder must contain every scene id exactly once." }, { status: 400 });
    }
    p.sceneOrder = valid;
    p.scenes = valid.map((id, i) => ({ ...p.scenes.find((s) => s.id === id)!, index: i }));
  }
  if (v.narrationVolume !== undefined) p.narrationVolume = v.narrationVolume;
  if (v.musicVolume !== undefined) p.musicVolume = v.musicVolume;
  if (v.burnCaptions !== undefined) p.burnCaptions = v.burnCaptions;
  if (v.scene) {
    const sc = p.scenes.find((s) => s.id === v.scene!.id);
    if (!sc) return NextResponse.json({ error: "Scene not found." }, { status: 404 });
    const allowed = ["title", "visualPrompt", "camera", "lighting", "narrationSegment", "caption", "durationSec", "characterIds", "sound", "transitionIn", "transitionOut", "selectedJobId"] as const;
    for (const k of allowed) {
      const val = (v.scene.data as Record<string, unknown>)[k];
      if (val !== undefined) (sc as unknown as Record<string, unknown>)[k] = val;
    }
    if (typeof sc.durationSec === "number") sc.durationSec = Math.max(2, Math.min(10, Math.round(sc.durationSec)));
    // selectedJobId must point at a REAL successful clip of this scene — never blind trust.
    if (sc.selectedJobId) {
      const pick = (p.jobs ?? []).find((j) => j.id === sc.selectedJobId);
      if (!pick || pick.sceneId !== sc.id || pick.status !== "succeeded" || !pick.clipPath) {
        sc.selectedJobId = undefined;
        await saveProject(p);
        return NextResponse.json({ error: "That take is not a finished clip of this scene — selection cleared.", project: p }, { status: 400 });
      }
    }
  }
  if (v.deleteSceneId) {
    p.scenes = p.scenes.filter((s) => s.id !== v.deleteSceneId);
    p.sceneOrder = p.sceneOrder.filter((id) => id !== v.deleteSceneId);
    p.jobs = (p.jobs ?? []).filter((j) => j.sceneId !== v.deleteSceneId);
    p.scenes.forEach((s, i) => (s.index = i));
  }
  if (v.duplicateSceneId) {
    const src = p.scenes.find((s) => s.id === v.duplicateSceneId);
    if (!src) return NextResponse.json({ error: "Scene not found." }, { status: 404 });
    const copy = { ...JSON.parse(JSON.stringify(src)), id: newId("scene_") };
    const at = p.sceneOrder.indexOf(src.id);
    p.scenes.splice(at + 1, 0, copy);
    p.sceneOrder.splice(at + 1, 0, copy.id);
    p.scenes.forEach((s, i) => (s.index = i));
  }

  await saveProject(p);
  return NextResponse.json({ project: p });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  await deleteProjectFiles(p);
  return NextResponse.json({ ok: true });
}
