export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { jobsDir } from "@/lib/store";
import { pollOneJob } from "@/lib/jobs";

export async function GET(_req: Request, { params }: { params: { jobId: string } }) {
  let link: { projectId: string; jobId: string } | null = null;
  try {
    const raw = await fs.readFile(path.join(jobsDir(), `${params.jobId}.json`), "utf-8");
    link = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  const res = await pollOneJob(link!.projectId, link!.jobId);
  if (!res) return NextResponse.json({ error: "Job or project no longer exists." }, { status: 404 });
  return NextResponse.json({ job: res.job });
}
