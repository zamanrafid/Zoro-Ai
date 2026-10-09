export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { listProjects, saveProject, newId } from "@/lib/store";
import { createProjectSchema, sanitizePrompt } from "@/lib/validate";
import type { Project } from "@/lib/types";

export async function GET() {
  const projects = await listProjects();
  const slim = projects.map((p) => ({
    id: p.id,
    name: p.name,
    prompt: p.prompt.slice(0, 140),
    providerId: p.providerId,
    scenes: p.scenes?.length ?? 0,
    characters: p.characters?.length ?? 0,
    jobs: (p.jobs ?? []).map((j) => ({ id: j.id, sceneId: j.sceneId, status: j.status, isMock: j.isMock })),
    hasOutput: Boolean(p.output?.path),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt
  }));
  return NextResponse.json({ projects: slim });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project data.", details: parsed.error.flatten() }, { status: 400 });
  }
  const v = parsed.data;
  const now = new Date().toISOString();
  const p: Project = {
    id: newId("proj_"),
    name: v.name?.trim() || "Untitled video",
    prompt: sanitizePrompt(v.prompt),
    negativePrompt: v.negativePrompt?.trim(),
    settings: v.settings,
    providerId: v.providerId,
    characters: [],
    scenes: [],
    sceneOrder: [],
    jobs: [],
    narrationVolume: 1,
    musicVolume: 0.4,
    burnCaptions: false,
    output: { status: "idle", updatedAt: now },
    createdAt: now,
    updatedAt: now
  };
  await saveProject(p);
  return NextResponse.json({ project: p }, { status: 201 });
}
