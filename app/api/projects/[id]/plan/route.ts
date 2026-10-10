export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/store";
import { planWithOptionalLLM } from "@/lib/planner";
import { providerMaxClip } from "@/lib/providers";

/** POST /api/projects/[id]/plan — (re)build the storyboard. Saves title/summary/script/characters/scenes. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  let body: { prompt?: string; negativePrompt?: string; keepApprovals?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // allow empty body → reuse stored prompt
  }
  const prompt = (body.prompt ?? p.prompt ?? "").trim();
  if (prompt.length < 10) {
    return NextResponse.json({ error: "Enter a story prompt of at least 10 characters first." }, { status: 400 });
  }

  // Preserve already-approved character art across replans when requested.
  const approvedBefore = new Map(
    (p.characters ?? []).filter((c) => c.approved && c.referenceImagePath).map((c) => [c.name.toLowerCase(), c])
  );

  const { board, planner } = await planWithOptionalLLM({
    prompt,
    negativePrompt: body.negativePrompt ?? p.negativePrompt ?? p.settings.negativePrompt,
    settings: p.settings,
    providerMaxClipSec: providerMaxClip(p.providerId)
  });

  if (body.keepApprovals !== false) {
    for (const c of board.characters) {
      const prev = approvedBefore.get(c.name.toLowerCase());
      if (prev) {
        c.referenceImagePath = prev.referenceImagePath;
        c.referenceImageUrl = prev.referenceImageUrl;
        c.approved = true;
      }
    }
  }

  p.prompt = prompt;
  if (body.negativePrompt !== undefined) p.negativePrompt = body.negativePrompt;
  p.title = board.title;
  p.summary = board.summary;
  p.narrationScript = board.narrationScript;
  p.characters = board.characters;
  p.scenes = board.scenes;
  p.sceneOrder = board.scenes.map((s) => s.id);
  p.negativePrompt = board.negativePrompt;
  // Replanning invalidates in-flight jobs but keeps succeeded clips for identical scene ids? No:
  // scene ids change on replan, so old jobs no longer match — mark them cancelled to stay honest.
  for (const j of p.jobs ?? []) {
    if (j.status === "queued" || j.status === "processing") {
      j.status = "cancelled";
      j.error = "Cancelled: storyboard was replanned.";
      j.updatedAt = new Date().toISOString();
    }
  }
  await saveProject(p);
  return NextResponse.json({
    project: p,
    planner,
    note: `Storyboard ready! ${board.scenes.length} scenes, ${board.characters.length} characters.`
  });
}
