"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ZoroLogo, StatusBadge, Empty } from "@/components/ui";
import { fetchJson, apiError } from "@/lib/client";
import { MAX_PROMPT, MAX_DURATION, MIN_DURATION } from "@/lib/validate";
import type { ProviderInfo } from "@/lib/types";

interface SlimProject {
  id: string;
  name: string;
  prompt: string;
  providerId: string;
  scenes: number;
  characters: number;
  jobs: Array<{ id: string; sceneId: string; status: string }>;
  hasOutput: boolean;
  createdAt: string;
  updatedAt: string;
}

const EXAMPLES = [
  "A detective in old Dhaka uncovers a 200-year-old mystery hidden inside a riverside mansion.",
  "The rise and fall of a forgotten desert kingdom, told as an epic historical documentary.",
  "A young astronaut discovers a glowing garden inside an abandoned space station.",
  "A haunted lighthouse keeper finds a letter that was never delivered — dark mystery, stormy night."
];

export default function Dashboard() {
  const [projects, setProjects] = useState<SlimProject[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [ffmpeg, setFfmpeg] = useState<{ ok: boolean; version?: string; help?: string }>({ ok: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [health, setHealth] = useState<{ ok: boolean; summary: string; serverless?: boolean; items: Array<{ id: string; label: string; ok: boolean; detail: string; fix?: string }> } | null>(null);

  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [providerId, setProviderId] = useState("slideshow");
  const [durationSec, setDurationSec] = useState(20);
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [style, setStyle] = useState("cinematic-documentary");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [pj, pv] = await Promise.all([
        fetch("/api/projects").then((r) => r.json()),
        fetch("/api/providers").then((r) => r.json())
      ]);
      if (pj.error) throw new Error(pj.error);
      setProjects(pj.projects ?? []);
      setProviders(pv.providers ?? []);
      setFfmpeg(pv.ffmpeg ?? { ok: false });
      try {
        const h = await fetch("/api/health").then((r) => r.json());
        setHealth(h);
      } catch {
        setHealth(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function createProject() {
    if (prompt.trim().length < 10) {
      setError("Describe your video in at least 10 characters.");
      return;
    }
    if (prompt.length > MAX_PROMPT) {
      setError(`Prompt ${prompt.length} characters — limit ${MAX_PROMPT}. Shorten it and retry (keep the main story, trim the extra part).`);
      return;
    }
    // Never send a bad duration: empty/garbage → 20, out-of-range → clamp.
    const safeDuration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(Number(durationSec) || 20)));
    setDurationSec(safeDuration);
    setCreating(true);
    setError("");
    try {
      const { ok, status, data } = await fetchJson(
        "/api/projects",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim() || "Untitled video",
            prompt: prompt.trim(),
            providerId,
            settings: { durationSec: safeDuration, aspectRatio, style, motionIntensity: "medium" }
          })
        },
        30000
      );
      if (!ok || !data.project) throw new Error(apiError(status, data, "Could not create project."));
      window.location.href = `/projects/${(data.project as { id: string }).id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create project.");
      setCreating(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this project and its generated files?")) return;
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <ZoroLogo />
        <nav className="flex items-center gap-3 text-sm text-slate-300">
          <span className={`badge ${ffmpeg.ok ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/40 text-amber-300"}`}>
            FFmpeg: {ffmpeg.ok ? "ready" : "missing"}
          </span>
          <a className="btn-ghost" href="#create">Create New Video</a>
        </nav>
      </header>

      {health?.serverless && (
        <div className="card mt-6 border-amber-500/40">
          <p className="font-semibold text-amber-200">Hosted demo link — video rendering is disabled here.</p>
          <p className="mt-1 text-sm text-muted">
            This server cannot keep files or render video (see System check below).
            For real videos, run on your PC: open <code className="text-slate-200">C:\Users\rafid\zoro-ai\start-zoro.bat</code> (double-click)
            and use the local site at <code className="text-slate-200">http://localhost:3000</code>.
          </p>
        </div>
      )}

      {!ffmpeg.ok && (
        <div className="card mt-6 border-amber-500/30">
          <p className="font-semibold text-amber-200">FFmpeg is not installed — video rendering is unavailable.</p>
          <p className="mt-1 text-sm text-muted">
            Install it on Windows with: <code className="text-slate-200">winget install Gyan.FFmpeg</code> then restart the
            terminal and the dev server. Story planning, characters and job tracking still work without it.
          </p>
        </div>
      )}

      {health && (
        <div className={`card mt-6 ${health.ok ? "border-emerald-500/30" : "border-red-500/40"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">System check {health.ok ? "✅" : "❌"}</h2>
            <button className="btn-ghost text-xs" onClick={refresh}>Re-check</button>
          </div>
          <p className="mt-1 text-sm text-muted">{health.summary}</p>
          <ul className="mt-3 space-y-2">
            {health.items.map((it) => (
              <li key={it.id} className="rounded-xl border border-slate-700/60 p-3 text-sm">
                <p className="font-semibold">
                  <span className={it.ok ? "text-emerald-300" : "text-red-300"}>{it.ok ? "● " : "● "}</span>
                  {it.label} — <span className={it.ok ? "text-emerald-300" : "text-red-300"}>{it.ok ? "OK" : "FAILED"}</span>
                </p>
                <p className="mt-0.5 break-words text-xs text-muted">{it.detail}</p>
                {it.fix && <p className="mt-0.5 break-words text-xs text-amber-200">Fix: {it.fix}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="card mt-6 border-red-500/40"><p className="break-words text-sm text-red-300">{error}</p></div>}

      <section id="create" className="card mt-6">
        <h1 className="text-2xl font-bold">Create New Video</h1>
        <p className="mt-1 text-sm text-muted">Type one prompt. ZORO AI plans the story, locks character identity, then renders scene by scene.</p>
        <label className="label mt-5" htmlFor="prompt">Story prompt</label>
        <textarea
          id="prompt"
          className="input min-h-[120px]"
          placeholder="Example: A detective in old Dhaka uncovers a 200-year-old mystery…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <p className={`mt-1 text-right text-[11px] ${prompt.length > MAX_PROMPT ? "text-red-300" : "text-muted"}`}>
          {prompt.length} / {MAX_PROMPT}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="btn-ghost text-xs" onClick={() => setPrompt(ex)}>Use example</button>
          ))}
          <button className="btn-ghost text-xs" onClick={() => setPrompt("")}>Clear</button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="label" htmlFor="pname">Project name</label>
            <input id="pname" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled video" />
          </div>
          <div>
            <label className="label" htmlFor="provider">Video provider</label>
            <select id="provider" className="input" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.id === "slideshow" ? "★ " : ""}{p.label}{p.requiresApiKey && !p.configured ? " — needs key (paid)" : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="dur">Duration (sec, max 1800 = 30 min)</label>
            <input id="dur" type="number" min={MIN_DURATION} max={MAX_DURATION} className="input" value={durationSec} onChange={(e) => setDurationSec(Number(e.target.value))} />
            <p className="mt-1 text-[11px] text-muted">
              ≈ {Math.max(1, Math.round((Number(durationSec) || 20) / 5))} scenes · free stills ~{Math.max(1, Math.round(Math.max(1, Math.round((Number(durationSec) || 20) / 5)) * 0.7))} min (keep this page open; resumes anytime)
            </p>
          </div>
          <div>
            <label className="label" htmlFor="ar">Aspect ratio</label>
            <select id="ar" className="input" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as typeof aspectRatio)}>
              <option value="9:16">9:16 vertical</option>
              <option value="16:9">16:9 widescreen</option>
              <option value="1:1">1:1 square</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="style">Style</label>
            <select id="style" className="input" value={style} onChange={(e) => setStyle(e.target.value)}>
              <option value="realistic">Realistic</option>
              <option value="cinematic-documentary">Cinematic documentary</option>
              <option value="historical">Historical</option>
              <option value="dark-mystery">Dark mystery</option>
              <option value="fantasy">Fantasy</option>
              <option value="animation">Animation</option>
              <option value="custom">Custom</option>
            </select>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button className="btn-primary" disabled={creating} onClick={createProject}>
            {creating ? "Creating…" : "Create project & open studio"}
          </button>
          <span className="text-xs text-muted">★ Free Movie Mode is 100% free: AI stills + motion + AI voiceover, no keys, no payments. (True AI video diffusion has no free unlimited option anywhere — this is the honest free path.)</span>
        </div>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Recent projects</h2>
            <button className="btn-ghost text-xs" onClick={refresh}>Refresh</button>
          </div>
          {loading ? (
            <p className="mt-4 text-sm text-muted">Loading…</p>
          ) : projects.length === 0 ? (
            <div className="mt-4">
              <Empty title="No videos yet" hint="Create your first project above — your storyboard, characters and clips will appear here." />
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {projects.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/60 p-4">
                  <div className="min-w-0 flex-1 basis-56">
                    <Link href={`/projects/${p.id}`} className="font-semibold hover:text-blue-300">{p.name}</Link>
                    <p className="truncate text-xs text-muted">{p.prompt}</p>
                    <p className="mt-1 text-xs text-muted">
                      {p.scenes} scenes · {p.characters} characters · provider: {p.providerId} · {p.hasOutput ? "exported" : "no export yet"}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.jobs.slice(0, 6).map((j) => <StatusBadge key={j.id} status={j.status} />)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/projects/${p.id}`} className="btn-ghost text-xs">Open studio</Link>
                    <button className="btn-ghost text-xs" onClick={() => remove(p.id)}>Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h2 className="text-lg font-bold">Generation models</h2>
          <ul className="mt-3 space-y-3 text-sm">
            {providers.map((p) => (
              <li key={p.id} className="rounded-xl border border-slate-700/60 p-3">
                <p className="font-semibold">{p.label}</p>
                <p className="mt-1 text-xs text-muted">{p.costNote}</p>
                <p className="mt-1 text-xs text-muted">Clips up to {p.maxClipSec}s · refs: {p.supportsReferenceImages ? "supported (model-dependent)" : "not supported"}</p>
                {!p.configured && p.missing && <p className="mt-1 text-xs text-amber-300">{p.missing}</p>}
                {p.configured && <p className="mt-1 text-xs text-emerald-300">Ready.</p>}
              </li>
            ))}
          </ul>
          <h2 className="mt-5 text-lg font-bold">Saved characters</h2>
          <p className="mt-1 text-xs text-muted">Characters live inside each project (Character Bible). Reuse them by duplicating a project — cross-project sharing ships with accounts in a multi-user deployment.</p>
        </div>
      </section>

      <footer className="mt-10 text-center text-xs text-muted">
        ZORO AI · No forced watermark on exports · Real job statuses only — never simulated success.
      </footer>
    </main>
  );
}
