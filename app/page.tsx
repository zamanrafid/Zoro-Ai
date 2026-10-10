"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ZoroLogo } from "@/components/ui";
import { fetchJson, apiError } from "@/lib/client";
import { MAX_PROMPT } from "@/lib/validate";
import type { GenerationJob, Project, ProviderInfo } from "@/lib/types";

interface Vid { id: string; name: string; updatedAt: string; hasOutput: boolean }

type Phase = "idle" | "working" | "done";
type StepState = "todo" | "doing" | "done" | "failed";

const QUICK_DURATIONS = [10, 20, 30, 60];
const STYLES = ["cinematic-documentary", "realistic", "historical", "dark-mystery", "fantasy", "animation"];

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [duration, setDuration] = useState(20);
  const [style, setStyle] = useState("cinematic-documentary");
  const [providerId, setProviderId] = useState("slideshow");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [videos, setVideos] = useState<Vid[]>([]);
  const [sysOk, setSysOk] = useState<boolean | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [steps, setSteps] = useState({ story: "todo" as StepState, images: "todo" as StepState, clips: "todo" as StepState, voice: "todo" as StepState, movie: "todo" as StepState });
  const [counts, setCounts] = useState({ images: [0, 0], clips: [0, 0] });
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ mp4?: string; srt?: string }>({});

  const pushLog = (m: string) => setLog((p) => [...p.slice(-7), m]);
  const setStep = (k: keyof typeof steps, v: StepState) =>
    setSteps((p) => ({ ...p, [k]: v }));

  const refreshList = useCallback(async () => {
    try {
      const [pj, pv, h] = await Promise.all([
        fetch("/api/projects").then((r) => r.json()),
        fetch("/api/providers").then((r) => r.json()),
        fetch("/api/health").then((r) => r.json()).catch(() => null)
      ]);
      setVideos((pj.projects ?? []).map((p: { id: string; name: string; updatedAt: string; hasOutput: boolean }) => ({
        id: p.id, name: p.name, updatedAt: p.updatedAt, hasOutput: p.hasOutput
      })));
      setProviders(pv.providers ?? []);
      if (h) setSysOk(h.ok === true);
    } catch { /* sidebar stays empty rather than breaking the page */ }
  }, []);

  useEffect(() => { refreshList(); }, [refreshList]);

  async function pollJobToEnd(jobId: string, timeoutMs: number): Promise<GenerationJob> {
    const start = Date.now();
    for (;;) {
      const r = await fetch(`/api/jobs/${jobId}`);
      const d = await r.json();
      if (!r.ok) throw new Error((d.error as string) ?? "Job check failed.");
      const job = d.job as GenerationJob;
      if (job.status === "succeeded") return job;
      if (job.status === "failed" || job.status === "cancelled") throw new Error(job.error ?? `Job ${job.status}.`);
      if (Date.now() - start > timeoutMs) throw new Error("Taking too long — press Make Video again to resume from here.");
      await new Promise((res) => setTimeout(res, 4000));
    }
  }

  async function make() {
    const text = prompt.trim();
    if (text.length < 10) { setError("Describe your video in at least 10 characters."); return; }
    if (text.length > MAX_PROMPT) { setError(`Too long (${text.length} / ${MAX_PROMPT}). Shorten it a little.`); return; }
    setError("");
    setResult({});
    setLog([]);
    setSteps({ story: "todo", images: "todo", clips: "todo", voice: "todo", movie: "todo" });
    setPhase("working");
    try {
      // Create
      pushLog("Creating your video…");
      const c = await fetchJson("/api/projects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: text.slice(0, 60) || "Untitled video",
          prompt: text, providerId,
          settings: { durationSec: duration, aspectRatio: aspect, style, motionIntensity: "medium" }
        })
      }, 30000);
      if (!c.ok || !c.data.project) throw new Error(apiError(c.status, c.data, "Could not start."));
      const proj = c.data.project as Project;
      setProjectId(proj.id);
      setProjectName(proj.name);

      const getP = async (): Promise<Project> => {
        const r = await fetch(`/api/projects/${proj.id}`);
        const d = await r.json();
        if (!r.ok) throw new Error((d.error as string) ?? "Reload failed.");
        return d.project as Project;
      };

      // Story
      setStep("story", "doing");
      pushLog("Writing the story and scenes…");
      const pl = await fetchJson(`/api/projects/${proj.id}/plan`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text })
      }, 120000);
      if (!pl.ok) throw new Error(apiError(pl.status, pl.data, "Story failed."));
      let p = await getP();
      setStep("story", "done");
      pushLog(`${p.scenes.length} scenes ready.`);

      // Images
      setStep("images", "doing");
      let done = p.scenes.filter((s) => s.stillPath).length;
      setCounts((k) => ({ ...k, images: [done, p.scenes.length] }));
      for (const sid of p.sceneOrder) {
        const sc = p.scenes.find((s) => s.id === sid)!;
        if (sc.stillPath) continue;
        pushLog(`Painting scene ${sc.index + 1} of ${p.scenes.length}…`);
        const g = await fetchJson(`/api/projects/${proj.id}/generate`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneId: sid, kind: "still" })
        }, 60000);
        if (!g.ok || !g.data.job) throw new Error(apiError(g.status, g.data, "Image request failed."));
        await pollJobToEnd((g.data.job as GenerationJob).id, 480000);
        p = await getP();
        done = p.scenes.filter((s) => s.stillPath).length;
        setCounts((k) => ({ ...k, images: [done, p.scenes.length] }));
      }
      setStep("images", "done");

      // Clips
      setStep("clips", "doing");
      const clipDone = () => (p.jobs ?? []).filter((j) => j.status === "succeeded" && j.clipPath).length;
      setCounts((k) => ({ ...k, clips: [clipDone(), p.scenes.length] }));
      for (const sid of p.sceneOrder) {
        const sc = p.scenes.find((s) => s.id === sid)!;
        const has = (p.jobs ?? []).some((j) => j.sceneId === sid && j.status === "succeeded" && j.clipPath);
        if (has) continue;
        pushLog(`Animating scene ${sc.index + 1} of ${p.scenes.length}…`);
        const g = await fetchJson(`/api/projects/${proj.id}/generate`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneId: sid, kind: "video" })
        }, 60000);
        if (!g.ok || !g.data.job) throw new Error(apiError(g.status, g.data, "Clip request failed."));
        await pollJobToEnd((g.data.job as GenerationJob).id, 600000);
        p = await getP();
        setCounts((k) => ({ ...k, clips: [clipDone(), p.scenes.length] }));
      }
      setStep("clips", "done");

      // Voice
      setStep("voice", "doing");
      pushLog("Recording the voiceover…");
      const t = await fetchJson(`/api/projects/${proj.id}/narration`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tts: true, voice: "nova" })
      }, 600000);
      if (!t.ok) throw new Error(apiError(t.status, t.data, "Voiceover failed."));
      p = await getP();
      setStep("voice", "done");

      // Movie
      setStep("movie", "doing");
      pushLog("Assembling your final MP4…");
      const a = await fetchJson(`/api/projects/${proj.id}/assemble`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      }, 600000);
      if (!a.ok || !(a.data.project as Project).output?.path) throw new Error(apiError(a.status, a.data, "Assembly failed."));
      const out = (a.data.project as Project).output;
      setStep("movie", "done");
      setResult({ mp4: out.path ? `/api/media/${out.path}` : undefined, srt: out.srtPath ? `/api/media/${out.srtPath}` : undefined });
      pushLog("Done! Watch below.");
      setPhase("done");
      refreshList();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed.";
      setError(msg);
      pushLog("Stopped: " + msg);
      setSteps((p) => {
        const n = { ...p };
        (Object.keys(n) as Array<keyof typeof n>).forEach((k) => { if (n[k] === "doing") n[k] = "failed"; });
        return n;
      });
      setPhase("done");
    }
  }

  function reset() {
    setPhase("idle");
    setError("");
    setResult({});
    setLog([]);
    setProjectId("");
    setSteps({ story: "todo", images: "todo", clips: "todo", voice: "todo", movie: "todo" });
  }

  const stepRow = (label: string, s: StepState, extra = "") => (
    <div className="flex items-center gap-2 text-sm">
      <span className={s === "done" ? "text-emerald-300" : s === "doing" ? "text-blue-300" : s === "failed" ? "text-red-300" : "text-slate-600"}>
        {s === "done" ? "●" : s === "doing" ? "◐" : s === "failed" ? "●" : "○"}
      </span>
      <span className={s === "todo" ? "text-slate-500" : "text-slate-200"}>{label}</span>
      {extra && <span className="text-xs text-muted">{extra}</span>}
    </div>
  );

  return (
    <div className="flex min-h-screen bg-ink text-paper">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800/60 p-4 md:flex">
        <ZoroLogo size={34} />
        <button onClick={reset} className="btn-ghost mt-5 w-full text-sm">+ New video</button>
        <p className="label mt-6">My videos</p>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {videos.length === 0 && <p className="text-xs text-muted">Nothing yet — your movies will appear here.</p>}
          {videos.map((v) => (
            <Link key={v.id} href={`/projects/${v.id}`} className="block truncate rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800/60">
              {v.hasOutput ? "🎬 " : "🎞 "}{v.name}
            </Link>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-slate-800/60 pt-3 text-xs text-muted">
          <span className={sysOk === false ? "text-red-300" : sysOk ? "text-emerald-300" : "text-slate-500"}>●</span>
          {sysOk === false ? "Missing tools — run locally" : sysOk ? "Ready" : "Checking…"}
        </div>
      </aside>

      {/* Main */}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6">
        <div className="flex items-center justify-between md:hidden">
          <ZoroLogo size={30} />
          <button onClick={reset} className="btn-ghost text-xs">+ New</button>
        </div>

        {phase === "idle" && (
          <>
            <h1 className="mt-10 text-center text-2xl font-bold sm:text-3xl">
              What story should we <span className="grad-text">film today?</span>
            </h1>
            <p className="mt-2 text-center text-sm text-muted">Describe it. Get a finished video file. Free.</p>
            <div className="card mt-6">
              <textarea
                className="min-h-[110px] w-full resize-y bg-transparent text-base outline-none placeholder:text-slate-500"
                placeholder="A detective in old Dhaka uncovers a 200-year-old mystery…"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <p className={`text-right text-[11px] ${prompt.length > MAX_PROMPT ? "text-red-300" : "text-muted"}`}>
                {prompt.length} / {MAX_PROMPT}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-700/50 pt-3 text-xs">
                <select className="input w-auto" value={providerId} onChange={(e) => setProviderId(e.target.value)} aria-label="Engine">
                  {providers.length === 0 && <option value="slideshow">★ Free Movie</option>}
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.id === "slideshow" ? "★ " : ""}{p.label.split(" (")[0]}</option>
                  ))}
                </select>
                <select className="input w-auto" value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)} aria-label="Shape">
                  <option value="9:16">9:16 Short</option>
                  <option value="16:9">16:9 Wide</option>
                  <option value="1:1">1:1 Square</option>
                </select>
                <select className="input w-auto" value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Length">
                  {QUICK_DURATIONS.map((d) => <option key={d} value={d}>{d}s</option>)}
                </select>
                <select className="input w-auto" value={style} onChange={(e) => setStyle(e.target.value)} aria-label="Style">
                  {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={make} className="btn-primary ml-auto rounded-full px-6" aria-label="Make video">↑ Make video</button>
              </div>
            </div>
            {error && <div className="card mt-4 border-red-500/40"><p className="break-words text-sm text-red-300">{error}</p></div>}
            <div className="mt-6 md:hidden">
              <p className="label">My videos</p>
              {videos.map((v) => (
                <Link key={v.id} href={`/projects/${v.id}`} className="block truncate rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800/60">
                  {v.hasOutput ? "🎬 " : "🎞 "}{v.name}
                </Link>
              ))}
            </div>
          </>
        )}

        {phase !== "idle" && (
          <>
            <h1 className="mt-6 truncate text-xl font-bold">{projectName || "Making your video…"}</h1>
            <div className="card mt-4 space-y-2">
              {stepRow("Story & scenes", steps.story)}
              {stepRow(`Pictures`, steps.images, counts.images[1] ? `${counts.images[0]}/${counts.images[1]}` : "")}
              {stepRow(`Motion clips`, steps.clips, counts.clips[1] ? `${counts.clips[0]}/${counts.clips[1]}` : "")}
              {stepRow("Voiceover", steps.voice)}
              {stepRow("Final MP4", steps.movie)}
            </div>
            {log.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-2xl border border-slate-700/50 p-3 text-xs text-slate-300">
                {log.map((l, i) => <li key={i}>• {l}</li>)}
              </ul>
            )}
            {error && <div className="card mt-4 border-red-500/40"><p className="break-words text-sm text-red-300">{error}</p></div>}
            {result.mp4 && (
              <div className="card mt-4 border-emerald-500/30">
                <video controls src={result.mp4} className="w-full rounded-xl" />
                <div className="mt-3 flex flex-wrap gap-2">
                  <a className="btn-primary text-sm" href={result.mp4} download={`${projectName || "zoro-video"}.mp4`}>Download MP4</a>
                  {result.srt && <a className="btn-ghost text-sm" href={result.srt} download>Captions (SRT)</a>}
                  {projectId && <Link className="btn-ghost text-sm" href={`/projects/${projectId}`}>Fine-tune in Studio</Link>}
                  <button className="btn-ghost text-sm" onClick={reset}>Make another</button>
                </div>
              </div>
            )}
            {!result.mp4 && phase === "done" && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn-primary text-sm" onClick={() => { setPhase("idle"); }}>Try again</button>
                {projectId && <Link className="btn-ghost text-sm" href={`/projects/${projectId}`}>Open in Studio</Link>}
                <button className="btn-ghost text-sm" onClick={reset}>New video</button>
              </div>
            )}
          </>
        )}

        <footer className="mt-auto pt-10 text-center text-[11px] text-muted">
          ZORO AI · Free Movie engine · No watermark ·{" "}
          <Link href={projectId ? `/projects/${projectId}` : "/"} className="underline">Advanced Studio</Link>
        </footer>
      </main>
    </div>
  );
}
