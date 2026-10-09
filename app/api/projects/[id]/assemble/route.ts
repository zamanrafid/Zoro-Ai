export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/store";
import { assembleProject } from "@/lib/ffmpeg";

/** POST /api/projects/[id]/assemble — render final MP4 with FFmpeg. Body: { burnCaptions?, narrationVolume?, musicVolume? } */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (!p.scenes.length) return NextResponse.json({ error: "Plan the storyboard first — there are no scenes to assemble." }, { status: 400 });

  let body: { burnCaptions?: boolean; narrationVolume?: number; musicVolume?: number } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const burnCaptions = body.burnCaptions ?? p.burnCaptions ?? false;
  p.burnCaptions = burnCaptions;
  if (typeof body.narrationVolume === "number") p.narrationVolume = body.narrationVolume;
  if (typeof body.musicVolume === "number") p.musicVolume = body.musicVolume;

  p.output = { status: "processing", updatedAt: new Date().toISOString() };
  await saveProject(p);

  try {
    const { outputPath, srtPath } = await assembleProject(p, p.sceneOrder, {
      burnCaptions,
      narrationVolume: p.narrationVolume,
      musicVolume: p.musicVolume
    });
    p.output = { path: outputPath, srtPath, status: "succeeded", updatedAt: new Date().toISOString() };
    await saveProject(p);
    return NextResponse.json({
      project: p,
      note: "Export has no ZORO AI watermark. Third-party provider watermarks (if any) are never stripped — see provider terms."
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Assembly failed.";
    p.output = { status: "failed", error: msg, updatedAt: new Date().toISOString() };
    await saveProject(p);
    return NextResponse.json({ error: msg, project: p }, { status: 422 });
  }
}
