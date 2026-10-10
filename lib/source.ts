import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { dataDir } from "./store";
import { ffmpegBin, ffprobeBin, ytdlpBin } from "./tools";

export const MAX_SOURCE_BYTES = 500 * 1024 * 1024;
export const MAX_SOURCE_SEC = 1800; // 30 min cap like generated videos

const YT_PATTERNS = [
  /^(https?:\/\/)?(www\.|m\.)?youtube\.com\/watch\?[^#\s]*v=[\w-]{6,}.*$/,
  /^(https?:\/\/)?(www\.|m\.)?youtube\.com\/shorts\/[\w-]{6,}.*$/,
  /^(https?:\/\/)?(www\.|m\.)?youtube\.com\/live\/[\w-]{6,}.*$/,
  /^(https?:\/\/)?youtu\.be\/[\w-]{6,}.*$/
];

/** Strict allow-list: only real YouTube watch/shorts/live links. Never fetch arbitrary URLs. */
export function isYouTubeUrl(u: string): boolean {
  const s = u.trim();
  if (s.length > 500) return false;
  return YT_PATTERNS.some((re) => re.test(s));
}

export async function checkYtdlp(): Promise<{ ok: boolean; version?: string }> {
  return new Promise((resolve) => {
    const child = spawn(ytdlpBin(), ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout?.on("data", (d) => (out += String(d)));
    child.on("error", () => resolve({ ok: false }));
    child.on("close", (code) => (code === 0 ? resolve({ ok: true, version: out.trim().slice(0, 40) }) : resolve({ ok: false })));
    setTimeout(() => resolve({ ok: false }), 10000);
  });
}

export interface Probe {
  durationSec: number;
  width: number;
  height: number;
  sizeBytes: number;
}

export async function probeVideo(absPath: string): Promise<Probe> {
  const st = await fs.stat(absPath).catch(() => null);
  if (!st || st.size < 1024) throw new Error("Video file is missing or empty.");
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      ffprobeBin(),
      ["-v", "error", "-show_entries", "format=duration,size", "-show_entries", "stream=width,height", "-of", "default=noprint_wrappers=1", absPath],
      { stdio: ["ignore", "pipe", "ignore"] }
    );
    let o = "";
    child.stdout?.on("data", (d) => (o += String(d)));
    child.on("error", (e) => reject(new Error(`Could not launch ffprobe: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve(o) : reject(new Error("Could not read this video file."))));
  });
  const num = (k: string): number => {
    const m = out.match(new RegExp(`${k}=(\\S+)`));
    const v = m ? Number(m[1]) : NaN;
    return Number.isFinite(v) ? v : 0;
  };
  return { durationSec: num("duration"), width: num("width"), height: num("height"), sizeBytes: st.size };
}

/** Download a YouTube video (720p max to stay light). Throws honest errors. */
export async function downloadYouTube(url: string, outAbsPath: string, timeoutMs = 600000): Promise<void> {
  if (!isYouTubeUrl(url)) {
    throw new Error("Only youtube.com/watch, /shorts, /live or youtu.be links are accepted.");
  }
  const yt = await checkYtdlp();
  if (!yt.ok) {
    throw new Error("yt-dlp was not found. Install it free with: winget install yt-dlp.yt-dlp (then restart the terminal).");
  }
  await fs.mkdir(path.dirname(outAbsPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      ytdlpBin(),
      [
        "--no-playlist",
        "--max-filesize", "500M",
        "--match-filter", "duration < 1800",
        "-f", "bv*[height<=720]+ba/b[height<=720]/b",
        "--merge-output-format", "mp4",
        "-o", outAbsPath,
        "--no-warnings",
        url.trim()
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let err = "";
    child.stderr?.on("data", (d) => (err += String(d).slice(-1500)));
    child.on("error", (e) => reject(new Error(`Could not launch yt-dlp: ${e.message}`)));
    const killer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      reject(new Error("YouTube download timed out (10 min). Try a shorter video."));
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(killer);
      if (code === 0) resolve();
      else if (/private|login|sign in|cookies/i.test(err)) {
        reject(new Error("This video needs login (private/age-gated). Only public videos you have rights to can be imported."));
      } else if (/duration/i.test(err)) {
        reject(new Error("Video is longer than 30 minutes — import a shorter one."));
      } else {
        reject(new Error(`YouTube download failed. ${err.slice(-220) || "Check the link and retry."}`));
      }
    });
  });
  const probe = await probeVideo(outAbsPath);
  if (probe.durationSec > MAX_SOURCE_SEC) {
    await fs.unlink(outAbsPath).catch(() => undefined);
    throw new Error("Video is longer than 30 minutes — import a shorter one.");
  }
}

/** Convert any clip to vertical 9:16 Shorts format (720x1280, center crop). */
export async function toVertical720x1280(srcAbs: string, outRel: string): Promise<string> {
  const outAbs = path.join(dataDir(), outRel);
  await fs.mkdir(path.dirname(outAbs), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpegBin(),
      ["-y", "-i", srcAbs, "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", outAbs],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    child.on("error", (e) => reject(new Error(`Could not launch FFmpeg: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Vertical conversion failed (exit ${code}).`))));
  });
  return outRel;
}

/** Cut one segment [startSec, startSec+lenSec) re-encoded for clean cuts. */
export async function cutSegment(srcAbs: string, startSec: number, lenSec: number, outRel: string): Promise<string> {
  const outAbs = path.join(dataDir(), outRel);
  await fs.mkdir(path.dirname(outAbs), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpegBin(),
      ["-y", "-ss", String(Math.max(0, startSec)), "-i", srcAbs, "-t", String(lenSec),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", "-movflags", "+faststart", outAbs],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    child.on("error", (e) => reject(new Error(`Could not launch FFmpeg: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Cut failed (exit ${code}).`))));
  });
  return outRel;
}

/** Plan N Shorts chunks across a duration (last chunk may be shorter). */
export function planShorts(totalSec: number, segSec: number): Array<{ start: number; len: number }> {
  const seg = Math.max(5, Math.min(60, Math.round(segSec)));
  const out: Array<{ start: number; len: number }> = [];
  let t = 0;
  const total = Math.min(totalSec, MAX_SOURCE_SEC);
  while (t < total) {
    out.push({ start: Math.round(t * 10) / 10, len: Math.round(Math.min(seg, total - t) * 10) / 10 });
    t += seg;
  }
  return out;
}
