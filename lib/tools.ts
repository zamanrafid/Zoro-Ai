import { existsSync, readdirSync } from "fs";
import path from "path";

/**
 * Find local free tools WITHOUT trusting PATH.
 * (Old terminals often miss newly installed programs — this searches the
 * well-known install folders directly, so rendering works regardless.)
 */

function baseVars(): string[] {
  const out: string[] = [];
  for (const k of ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"]) {
    const v = process.env[k];
    if (v) out.push(v);
  }
  out.push("C:\\");
  return out;
}

/** Expand one pattern where a single path segment may contain a "*" wildcard. */
export function expandPattern(pattern: string): string[] {
  const parts = pattern.split(/[\\/]/);
  let acc = [""];
  for (const part of parts) {
    if (!part) continue;
    if (!part.includes("*")) {
      acc = acc.map((a) => (a ? `${a}\\${part}` : part));
      continue;
    }
    const rx = new RegExp("^" + part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i");
    const next: string[] = [];
    for (const a of acc) {
      const dir = a || "\\";
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const e of entries) {
        if (rx.test(e)) next.push(a ? `${a}\\${e}` : e);
      }
    }
    acc = next;
  }
  return acc;
}

function withBase(pattern: string): string {
  // Patterns starting with %VAR% are expanded against real env values.
  const m = pattern.match(/^%([^%]+)%[\\/]?(.*)$/);
  if (m) {
    const v = process.env[m[1]];
    if (!v) return "";
    return path.join(v, m[2]);
  }
  return pattern;
}

const FFMPEG_PATTERNS = [
  "%LOCALAPPDATA%\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_*\\ffmpeg-*\\bin\\ffmpeg.exe",
  "%LOCALAPPDATA%\\Microsoft\\WinGet\\Links\\ffmpeg.exe",
  "%ProgramFiles%\\ffmpeg\\bin\\ffmpeg.exe",
  "C:\\ffmpeg\\bin\\ffmpeg.exe"
];
const FFPROBE_PATTERNS = FFMPEG_PATTERNS.map((p) => p.replace(/ffmpeg\.exe$/i, "ffprobe.exe"));
const ESPEAK_PATTERNS = [
  "%ProgramFiles%\\eSpeak NG\\espeak-ng.exe",
  "%ProgramFiles%\\eSpeak NG\\espeak.exe",
  "%LOCALAPPDATA%\\Microsoft\\WinGet\\Packages\\*espeak*\\*\\espeak-ng.exe"
];
const YTDLP_PATTERNS = [
  "%LOCALAPPDATA%\\Microsoft\\WinGet\\Packages\\yt-dlp*\\*\\yt-dlp.exe",
  "%LOCALAPPDATA%\\Microsoft\\WinGet\\Links\\yt-dlp.exe",
  "%ProgramFiles%\\yt-dlp\\yt-dlp.exe"
];

/** Full path if installed anywhere known, else the plain command (PATH fallback). */
export function resolveBin(cmd: string, patterns: string[]): string {
  for (const pat of patterns) {
    const full = withBase(pat);
    if (!full) continue;
    if (full.includes("*")) {
      for (const hit of expandPattern(full)) {
        if (existsSync(hit)) return hit;
      }
    } else if (existsSync(full)) {
      return full;
    }
  }
  return cmd;
}

export function ffmpegBin(): string {
  return resolveBin("ffmpeg", FFMPEG_PATTERNS);
}
export function ffprobeBin(): string {
  return resolveBin("ffprobe", FFPROBE_PATTERNS);
}
export function espeakBin(): string | null {
  const found = resolveBin("", ESPEAK_PATTERNS);
  return found === "" ? null : found;
}
export function ytdlpBin(): string {
  return resolveBin("yt-dlp", YTDLP_PATTERNS);
}

/** True when the binary exists on disk (even if this terminal's PATH hides it). */
export function ffmpegInstalled(): boolean {
  return ffmpegBin() !== "ffmpeg";
}

/** Context-aware message: installed-but-invisible vs truly absent vs demo host. */
export function renderUnavailableMessage(): string {
  if (process.env.VERCEL === "1") {
    return "Video rendering is impossible on this hosted demo link (servers here cannot run FFmpeg). Run start-zoro.bat on your PC — everything renders there.";
  }
  if (ffmpegInstalled()) {
    return "FFmpeg IS installed on this PC, but this terminal cannot see it. Close ALL terminal windows (or restart the PC), then double-click start-zoro.bat.";
  }
  return "FFmpeg was not found, so the free clip could not be rendered. Install it with: winget install Gyan.FFmpeg (then restart the terminal).";
}
