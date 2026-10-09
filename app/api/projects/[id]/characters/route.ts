export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { dataDir, getProject, saveProject, saveUpload } from "@/lib/store";

/**
 * Characters sub-resource. POST body uses { action, ... }:
 * - create { name, role, fixedDescription, ... } → manual character
 * - generate { name, role, ... } → free Pollinations reference image (disclosed, may watermark)
 * - upload { characterId, filename, dataUrl } → save approved art
 * - approve { characterId, approved } / update { characterId, patch, applyToExistingScenes }
 * - delete { characterId }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const now = new Date().toISOString();

  if (action === "create") {
    const name = String(body.name ?? "").trim().slice(0, 80);
    const fixedDescription = String(body.fixedDescription ?? "").trim();
    if (!name) return NextResponse.json({ error: "Character name is required." }, { status: 400 });
    if (fixedDescription.length < 10) return NextResponse.json({ error: "fixedDescription must be at least 10 characters." }, { status: 400 });
    const c = {
      id: uuidv4(),
      name,
      age: String(body.age ?? ""),
      faceShape: "", facialFeatures: "", skinTone: "", eyeColor: "",
      hairstyle: "", hairColor: "", bodyType: "", height: "",
      clothing: String(body.clothing ?? ""),
      accessories: "", distinctiveFeatures: String(body.distinctiveFeatures ?? ""),
      personality: "", role: String(body.role ?? "Protagonist"),
      fixedDescription, approved: false,
      createdAt: now, updatedAt: now
    };
    p.characters.push(c);
    await saveProject(p);
    return NextResponse.json({ project: p, character: c }, { status: 201 });
  }

  if (action === "generate") {
    // Free reference image via Pollinations (GET https://image.pollinations.ai/prompt/...).
    // Anonymous tier is rate-limited and free-tier images may carry a watermark unless registered.
    const name = String(body.name ?? "Character").trim().slice(0, 80);
    const desc = String(body.fixedDescription ?? body.role ?? name).slice(0, 500);
    const style = p.settings.style;
    const seed = Math.floor(Math.random() * 100000);
    const dims = p.settings.aspectRatio === "16:9" ? "width=1024&height=576" : p.settings.aspectRatio === "1:1" ? "width=768&height=768" : "width=768&height=1344";
    const prompt = encodeURIComponent(`portrait reference sheet, single character, neutral background, ${desc}, ${style} style, consistent identity, no text, no watermark`);
    const url = `https://image.pollinations.ai/prompt/${prompt}?${dims}&seed=${seed}&model=flux&nologo=false`;
    let buf: Buffer;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Image service returned ${res.status}. Free tier may be rate-limited — wait ~15s and retry.`);
      buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 2048) throw new Error("Image service returned an empty response.");
    } catch (e) {
      return NextResponse.json({ error: `Reference image failed: ${e instanceof Error ? e.message : "network error"}` }, { status: 502 });
    }
    const rel = `media/${p.id}/characters/${Date.now()}_${seed}.jpg`.replace(/\\/g, "/");
    const abs = path.join(dataDir(), rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buf);
    const c = {
      id: uuidv4(), name,
      age: String(body.age ?? ""), faceShape: "", facialFeatures: "", skinTone: "", eyeColor: "",
      hairstyle: "", hairColor: "", bodyType: "", height: "",
      clothing: String(body.clothing ?? ""), accessories: "",
      distinctiveFeatures: String(body.distinctiveFeatures ?? ""),
      personality: "", role: String(body.role ?? "Protagonist"),
      fixedDescription: desc, referenceImagePath: rel, approved: false, seed,
      createdAt: now, updatedAt: now
    };
    p.characters.push(c);
    await saveProject(p);
    return NextResponse.json({
      project: p, character: c,
      notice: "Free image via Pollinations (anonymous tier: ~1 request / 15s). Free-tier images may include a watermark — register at auth.pollinations.ai to remove it."
    }, { status: 201 });
  }

  if (action === "upload") {
    const characterId = String(body.characterId ?? "");
    const c = p.characters.find((x) => x.id === characterId);
    if (!c) return NextResponse.json({ error: "Character not found." }, { status: 404 });
    try {
      const rel = await saveUpload(p.id, "characters", String(body.filename ?? "reference.png"), String(body.dataUrl ?? ""), /^image\/(png|jpe?g|webp)$/, 8 * 1024 * 1024);
      c.referenceImagePath = rel;
      c.referenceImageUrl = undefined;
      c.updatedAt = now;
      await saveProject(p);
      return NextResponse.json({ project: p });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed." }, { status: 400 });
    }
  }

  if (action === "approve") {
    const c = p.characters.find((x) => x.id === String(body.characterId ?? ""));
    if (!c) return NextResponse.json({ error: "Character not found." }, { status: 404 });
    if (body.approved === true && !c.referenceImagePath) {
      return NextResponse.json({ error: "Approve needs a reference image first — generate or upload one." }, { status: 400 });
    }
    c.approved = body.approved === true;
    c.updatedAt = now;
    await saveProject(p);
    return NextResponse.json({ project: p });
  }

  if (action === "update") {
    const c = p.characters.find((x) => x.id === String(body.characterId ?? ""));
    if (!c) return NextResponse.json({ error: "Character not found." }, { status: 404 });
    const patch = (body.patch ?? {}) as Record<string, unknown>;
    const editable = ["name", "age", "clothing", "distinctiveFeatures", "role", "fixedDescription"] as const;
    for (const k of editable) {
      if (typeof patch[k] === "string") (c as unknown as Record<string, unknown>)[k] = String(patch[k]).slice(0, 2000);
    }
    c.updatedAt = now;
    const apply = body.applyToExistingScenes === true;
    if (apply) {
      // Re-stamp the updated identity block into scenes featuring this character (explicit opt-in only).
      for (const s of p.scenes) {
        if (s.characterIds.includes(c.id) && !s.visualPrompt.includes(c.fixedDescription)) {
          s.visualPrompt = `${s.visualPrompt} Updated identity lock: ${c.fixedDescription}`;
        }
      }
    }
    await saveProject(p);
    return NextResponse.json({ project: p, appliedToScenes: apply });
  }

  if (action === "delete") {
    const c = p.characters.find((x) => x.id === String(body.characterId ?? ""));
    if (!c) return NextResponse.json({ error: "Character not found." }, { status: 404 });
    if (c.referenceImagePath) {
      try { await fs.unlink(path.join(dataDir(), c.referenceImagePath)); } catch { /* gone */ }
    }
    p.characters = p.characters.filter((x) => x.id !== c.id);
    for (const s of p.scenes) s.characterIds = s.characterIds.filter((id) => id !== c.id);
    await saveProject(p);
    return NextResponse.json({ project: p });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
