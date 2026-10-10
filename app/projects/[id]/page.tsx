"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ZoroLogo, StatusBadge } from "@/components/ui";
import { fetchJson, apiError } from "@/lib/client";
import { MAX_PROMPT } from "@/lib/validate";
import type { Project, GenerationJob } from "@/lib/types";

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}

export default function Studio({ params }: { params: { id: string } }) {
  const id = params.id;
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [script, setScript] = useState("");
  const [detail, setDetail] = useState<Record<string, GenerationJob>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickingRef = useRef(false);
  const hydratedRef = useRef(false);

  const load = useCallback(async (rehydrateInputs = false) => {
    try {
      const r = await fetch(`/api/projects/${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Project not found.");
      setProject(d.project);
      // Never clobber what the user is typing on background refreshes —
      // only hydrate inputs on first load or explicit Reload.
      if (rehydrateInputs || !hydratedRef.current) {
        hydratedRef.current = true;
        setPrompt(d.project.prompt);
        setNegative(d.project.negativePrompt ?? "");
        setScript(d.project.narrationScript ?? "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed.");
    }
  }, [id]);

  useEffect(() => { load(true); }, [load]);

  // Poll active jobs for REAL status (free-still/slideshow advance server-side; replicate polls the provider).
  useEffect(() => {
    const active = (project?.jobs ?? []).some((j) => j.status === "queued" || j.status === "processing");
    if (!active) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      // Skip ticks while the previous one is still in flight (slow renders can
      // take minutes) — prevents overlapping duplicate polls for the same job.
      if (tickingRef.current) return;
      tickingRef.current = true;
      try {
        const act = (project?.jobs ?? []).filter((j) => j.status === "queued" || j.status === "processing");
        const updates: Record<string, GenerationJob> = {};
        for (const j of act) {
          try {
            const r = await fetch(`/api/jobs/${j.id}`);
            const d = await r.json();
            if (r.ok) updates[j.id] = d.job;
          } catch { /* keep old state on network blip */ }
        }
        if (Object.keys(updates).length) {
          setDetail((prev) => ({ ...prev, ...updates }));
          // Refresh project when something finished (inputs are NOT clobbered).
          if (Object.values(updates).some((j) => ["succeeded", "failed", "cancelled"].includes(j.status))) load();
        }
      } finally {
        tickingRef.current = false;
      }
    }, 2500);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [project?.jobs, load]);

  const jobsFor = (sceneId: string): GenerationJob[] => {
    const fromDetail = Object.values(detail).filter((j) => j.sceneId === sceneId);
    const base = (project?.jobs ?? []).filter((j) => j.sceneId === sceneId);
    const merged = new Map<string, GenerationJob>();
    for (const j of base) merged.set(j.id, j);
    for (const j of fromDetail) merged.set(j.id, j);
    return [...merged.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  };

  async function plan() {
    setBusy("plan"); setError(""); setNotice("");
    if (prompt.length > MAX_PROMPT) {
      setError(`Prompt ${prompt.length} characters — limit ${MAX_PROMPT}. Shorten it and retry.`);
      setBusy("");
      return;
    }
    try {
      const { ok, status, data } = await fetchJson(
        `/api/projects/${id}/plan`,
        {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, negativePrompt: negative })
        },
        120000
      );
      if (!ok || !data.project) throw new Error(apiError(status, data, "Planning failed."));
      setProject(data.project as Project);
      setScript(((data.project as Project).narrationScript ?? ""));
      setNotice((data.note as string) ?? "Storyboard ready!");
    } catch (e) { setError(e instanceof Error ? e.message : "Planning failed."); }
    finally { setBusy(""); }
  }

  async function generate(sceneId: string, kind: "video" | "still" = "video") {
    setBusy(`gen:${sceneId}`); setError("");
    try {
      const { ok, status, data } = await fetchJson(
        `/api/projects/${id}/generate`,
        {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneId, kind })
        },
        60000
      );
      if (!ok || !data.job) throw new Error(apiError(status, data, "Generation request failed."));
      const job = data.job as GenerationJob;
      setDetail((p) => ({ ...p, [job.id]: job }));
      load();
      if (job.status === "failed") setError(job.error ?? "Generation failed.");
    } catch (e) { setError(e instanceof Error ? e.message : "Generation failed."); }
    finally { setBusy(""); }
  }

  async function generateAllStills() {
    if (!project) return;
    setBusy("allstills"); setError(""); setNotice("");
    try {
      for (const sid of project.sceneOrder) {
        const scene = project.scenes.find((s) => s.id === sid);
        if (scene?.stillPath) continue;
        const { ok, status, data } = await fetchJson(
          `/api/projects/${id}/generate`,
          {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sceneId: sid, kind: "still" })
          },
          60000
        );
        if (!ok || !data.job) throw new Error(apiError(status, data, "Still request failed."));
        const job = data.job as GenerationJob;
        setDetail((p) => ({ ...p, [job.id]: job }));
      }
      setNotice("Free stills queued for all scenes. They arrive one by one (free tier ≈1 request / 15s) — leave this page open.");
      load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed."); }
    finally { setBusy(""); }
  }

  async function patchScene(sceneId: string, data: Record<string, unknown>) {
    setError("");
    try {
      const { ok, status, data: d } = await fetchJson(
        `/api/projects/${id}`,
        {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scene: { id: sceneId, data } })
        },
        30000
      );
      if (!ok || !d.project) { setError(apiError(status, d, "Scene update failed.")); return; }
      setProject(d.project as Project);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scene update failed.");
    }
  }

  async function moveScene(sceneId: string, dir: -1 | 1) {
    if (!project) return;
    const order = [...project.sceneOrder];
    const i = order.indexOf(sceneId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    try {
      const { ok, status, data } = await fetchJson(
        `/api/projects/${id}`,
        {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneOrder: order })
        },
        30000
      );
      if (ok && data.project) setProject(data.project as Project);
      else setError(apiError(status, data, "Reorder failed."));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reorder failed.");
    }
  }

  async function assemble() {
    setBusy("assemble"); setError(""); setNotice("");
    try {
      const { ok, status, data } = await fetchJson(
        `/api/projects/${id}/assemble`,
        {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ burnCaptions: project?.burnCaptions, narrationVolume: project?.narrationVolume, musicVolume: project?.musicVolume })
        },
        600000
      );
      if (!ok || !data.project) throw new Error(apiError(status, data, "Assembly failed."));
      setProject(data.project as Project);
      setNotice("Export ready — watermark-free MP4 (ZORO AI adds no branding overlay).");
    } catch (e) { setError(e instanceof Error ? e.message : "Assembly failed."); }
    finally { setBusy(""); }
  }

  function speak(text: string) {
    if (!("speechSynthesis" in window)) { setError("This browser has no speech synthesis support."); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 2000));
    window.speechSynthesis.speak(u);
    setNotice("Previewing narration with your device's free built-in voice (no paid TTS needed).");
  }

  const [voice, setVoice] = useState("aria");
  const VOICE_OPTIONS = [
    { id: "aria", label: "Aria — natural English female ★" },
    { id: "guy", label: "Guy — natural English male" },
    { id: "emma", label: "Emma — expressive English" },
    { id: "nabanita", label: "Nabanita — Bangla female" },
    { id: "pradeep", label: "Pradeep — Bangla male" },
    { id: "nova", label: "Nova — AI voice (hosted)" },
    { id: "robot", label: "Robot — offline fallback" }
  ];
  const [autoLog, setAutoLog] = useState<string[]>([]);
  const [ytUrl, setYtUrl] = useState("");
  const [segSec, setSegSec] = useState(30);
  const [startSec, setStartSec] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const recRef = useRef<{ stream?: MediaStream; rec?: MediaRecorder; chunks: Blob[]; timer?: ReturnType<typeof setInterval> } | null>(null);

  /** Record your own voice with the mic — the most natural voiceover, free. */
  async function toggleRecord() {
    if (recording) {
      const cur = recRef.current;
      if (cur?.timer) clearInterval(cur.timer);
      cur?.rec?.stop();
      return;
    }
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot record audio.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setRecSecs(0);
        try {
          const blob = new Blob(chunks, { type: "audio/webm" });
          if (blob.size < 1000) { setError("Recording is empty — try again."); return; }
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.onerror = reject;
            r.readAsDataURL(blob);
          });
          const r = await fetchJson(`/api/projects/${id}/narration`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioDataUrl: dataUrl, filename: "my-voice.webm" })
          }, 120000);
          if (!r.ok || !r.data.project) throw new Error(apiError(r.status, r.data, "Voice upload failed."));
          setProject(r.data.project as Project);
          setNotice("Your recorded voice is attached — mixed under the final export.");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Voice upload failed.");
        }
      };
      recRef.current = { stream, rec, chunks };
      const timer = setInterval(() => setRecSecs((s) => s + 1), 1000);
      recRef.current.timer = timer;
      rec.start();
      setRecording(true);
      setRecSecs(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Microphone unavailable.");
    }
  }

  async function importYouTube() {
    if (!ytUrl.trim()) { setError("Paste a YouTube link (watch / shorts / youtu.be)."); return; }
    setBusy("yt"); setError(""); setNotice("");
    try {
      const { ok, status, data } = await fetchJson(`/api/projects/${id}/source`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtubeUrl: ytUrl.trim() })
      }, 600000);
      if (!ok || !data.project) throw new Error(apiError(status, data, "YouTube import failed."));
      setProject(data.project as Project);
      setNotice((data.note as string) ?? "Video imported.");
    } catch (e) { setError(e instanceof Error ? e.message : "Import failed."); }
    finally { setBusy(""); }
  }

  async function cutShorts() {
    setBusy("shorts"); setError(""); setNotice("");
    try {
      const { ok, status, data } = await fetchJson(`/api/projects/${id}/source`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "shorts", segSec, startSec })
      }, 600000);
      if (!ok || !data.project) throw new Error(apiError(status, data, "Cutting failed."));
      setProject(data.project as Project);
      setNotice((data.note as string) ?? "Shorts ready.");
    } catch (e) { setError(e instanceof Error ? e.message : "Cutting failed."); }
    finally { setBusy(""); }
  }

  /** Wait for one job to finish (throws on failure/timeout). Resume-safe: rerun continues. */
  async function pollJobToEnd(jobId: string, timeoutMs: number): Promise<GenerationJob> {
    const start = Date.now();
    for (;;) {
      const r = await fetch(`/api/jobs/${jobId}`);
      const d = await r.json();
      if (!r.ok) throw new Error((d.error as string) ?? "Job check failed.");
      const job = d.job as GenerationJob;
      setDetail((p) => ({ ...p, [job.id]: job }));
      if (job.status === "succeeded") return job;
      if (job.status === "failed" || job.status === "cancelled") {
        throw new Error(job.error ?? `Job ${job.status}.`);
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error("Taking too long — keep this page open and press Auto Movie again (it resumes where it stopped).");
      }
      await new Promise((res) => setTimeout(res, 4000));
    }
  }

  /** One-click full movie: storyboard → stills → clips → voiceover → MP4. Skips finished steps. */
  async function autoMake() {
    if (!project) return;
    if (project.providerId === "replicate" || project.providerId === "huggingface") {
      if (!confirm("This project uses a paid provider — clips will cost money. Continue? (For a free run, create a new project in Free Movie Mode.)")) return;
    }
    setBusy("auto"); setError(""); setNotice(""); setAutoLog([]);
    const log = (m: string) => setAutoLog((prev) => [...prev.slice(-9), m]);
    try {
      let proj = project;
      const refresh = async (): Promise<Project> => {
        const r = await fetch(`/api/projects/${id}`);
        const d = await r.json();
        if (!r.ok) throw new Error((d.error as string) ?? "Reload failed.");
        proj = d.project as Project;
        setProject(proj);
        setScript(proj.narrationScript ?? "");
        return proj;
      };
      // 1. Storyboard
      if (!proj.scenes.length) {
        log("Step 1/5: planning the storyboard…");
        const { ok, status, data } = await fetchJson(`/api/projects/${id}/plan`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, negativePrompt: negative })
        }, 120000);
        if (!ok) throw new Error(apiError(status, data, "Storyboard failed."));
        proj = await refresh();
        log(`Storyboard ready: ${proj.scenes.length} scene.`);
      } else log("Step 1/5: storyboard is already ready.");
      // 2. Stills
      for (const sid of proj.sceneOrder) {
        const sc = proj.scenes.find((s) => s.id === sid)!;
        if (sc.stillPath) { log(`Scene ${sc.index + 1}: image already exists, skipping.`); continue; }
        log(`Step 2/5: generating image for scene ${sc.index + 1} (free, takes a little while)…`);
        const { ok, status, data } = await fetchJson(`/api/projects/${id}/generate`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneId: sid, kind: "still" })
        }, 60000);
        if (!ok || !data.job) throw new Error(apiError(status, data, "Still request failed."));
        await pollJobToEnd((data.job as GenerationJob).id, 480000);
        proj = await refresh();
        log(`Scene ${sc.index + 1}: image ready.`);
      }
      // 3. Clips
      for (const sid of proj.sceneOrder) {
        const sc = proj.scenes.find((s) => s.id === sid)!;
        const done = (proj.jobs ?? []).some((j) => j.sceneId === sid && j.status === "succeeded" && j.clipPath);
        if (done) { log(`Scene ${sc.index + 1}: clip already exists, skipping.`); continue; }
        log(`Step 3/5: rendering video for scene ${sc.index + 1}…`);
        const { ok, status, data } = await fetchJson(`/api/projects/${id}/generate`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneId: sid, kind: "video" })
        }, 60000);
        if (!ok || !data.job) throw new Error(apiError(status, data, "Clip request failed."));
        await pollJobToEnd((data.job as GenerationJob).id, 600000);
        proj = await refresh();
        log(`Scene ${sc.index + 1}: video ready.`);
      }
      // 4. Voice
      if (!proj.narrationAudioPath) {
        log("Step 4/5: generating voiceover (free)…");
        const { ok, status, data } = await fetchJson(`/api/projects/${id}/narration`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tts: true, voice })
        }, 600000);
        if (!ok) throw new Error(apiError(status, data, "Voiceover failed."));
        proj = await refresh();
        log("Voice ready.");
      } else log("Step 4/5: voiceover already exists.");
      // 5. Assemble
      log("Step 5/5: assembling the final MP4…");
      const { ok, status, data } = await fetchJson(`/api/projects/${id}/assemble`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ burnCaptions: proj.burnCaptions, narrationVolume: proj.narrationVolume, musicVolume: proj.musicVolume })
      }, 600000);
      if (!ok) throw new Error(apiError(status, data, "Assembly failed."));
      proj = await refresh();
      log("Done! 🎬 Watch it below + Download.");
      setNotice("Auto Movie complete — watermark-free MP4 ready. To change characters or captions, edit them and press Render again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Auto Movie failed.");
      log("Stopped: " + (e instanceof Error ? e.message : "error"));
    } finally {
      setBusy("");
    }
  }

  async function freeVoiceover() {
    setBusy("tts"); setError(""); setNotice("");
    try {
      const { ok, status, data } = await fetchJson(
        `/api/projects/${id}/narration`,
        {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tts: true, voice })
        },
        600000
      );
      if (!ok || !data.project) throw new Error(apiError(status, data, "Voiceover failed."));
      setProject(data.project as Project);
      setNotice((data.note as string) ?? "Free voiceover ready.");
    } catch (e) { setError(e instanceof Error ? e.message : "Voiceover failed."); }
    finally { setBusy(""); }
  }

  if (!project) {
    return (
      <main className="mx-auto max-w-6xl px-5 py-10">
        <ZoroLogo />
        <p className="mt-6 text-sm text-muted">{error || "Loading studio…"}</p>
        <Link href="/" className="btn-ghost mt-4 inline-block text-sm">← Dashboard</Link>
      </main>
    );
  }

  const ordered = project.sceneOrder.map((sid) => project.scenes.find((s) => s.id === sid)!).filter(Boolean);
  const activeJobs = (project.jobs ?? []).filter((j) => j.status === "queued" || j.status === "processing").length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <ZoroLogo />
        <div className="flex gap-2">
          <Link href="/" className="btn-ghost text-sm">← Dashboard</Link>
          <button className="btn-ghost text-sm" onClick={() => load(true)}>Reload</button>
        </div>
      </header>

      {error && <div className="card mt-5 border-red-500/40"><p className="break-words text-sm text-red-300">{error}</p></div>}
      {notice && <div className="card mt-5 border-emerald-500/30"><p className="break-words text-sm text-emerald-200">{notice}</p></div>}

      <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
        <span className="badge border-slate-600 text-slate-300">Provider: {project.providerId}</span>
        <span className="badge border-slate-600 text-slate-300">{project.settings.aspectRatio} · {project.settings.durationSec}s · {project.settings.style}</span>
        {activeJobs > 0 && <span className="badge border-blue-500/40 text-blue-300">{activeJobs} job(s) running — live status</span>}
      </div>
      {project.providerId === "worker" && (
        <div className="card mt-5 border-emerald-500/30">
          <p className="text-sm text-emerald-200">
            Running on <b>your own model server</b> — no third-party service, no key, no account, no per-use fee in this project.
            “API” here only means ZORO AI talking directly to your server.
          </p>
        </div>
      )}

      {/* 1. Prompt + storyboard */}
      <section className="card mt-5">
        <h2 className="text-lg font-bold">1 · Prompt & storyboard</h2>
        <div className="mt-3">
          <label className="label" htmlFor="sprompt">Story prompt</label>
          <textarea id="sprompt" className="input min-h-[100px]" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <p className={`mt-1 text-right text-[11px] ${prompt.length > MAX_PROMPT ? "text-red-300" : "text-muted"}`}>
            {prompt.length} / {MAX_PROMPT}
          </p>
        </div>
        <div className="mt-3">
          <label className="label" htmlFor="sneg">Negative prompt (optional)</label>
          <input id="sneg" className="input" value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="blurry, distorted face, watermark…" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy === "plan"} onClick={plan}>{busy === "plan" ? "Planning…" : "Generate storyboard"}</button>
          <span className="text-xs text-muted self-center">Default 20s → four 5s scenes. Planning is free and never spends generation budget.</span>
        </div>
        {project.summary && (
          <div className="mt-4 break-words rounded-xl bg-black/30 p-4 text-sm">
            <p className="font-semibold">{project.title}</p>
            <p className="mt-1 text-slate-300">{project.summary}</p>
          </div>
        )}
      </section>

      {/* 1b. YouTube / video → Shorts */}
      <section className="card mt-5 border-purple-500/30">
        <h2 className="text-lg font-bold">YouTube / Video → Shorts (free)</h2>
        <p className="mt-1 text-xs text-muted">
          Cut vertical 9:16 Shorts from any public YouTube video or your own video file.
          Every Short joins as a scene — preview, voice, export all work.
          Only import videos you own or have rights to.
        </p>
        <label className="label mt-3" htmlFor="yturl">YouTube link</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input id="yturl" className="input" placeholder="https://youtube.com/watch?v=… / shorts / youtu.be" value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} />
          <button className="btn-ghost shrink-0 text-xs" disabled={busy === "yt"} onClick={importYouTube}>
            {busy === "yt" ? "Downloading…" : "Import video"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <label className="btn-ghost cursor-pointer">Upload your file (≤150MB)
            <input type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              if (f.size > 150 * 1024 * 1024) { setError("File is over 150MB — importing via a YouTube link works better for big files."); return; }
              setBusy("upload"); setError("");
              try {
                const dataUrl = await fileToDataUrl(f);
                const { ok, status, data } = await fetchJson(`/api/projects/${id}/source`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ upload: { filename: f.name, dataUrl } })
                }, 600000);
                if (!ok || !data.project) throw new Error(apiError(status, data, "Upload failed."));
                setProject(data.project as Project);
                setNotice((data.note as string) ?? "Uploaded.");
              } catch (err) { setError(err instanceof Error ? err.message : "Upload failed."); }
              finally { setBusy(""); }
            }} />
          </label>
          {busy === "upload" && <span className="text-muted">Uploading…</span>}
        </div>
        {project.sourceVideoPath && (
          <div className="mt-3 rounded-xl border border-slate-700 p-3">
            <p className="text-xs text-muted">Source: {Math.floor((project.sourceDurationSec ?? 0) / 60)}:{String(Math.floor((project.sourceDurationSec ?? 0) % 60)).padStart(2, "0")} min</p>
            <video controls preload="none" src={`/api/media/${project.sourceVideoPath}`} className="mt-2 w-full max-w-xl rounded-xl" />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <label>Clip length (sec)
                <select className="input ml-1 w-24" value={segSec} onChange={(e) => setSegSec(Number(e.target.value))}>
                  {[15, 30, 45, 60].map((v) => <option key={v} value={v}>{v}s</option>)}
                </select>
              </label>
              <label>Start at (sec)
                <input type="number" min={0} className="input ml-1 w-24" value={startSec} onChange={(e) => setStartSec(Math.max(0, Number(e.target.value) || 0))} />
              </label>
              <button className="btn-primary" disabled={busy === "shorts"} onClick={cutShorts}>
                {busy === "shorts" ? "Cutting…" : "Cut Shorts (vertical 9:16)"}
              </button>
            </div>
          </div>
        )}
        {(project.shorts ?? []).length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold">Shorts ({(project.shorts ?? []).length})</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(project.shorts ?? []).map((sh, i) => (
                <div key={i} className="rounded-lg border border-slate-700 p-2">
                  <p className="mb-1 text-[11px] text-slate-300">Short {i + 1} · {sh.lenSec}s</p>
                  <video controls preload="none" src={`/api/media/${sh.path}`} className="w-full rounded-lg" />
                  <a className="btn-ghost mt-1 inline-block text-[11px]" href={`/api/media/${sh.path}`} download={`short-${i + 1}.mp4`}>Download</a>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 2. Characters */}
      <section className="card mt-5">
        <h2 className="text-lg font-bold">2 · Character Bible — approve before generating</h2>
        <p className="mt-1 text-xs text-muted">
          Approved reference images are reused in every scene with that character. Identity preservation depends on the model —
          reference-capable video models do their best but perfection is never promised.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {(project.characters ?? []).map((c) => (
            <div key={c.id} className={`rounded-xl border p-4 ${c.approved ? "border-emerald-500/40" : "border-slate-700"}`}>
              <div className="flex gap-3">
                {c.referenceImagePath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/media/${c.referenceImagePath}`} alt={`${c.name} reference`} className="h-28 w-20 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-28 w-20 items-center justify-center rounded-lg bg-black/40 text-[11px] text-muted">No image</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{c.name} <span className="text-xs text-muted">· {c.role}</span></p>
                  <p className="text-xs text-muted">{c.age} · {c.clothing}</p>
                  <p className="mt-1 line-clamp-3 text-xs text-slate-300">{c.fixedDescription}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <StatusBadge status={c.approved ? "approved" : "needs approval"} />
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <button className="btn-ghost" onClick={async () => {
                  try {
                    const { ok, status, data } = await fetchJson(`/api/projects/${id}/characters`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve", characterId: c.id, approved: !c.approved }) }, 30000);
                    if (ok && data.project) setProject(data.project as Project); else setError(apiError(status, data, "Approve failed."));
                  } catch (e) { setError(e instanceof Error ? e.message : "Approve failed."); }
                }}>{c.approved ? "Unapprove" : "Approve"}</button>
                <button className="btn-ghost" onClick={async () => {
                  const fixed = promptInput("Edit fixed visual description:", c.fixedDescription);
                  if (fixed === null) return;
                  const apply = confirm("Apply this change to existing scenes featuring this character?");
                  const r = await fetch(`/api/projects/${id}/characters`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", characterId: c.id, patch: { fixedDescription: fixed }, applyToExistingScenes: apply }) });
                  const d = await r.json(); if (r.ok) { setProject(d.project); setNotice(apply ? "Character updated and re-stamped into existing scenes." : "Character updated (existing scenes untouched)."); } else setError(d.error);
                }}>Edit</button>
                <label className="btn-ghost cursor-pointer">Upload art
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    const dataUrl = await fileToDataUrl(f);
                    const r = await fetch(`/api/projects/${id}/characters`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "upload", characterId: c.id, filename: f.name, dataUrl }) });
                    const d = await r.json(); if (r.ok) setProject(d.project); else setError(d.error);
                  }} />
                </label>
                <button className="btn-ghost" onClick={async () => {
                  if (!confirm(`Delete ${c.name}?`)) return;
                  const r = await fetch(`/api/projects/${id}/characters`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", characterId: c.id }) });
                  const d = await r.json(); if (r.ok) setProject(d.project); else setError(d.error);
                }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
        <CharacterCreator projectId={id} onDone={(p) => setProject(p)} onError={setError} onNotice={setNotice} setBusy={setBusy} busy={busy} />
      </section>

      {/* 3. Scenes */}
      <section className="card mt-5">
        <h2 className="text-lg font-bold">3 · Scenes — generate, review, regenerate individually</h2>
        <p className="mt-1 text-xs text-muted">
          100% free path: make a <b>free still</b> per scene (AI image, no key), then render clips with motion on your PC.
          {project.providerId === "slideshow" && " This project uses Free Movie Mode — clips render automatically from stills."}
        </p>
        <div className="mt-2">
          <button className="btn-ghost text-xs" disabled={busy === "allstills"} onClick={generateAllStills}>
            {busy === "allstills" ? "Queueing…" : "Generate free stills for all scenes"}
          </button>
        </div>
        {ordered.length === 0 && <p className="mt-3 text-sm text-muted">No scenes yet — generate the storyboard first.</p>}
        <ol className="mt-4 space-y-4">
          {ordered.map((s) => {
            const jobs = jobsFor(s.id);
            const latest = jobs[jobs.length - 1];
            const stillJob = [...jobs].reverse().find((j) => j.providerId === "free-still");
            const chars = s.characterIds.map((cid) => project.characters.find((c) => c.id === cid)).filter(Boolean);
            const clipLabel = project.providerId === "slideshow" ? "Generate free clip" : project.providerId === "worker" ? "Generate clip (your model)" : "Generate clip (paid)";
            const tag = latest?.providerId === "free-still" ? " (free still)" : latest?.providerId === "slideshow" ? " (free)" : latest?.providerId === "worker" || latest?.providerId === "worker-still" ? " (your model)" : "";
            return (
              <li key={s.id} className="rounded-xl border border-slate-700 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{s.index + 1}. {s.title} <span className="text-xs text-muted">· {s.durationSec}s</span></p>
                  <div className="flex flex-wrap gap-1">
                    {latest ? <StatusBadge status={`${latest.status}${tag}`} /> : <StatusBadge status="not generated" />}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {chars.map((c) => c && (
                    <span key={c.id} className="inline-flex items-center gap-1 rounded-full border border-slate-600 py-0.5 pl-0.5 pr-2 text-[11px] text-slate-300">
                      {c.referenceImagePath
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={`/api/media/${c.referenceImagePath}`} alt={c.name} className="h-6 w-6 rounded-full object-cover" />
                        : <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700">{c.name[0]}</span>}
                      {c.name}{c.approved ? " ✓" : ""}
                    </span>
                  ))}
                </div>
                <label className="label mt-3">Visual prompt (sent to the video model)</label>
                <textarea className="input min-h-[80px] text-xs" defaultValue={s.visualPrompt} key={s.id + s.visualPrompt.slice(0, 20)} onBlur={(e) => { if (e.target.value !== s.visualPrompt) patchScene(s.id, { visualPrompt: e.target.value }); }} />
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                  <label>Camera<input className="input mt-1 text-xs" defaultValue={s.camera} onBlur={(e) => { if (e.target.value !== s.camera) patchScene(s.id, { camera: e.target.value }); }} /></label>
                  <label>Lighting<input className="input mt-1 text-xs" defaultValue={s.lighting} onBlur={(e) => { if (e.target.value !== s.lighting) patchScene(s.id, { lighting: e.target.value }); }} /></label>
                  <label>Caption<input className="input mt-1 text-xs" defaultValue={s.caption} onBlur={(e) => { if (e.target.value !== s.caption) patchScene(s.id, { caption: e.target.value }); }} /></label>
                </div>
                {latest?.clipPath && (
                  <video controls preload="metadata" src={`/api/media/${latest.clipPath}`} className="mt-3 w-full max-w-xl rounded-xl" />
                )}
                {!latest?.clipPath && (s.stillPath || stillJob?.posterPath) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/media/${s.stillPath ?? stillJob?.posterPath}`} alt={`Scene ${s.index + 1} still`} className="mt-3 w-full max-w-xl rounded-xl" />
                )}
                {latest?.posterPath && !latest?.clipPath && !s.stillPath && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/media/${latest.posterPath}`} alt="Scene preview" className="mt-3 w-full max-w-xl rounded-xl" />
                )}
                {stillJob && stillJob.status !== "succeeded" && <p className="mt-1 text-xs text-muted">Still: {stillJob.status}{stillJob.error ? ` — ${stillJob.error}` : ""}</p>}
                {latest?.error && latest.providerId !== "free-still" && <p className="mt-2 break-words text-xs text-red-300">{latest.error}</p>}
                {(() => {
                  const takes = jobs.filter((j) => j.status === "succeeded" && j.clipPath).reverse();
                  if (takes.length === 0) return null;
                  return (
                    <div className="mt-3 rounded-xl border border-slate-700 p-3">
                      <p className="text-xs font-semibold">
                        Takes — preview them all and send the best to the final video ({takes.length} option{takes.length > 1 ? "s" : ""})
                      </p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {takes.map((t, ti) => {
                          const isActive = s.selectedJobId ? s.selectedJobId === t.id : ti === 0;
                          return (
                            <div key={t.id} className={`rounded-lg border p-2 ${isActive ? "border-emerald-500/60" : "border-slate-700"}`}>
                              <p className="mb-1 text-[11px] font-semibold text-slate-300">
                                Option {ti + 1}{isActive ? " ✓ (goes to final)" : ""}
                              </p>
                              <video controls preload="none" src={`/api/media/${t.clipPath}`} className="w-full rounded-lg" />
                              <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                                {!isActive && (
                                  <button className="btn-ghost" onClick={() => patchScene(s.id, { selectedJobId: t.id })}>
                                    Best — use in final
                                  </button>
                                )}
                                <a className="btn-ghost" href={`/api/media/${t.clipPath}`} download={`scene${s.index + 1}-option${ti + 1}.mp4`}>
                                  Download
                                </a>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <p className="mt-1 text-[11px] text-muted">Want more options? Press “Regenerate” — a new take arrives, old ones stay.</p>
                    </div>
                  );
                })()}
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <button className="btn-ghost" disabled={busy === `gen:${s.id}`} onClick={() => generate(s.id, "still")}>
                    Free still
                  </button>
                  <button className="btn-primary" disabled={busy === `gen:${s.id}`} onClick={() => generate(s.id, "video")}>
                    {latest && latest.providerId !== "free-still" ? `Regenerate (${clipLabel.toLowerCase()})` : clipLabel}
                  </button>
                  <button className="btn-ghost" onClick={() => moveScene(s.id, -1)}>Move up</button>
                  <button className="btn-ghost" onClick={() => moveScene(s.id, 1)}>Move down</button>
                  <button className="btn-ghost" onClick={async () => {
                    const r = await fetch(`/api/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ duplicateSceneId: s.id }) });
                    const d = await r.json(); if (r.ok) setProject(d.project); else setError(d.error);
                  }}>Duplicate</button>
                  <button className="btn-ghost" onClick={async () => {
                    if (!confirm("Delete this scene?")) return;
                    const r = await fetch(`/api/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deleteSceneId: s.id }) });
                    const d = await r.json(); if (r.ok) setProject(d.project); else setError(d.error);
                  }}>Delete</button>
                </div>
                {jobs.length > 1 && <p className="mt-1 text-[11px] text-muted">{jobs.length} attempts — latest shown, earlier clips kept in storage until cleanup.</p>}
              </li>
            );
          })}
        </ol>
      </section>

      {/* 4. Narration */}
      <section className="card mt-5">
        <h2 className="text-lg font-bold">4 · Narration & captions (optional)</h2>
        <label className="label mt-3" htmlFor="script">Narration script</label>
        <textarea id="script" className="input min-h-[100px]" value={script} onChange={(e) => setScript(e.target.value)} />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button className="btn-ghost" onClick={async () => {
            const r = await fetch(`/api/projects/${id}/narration`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ narrationScript: script }) });
            const d = await r.json(); if (r.ok) { setProject(d.project); setNotice("Narration saved. Captions/SRT are generated from scene captions."); } else setError(d.error);
          }}>Save narration</button>
          <button className="btn-ghost" onClick={() => speak(script || project.narrationScript || "")}>Preview voice (free, this device)</button>
          <select className="input w-52" value={voice} onChange={(e) => setVoice(e.target.value)} aria-label="Voice">
            {VOICE_OPTIONS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
          <button className="btn-ghost" disabled={busy === "tts"} onClick={freeVoiceover}>
            {busy === "tts" ? "Speaking scenes… (free)" : "Generate voiceover (free)"}
          </button>
          <button className={`btn-ghost ${recording ? "border-red-500/60 text-red-300" : ""}`} onClick={toggleRecord}>
            {recording ? `⏹ Stop (${recSecs}s)` : "🎙 Record my voice"}
          </button>
          <a className="btn-ghost" href={`/api/projects/${id}/narration`} download={`${project.name}-captions.srt`}>Download SRT</a>
          <label className="btn-ghost cursor-pointer">Upload narration audio
            <input type="file" accept="audio/mpeg,audio/wav,audio/ogg" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              const audioDataUrl = await fileToDataUrl(f);
              const r = await fetch(`/api/projects/${id}/narration`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audioDataUrl, filename: f.name }) });
              const d = await r.json(); if (r.ok) { setProject(d.project); setNotice("Narration audio attached — mixed under the final export."); } else setError(d.error);
            }} />
          </label>
          {project.narrationAudioPath && (
            <button className="btn-ghost" onClick={async () => {
              const r = await fetch(`/api/projects/${id}/narration`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clearAudio: true }) });
              const d = await r.json(); if (r.ok) setProject(d.project);
            }}>Remove audio</button>
          )}
        </div>
        {project.narrationAudioPath && <audio controls src={`/api/media/${project.narrationAudioPath}`} className="mt-3 w-full max-w-xl" />}
        <p className="mt-2 text-xs text-muted">
          Natural voices (Aria/Guy/Emma/Nabanita/Pradeep) are free neural voices, no key.
          Robot voice works fully offline. Or record/upload your own voice above.
          {project.scenes.length > 12 && ` This project has ${project.scenes.length} scenes — voiceover may take ~${Math.round(project.scenes.length * 0.35)} min. Keep this page open.`}
        </p>
      </section>

      {/* 5. Export */}
      <section className="card mt-5 border-blue-500/30">
        <h2 className="text-lg font-bold">★ Auto Movie — full video with one button</h2>
        <p className="mt-1 text-xs text-muted">
          Storyboard → images → video clips → voice → final MP4 — everything automatic.
          Finished steps are skipped; if it stops, press again to resume from there.
        </p>
        <button className="btn-primary mt-3 w-full sm:w-auto" disabled={busy === "auto"} onClick={autoMake}>
          {busy === "auto" ? "Rendering your movie… don't close this page" : "✨ Make my Auto Movie"}
        </button>
        {autoLog.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-xl bg-black/30 p-3 text-xs text-slate-300">
            {autoLog.map((l, i) => <li key={i}>• {l}</li>)}
          </ul>
        )}
      </section>

      <section className="card mt-5">
        <h2 className="text-lg font-bold">5 · Assemble & export</h2>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={project.burnCaptions} onChange={async (e) => {
              const r = await fetch(`/api/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ burnCaptions: e.target.checked }) });
              const d = await r.json(); if (r.ok) setProject(d.project);
            }} /> Burn captions into video
          </label>
          <label className="text-xs">Narration vol
            <input type="number" min={0} max={2} step={0.1} className="input ml-2 w-20" value={project.narrationVolume} onChange={async (e) => {
              const v = Number(e.target.value);
              const r = await fetch(`/api/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ narrationVolume: v }) });
              const d = await r.json(); if (r.ok) setProject(d.project);
            }} />
          </label>
          <label className="text-xs">Quality
            <select className="input ml-2 w-44" value={project.settings.quality ?? "balanced"} onChange={async (e) => {
              const r = await fetch(`/api/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: { quality: e.target.value } }) });
              const d = await r.json(); if (r.ok) setProject(d.project); else setError(d.error ?? "Quality update failed.");
            }}>
              <option value="fast">Fast 720p</option>
              <option value="balanced">Balanced 720p ★</option>
              <option value="best">Best 1080p (slow)</option>
            </select>
          </label>
        </div>
        <p className="mt-1 text-[11px] text-muted">Best = 1080p stills + sharper encode. Slower on weak PCs — Balanced is the sweet spot.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy === "assemble"} onClick={assemble}>{busy === "assemble" ? "Rendering…" : "Render final MP4"}</button>
          {project.output?.path && <a className="btn-ghost text-sm" href={`/api/media/${project.output.path}`} download>Download MP4</a>}
          {project.output?.srtPath && <a className="btn-ghost text-sm" href={`/api/media/${project.output.srtPath}`} download>Download SRT</a>}
        </div>
        {project.output?.status === "failed" && <p className="mt-2 break-words text-sm text-red-300">{project.output.error}</p>}
        {project.output?.path && (
          <video controls src={`/api/media/${project.output.path}`} className="mt-4 w-full max-w-2xl rounded-xl" />
        )}
        <p className="mt-2 text-xs text-muted">No ZORO AI watermark is ever added. Free Movie Mode exports from your AI stills even if some clips never rendered.</p>
      </section>
    </main>
  );
}

function promptInput(msg: string, initial: string): string | null {
  // Small wrapper so tests/lint stay happy with window.prompt usage in one place.
  return window.prompt(msg, initial);
}

function CharacterCreator({ projectId, onDone, onError, onNotice, setBusy, busy }: {
  projectId: string;
  onDone: (p: Project) => void;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  setBusy: (s: string) => void;
  busy: string;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("Protagonist");
  const [desc, setDesc] = useState("");
  async function submit(kind: "create" | "generate") {
    setBusy("char");
    try {
      const r = await fetch(`/api/projects/${projectId}/characters`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: kind, name: name || "New character", role, fixedDescription: desc || `${name || "Character"}, ${role}` })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Character creation failed.");
      onDone(d.project);
      setName(""); setDesc("");
      if (d.notice) onNotice(d.notice);
    } catch (e) { onError(e instanceof Error ? e.message : "Failed."); }
    finally { setBusy(""); }
  }
  return (
    <div className="mt-4 rounded-xl border border-slate-700 p-4">
      <p className="text-sm font-semibold">Add a character</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <input className="input text-xs" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input text-xs" placeholder="Role" value={role} onChange={(e) => setRole(e.target.value)} />
        <input className="input text-xs" placeholder="Fixed visual description" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div className="mt-2 flex gap-2 text-xs">
        <button className="btn-ghost" disabled={busy === "char"} onClick={() => submit("create")}>Add manually</button>
        <button className="btn-ghost" disabled={busy === "char"} onClick={() => submit("generate")}>{busy === "char" ? "Working…" : "Generate free reference image"}</button>
      </div>
    </div>
  );
}
