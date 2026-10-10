export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { dataDir } from "@/lib/store";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".srt": "text/plain",
  ".vtt": "text/vtt",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

/** Serve project-local media. Single-user prototype: files are only reachable via unguessable job/project ids. */
export async function GET(_req: Request, { params }: { params: { path: string[] } }) {
  const rel = (params.path ?? []).join("/");
  if (!rel || rel.includes("..") || path.isAbsolute(rel)) {
    return NextResponse.json({ error: "Invalid media path." }, { status: 400 });
  }
  const abs = path.join(dataDir(), rel);
  if (!abs.startsWith(dataDir())) return NextResponse.json({ error: "Invalid media path." }, { status: 400 });
  try {
    const buf = await fs.readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Content-Length": String(buf.length),
        "Cache-Control": "private, max-age=3600"
      }
    });
  } catch {
    return NextResponse.json({ error: "Media not found." }, { status: 404 });
  }
}
