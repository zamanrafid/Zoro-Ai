import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import type { AspectRatio, Project } from "./types";
import { dataDir } from "./store";
import { checkFfmpeg } from "./providers";

export interface AssembleOptions {
  burnCaptions: boolean;
  narrationVolume: number;
  musicVolume: number;
}

export function srtTimestamp(totalSec: number): string {
  const ms = Math.round(totalSec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${String(r).padStart(3, "0")}`;
}

export function buildSrt(project: Project, orderedSceneIds: string[]): string {
  let t = 0;
  const blocks: string[] = [];
  orderedSceneIds.forEach((sid, i) => {
    const sc = project.scenes.find((s) => s.id === sid);
    if (!sc) return;
    const start = t;
    const end = t + sc.durationSec;
    const text = (sc.caption || sc.narrationSegment || `Scene ${i + 1}`).trim();
    blocks.push(`${i + 1}\n${srtTimestamp(start)} --> ${srtTimestamp(end)}\n${text}\n`);
    t = end;
  });
  return blocks.join("\n");
}

function dimsFor(aspect: AspectRatio): { w: number; h: number } {
  if (aspect === "9:16") return { w: 720, h: 1280 };
  if (aspect === "1:1") return { w: 720, h: 720 };
  return { w: 1280, h: 720 };
}

/** Concatenate scene clips into one MP4, normalized to the project aspect. Throws with clear errors. */
export async function assembleProject(
  project: Project,
  orderedSceneIds: string[],
  opts: AssembleOptions,
  onLog?: (line: string) => void
): Promise<{ outputPath: string; srtPath: string }> {
  const ff = await checkFfmpeg();
  if (!ff.ok) {
    throw new Error(
      "FFmpeg was not found on this machine, so the final video cannot be rendered. " +
        "Install it with: winget install Gyan.FFmpeg  (then restart the terminal) " +
        "or download from https://ffmpeg.org/download.html and add it to PATH."
    );
  }
  // Prefer finished video clips; fall back to free AI stills (rendered with
  // motion on the fly) so a 100% free export always works. Failed jobs are
  // never used as filler, and gaps are reported — never silently skipped.
  const clips: string[] = [];
  const missing: string[] = [];
  orderedSceneIds.forEach((sid, i) => {
    const scene = project.scenes.find((s) => s.id === sid);
    const jobs = (project.jobs ?? []).filter((j) => j.sceneId === sid && j.status === "succeeded" && j.clipPath);
    jobs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    // Honor the user's picked take; fall back to the latest successful clip.
    const picked = scene?.selectedJobId ? jobs.find((j) => j.id === scene.selectedJobId) : undefined;
    const latest = picked ?? jobs[0];
    if (latest?.clipPath) {
      clips.push(path.join(dataDir(), latest.clipPath));
      return;
    }
    if (scene?.stillPath) {
      clips.push(`STILL:${scene.stillPath}:${scene.durationSec}:${i}`);
      return;
    }
    missing.push(scene ? `Scene ${i + 1}` : sid);
  });

  if (clips.length === 0) {
    throw new Error(
      "Nothing to assemble yet. Generate a free still or clip for at least one scene first — failed jobs are never used as filler."
    );
  }
  if (missing.length) {
    onLog?.(`Skipping ${missing.length} scene(s) with no clip or still yet (${missing.join(", ")}). Generate them to include them.`);
  }
  // Materialize still fallbacks into real clips now.
  for (let i = 0; i < clips.length; i++) {
    if (!clips[i].startsWith("STILL:")) continue;
    const [, stillRel, durStr, idxStr] = clips[i].split(":");
    const stillAbs = path.join(dataDir(), stillRel);
    try {
      await fs.stat(stillAbs);
    } catch {
      throw new Error("A scene still image is missing. Regenerate that scene's free still before exporting.");
    }
    const tmpRel = `media/exports/tmp_${project.id}_${idxStr}_${Date.now()}.mp4`.replace(/\\/g, "/");
    onLog?.(`Animating still for scene ${Number(idxStr) + 1}…`);
    await renderStillClip(stillAbs, tmpRel, Number(durStr) || 5, project.settings.aspectRatio, Number(idxStr));
    clips[i] = path.join(dataDir(), tmpRel);
  }
  for (const c of clips) {
    try {
      const st = await fs.stat(c);
      if (st.size < 1024) throw new Error("empty");
    } catch {
      throw new Error(`A scene clip is missing or empty (${path.basename(c)}). Regenerate that scene before exporting.`);
    }
  }

  const { w, h } = dimsFor(project.settings.aspectRatio);
  const outRel = `media/exports/${project.id}_${Date.now()}.mp4`.replace(/\\/g, "/");
  const outAbs = path.join(dataDir(), outRel);
  await fs.mkdir(path.dirname(outAbs), { recursive: true });

  // Write SRT sidecar always (free, no filter needed).
  const srtRel = outRel.replace(/\.mp4$/, ".srt");
  await fs.writeFile(path.join(dataDir(), srtRel), buildSrt(project, orderedSceneIds), "utf-8");

  // Build ffmpeg args: normalize each input (scale+pad, 30fps, yuv420p, aac) then concat.
  const args: string[] = ["-y"];
  for (const c of clips) args.push("-i", c);
  const narAbs = project.narrationAudioPath ? path.join(dataDir(), project.narrationAudioPath) : null;
  let narExists = false;
  if (narAbs) {
    try {
      const st = await fs.stat(narAbs);
      narExists = st.size > 1024;
    } catch {
      narExists = false;
    }
  }
  if (narExists) args.push("-i", narAbs!);

  const n = clips.length;
  const filterParts: string[] = [];
  for (let i = 0; i < n; i++) {
    filterParts.push(
      `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30,format=yuv420p[v${i}]`
    );
  }
  const vcat = Array.from({ length: n }, (_, i) => `[v${i}]`).join("") + `concat=n=${n}:v=1:a=0[vcat]`;
  filterParts.push(vcat);

  let mapArgs: string[];
  if (narExists) {
    const ai = n; // narration input index
    filterParts.push(`[${ai}:a]volume=${opts.narrationVolume ?? 1.0},aformat=sample_fmts=fltp:channel_layouts=stereo[na]`);
    filterParts.push(`[vcat]null[vout]`);
    mapArgs = ["-map", "[vout]", "-map", "[na]", "-c:a", "aac", "-shortest"];
  } else {
    filterParts.push(`[vcat]null[vout]`);
    mapArgs = ["-map", "[vout]"];
  }

  // Optional caption burn-in (requires libass). Attempt, fall back gracefully.
  let vf = filterParts.join(";");
  if (opts.burnCaptions) {
    vf += `;[vout]subtitles=filename='${path.join(dataDir(), srtRel).replace(/\\/g, "/").replace(/'/g, "")}'[vburn]`;
  }

  const finalMap = opts.burnCaptions
    ? mapArgs.map((a) => (a === "[vout]" ? "[vburn]" : a))
    : mapArgs;

  const fullArgs = [...args, "-filter_complex", vf, ...finalMap, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", outAbs];

  onLog?.(`Assembling ${n} clip(s) to ${project.settings.aspectRatio}…`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", fullArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr?.on("data", (d) => (err += String(d).slice(0, 4000)));
    child.on("error", (e) => reject(new Error(`Could not launch FFmpeg: ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else if (opts.burnCaptions && /subtitles|libass|filter/i.test(err)) {
        reject(
          new Error(
            "Caption burn-in failed (this FFmpeg build may lack libass). Retry with 'Burn captions' turned OFF — the .srt sidecar file is still exported."
          )
        );
      } else {
        reject(new Error(`FFmpeg assembly failed (exit ${code}). ${err.slice(-500)}`));
      }
    });
  });

  const st = await fs.stat(outAbs).catch(() => null);
  if (!st || st.size < 1024) throw new Error("FFmpeg finished but the output file is empty. Check that the scene clips are valid MP4 files.");
  onLog?.("Assembly complete.");
  return { outputPath: outRel, srtPath: srtRel };
}

/* ---------------- Free Movie Mode: AI stills + cinematic motion (no paid video model) ---------------- */

/**
 * Turn one AI-generated still image into a short cinematic clip
 * (slow zoom + drift, "Ken Burns" style) using only local FFmpeg.
 * Honest labeling: AI still + motion effect — NOT AI video diffusion.
 */
export async function renderStillClip(
  stillAbsPath: string,
  outRelPath: string,
  durationSec: number,
  aspect: AspectRatio,
  variant: number
): Promise<string> {
  const ff = await checkFfmpeg();
  if (!ff.ok) {
    throw new Error(
      "FFmpeg was not found, so the free clip could not be rendered. " +
        "Install it with: winget install Gyan.FFmpeg (then restart the terminal)."
    );
  }
  const { w, h } = dimsFor(aspect);
  const dur = Math.max(2, Math.min(10, Math.round(durationSec)));
  const frames = dur * 30;
  const W = w * 2;
  const H = h * 2;
  // Alternate motion per scene so consecutive scenes feel different.
  const moves = [
    `zoompan=z='min(zoom+0.0012,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
    `zoompan=z='max(1.25-0.0012*on,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
    `zoompan=z='1.15':x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)'`,
    `zoompan=z='1.15':x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)'`
  ];
  const move = moves[Math.abs(variant) % moves.length];
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},${move}:d=${frames}:s=${w}x${h}:fps=30,format=yuv420p`;
  const outAbs = path.join(dataDir(), outRelPath);
  await fs.mkdir(path.dirname(outAbs), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y", "-loop", "1", "-i", stillAbsPath,
      "-vf", vf,
      "-frames:v", String(frames),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      outAbs
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr?.on("data", (d) => (err += String(d).slice(0, 2000)));
    child.on("error", (e) => reject(new Error(`Could not launch FFmpeg: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Motion render failed (exit ${code}). ${err.slice(-300)}`))));
  });
  return outRelPath;
}

/** Concatenate MP3 parts (free TTS chunks) into one MP3. */
export async function concatMp3Parts(partAbsPaths: string[], outAbsPath: string): Promise<void> {
  const ff = await checkFfmpeg();
  if (!ff.ok) throw new Error("FFmpeg is required to join voice parts. Install with: winget install Gyan.FFmpeg");
  const listFile = `${outAbsPath}.txt`;
  await fs.writeFile(listFile, partAbsPaths.map((p) => `file '${p.replace(/'/g, "")}'`).join("\n"), "utf-8");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outAbsPath],
      { stdio: ["ignore", "pipe", "pipe"] });
    child.on("error", (e) => reject(new Error(`Could not launch FFmpeg: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Voice join failed (exit ${code}).`))));
  });
  await fs.unlink(listFile).catch(() => undefined);
}

/** Concatenate WAV parts (offline eSpeak chunks) into one WAV, re-encoded for safety. */
export async function concatWavParts(partAbsPaths: string[], outAbsPath: string): Promise<void> {
  const ff = await checkFfmpeg();
  if (!ff.ok) throw new Error("FFmpeg is required to join voice parts. Install with: winget install Gyan.FFmpeg");
  const listFile = `${outAbsPath}.txt`;
  await fs.writeFile(listFile, partAbsPaths.map((p) => `file '${p.replace(/'/g, "")}'`).join("\n"), "utf-8");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "pcm_s16le", "-ar", "22050", "-ac", "1", outAbsPath],
      { stdio: ["ignore", "pipe", "pipe"] });
    child.on("error", (e) => reject(new Error(`Could not launch FFmpeg: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Voice join failed (exit ${code}).`))));
  });
  await fs.unlink(listFile).catch(() => undefined);
}
