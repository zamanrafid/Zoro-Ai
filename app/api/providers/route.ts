export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { listProviders, checkFfmpeg } from "@/lib/providers";

export async function GET() {
  const providers = listProviders();
  const ffmpeg = await checkFfmpeg();
  const llmPlanner = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL && process.env.OPENAI_PLANNER_MODEL);
  return NextResponse.json({
    providers,
    ffmpeg: ffmpeg.ok
      ? { ok: true, version: ffmpeg.version }
      : {
          ok: false,
          help: "FFmpeg not found. Install with: winget install Gyan.FFmpeg — then restart the terminal.Rendering and MP4 export require FFmpeg."
        },
    llmPlanner: llmPlanner
      ? { active: true, note: "LLM storyboard planner is configured." }
      : { active: false, note: "Using the built-in offline storyboard planner (free, no key needed)." },
    honesty: "ZORO AI never simulates progress. Jobs report real statuses; failures are shown as failures."
  });
}
