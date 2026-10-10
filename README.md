# ZORO AI — One Prompt. Consistent Characters. Cinematic Videos.

A real, working prompt-to-video studio (Next.js + TypeScript + Tailwind). Type one prompt →
storyboard → approve character references → generate scenes → assemble → export MP4.

> Honesty rules built in: no fake credits, no simulated progress, no placeholder MP4s
> claimed as AI output. Failures are shown as failures.

## ★ 100% FREE pipeline (verified working, $0 spent)

One honest note first: **true AI video diffusion has no free unlimited option
anywhere** — every provider that does real text-to-video charges or gates usage.
So ZORO AI's free path is: **AI stills + cinematic motion + voiceover**, all free:

1. **Storyboard** — offline planner (always works) → tries a free hosted LLM, falls back silently.
2. **Scene stills** — FREE AI images via Pollinations, no key, character identity stamped into every prompt.
3. **Motion** — FFmpeg Ken Burns zoom/drift rendered on your PC (labeled as animated stills, never as AI diffusion).
4. **Voiceover** — tries free hosted TTS; if refused, auto-falls back to **eSpeak NG** (free, offline, robotic).
5. **Export** — 720×1280 / 1280×720 / 720×720 MP4 + SRT, zero watermark from ZORO AI.

Verified end-to-end on 2026-10-09: 20.0s 720×1280 h264+aac MP4 with voiceover,
built for $0 on an i3/8GB Windows 10 PC. Free-tier caveats (shown in-app, never hidden):
anonymous Pollinations calls are ≈1 req / 15s and sometimes return HTTP 402
(registration/payment wall) — wait and retry, or **free-register at
https://auth.pollinations.ai** and set `POLLINATIONS_TOKEN` in `.env.local`
for higher limits + watermark removal. Free-tier images may carry a watermark.

## What is working (v0.1)

- Dashboard: create/open/duplicate/delete projects, provider status, FFmpeg status.
- Offline storyboard planner (free, no key): title, summary, narration script,
  Character Bible with fixed reusable descriptions, 20s → four 5s scenes by default,
  continuity-aware prompts, negative prompt, captions.
- Optional LLM planner if `OPENAI_*` env is set (OpenAI-compatible `/chat/completions`).
- Character Library per project: manual add, **free** reference image via Pollinations
  (anonymous ~1 req/15s; free tier may watermark — disclosed in-app), upload own art,
  approve/unapprove, edit with explicit “apply to existing scenes” choice.
- Provider architecture (only what works):
  - `slideshow` — **Free Movie Mode**: AI stills + motion, 100% free, no key.
  - `replicate` — REAL paid API (`POST https://api.replicate.com/v1/predictions`,
    Bearer `REPLICATE_API_TOKEN`; you set `REPLICATE_VIDEO_MODEL`). Paid per run.
  - `huggingface` — integration point (set `HF_TOKEN`/`HF_VIDEO_MODEL`; confirm the
    model’s router payload in HF docs before use — the app refuses to guess).
  - `import` — YouTube/upload Shorts cutting (free local tools).
- Per-scene jobs with live polling, per-scene regenerate, reorder/duplicate/delete,
  resume-safe (approved characters + succeeded clips survive replans/reloads).
- Narration: editable script, free on-device voice preview (Web Speech),
  audio upload, SRT sidecar + download, optional caption burn-in.
- FFmpeg assembly to the chosen aspect ratio + watermark-free MP4 export
  (ZORO AI adds no overlay; provider-added watermarks are never stripped).
- File-based project storage (`./data`), media served via `/api/media/*`.
- Tests: `npm test` (planner, SRT, honesty/schema guards).

## What is NOT free / needs setup

| Feature | Cost / requirement |
|---|---|
| Storyboard, characters, stills, voice, SRT, UI | Free |
| Character reference images (Pollinations) | Free anonymous tier, rate-limited; may watermark unless registered |
| Real AI video (Replicate) | **PAID** — billed by Replicate. Never runs without your key + model ID |
| Real AI video (Hugging Face) | Token + possible account billing; verify model pricing |
| MP4 rendering/assembly | Requires FFmpeg (free, local install) |

## Run on Windows 10 (exact steps)

Target machine: Windows 10, i3 7th gen, 8 GB RAM, no dedicated GPU.
This setup runs the **full free pipeline** locally (AI stills + motion + voice + MP4).

1. Install Node.js 20 LTS from https://nodejs.org (check “Add to PATH”).
2. Install FFmpeg (required for any MP4 rendering/export):
   - `winget install Gyan.FFmpeg`
   - Close and reopen the terminal, then verify: `ffmpeg -version`
   - Alternative: download from https://ffmpeg.org/download.html and add its `bin` folder to PATH.
2b. Install the free offline voice (for narration without any key):
   - `winget install eSpeak-NG.eSpeak-NG`
   - Verify: `espeak-ng --version`
3. Open a terminal in this folder:
   ```powershell
   npm install
   Copy-Item .env.example .env.local
   npm run dev
   ```
4. Open http://localhost:3000
5. (Optional, paid) Real video via Replicate — edit `.env.local`:
   ```
   REPLICATE_API_TOKEN=r8_your_token_here
   REPLICATE_VIDEO_MODEL=owner/model-name   # copy the EXACT id from the model's replicate.com page
   PUBLIC_BASE_URL=http://localhost:3000    # lets the provider fetch approved reference stills
   ```
   Restart `npm run dev`. Verify pricing on the model's page before generating —
   the app shows a PAID warning and sends nothing until you press Generate.

## Troubleshooting (Windows)

- `ffmpeg is not recognized` → PATH not updated: reopen terminal; run
  `where ffmpeg`. Reinstall via winget if missing.
- `npm install` slow/fails → use Node 20 LTS (not 24+), delete `node_modules`
  and retry: `npm cache clean --force; npm install`.
- Port 3000 busy → `npm run dev -- -p 3001`.
- Clip render fails with “FFmpeg was not found” → install FFmpeg (above); storyboard
  and characters are saved, just press Generate again.
- Replicate 401/404 → wrong token or model ID; copy the exact model id from its
  replicate.com page (format `owner/name` or `owner/name:version-id`).
- Out of disk → delete old projects from the dashboard (removes their clips), or
  clear `data/media/exports`.

## Project structure

```
app/page.tsx                    Dashboard
app/projects/[id]/page.tsx      Studio (prompt → characters → scenes → narration → export)
app/api/projects/...           CRUD, plan, characters, generate, assemble, narration
app/api/jobs/[jobId]            Live job polling
app/api/providers               Provider + FFmpeg + planner status
app/api/media/[...path]         Project-local media files
lib/planner.ts                  Offline (+optional LLM) storyboard planner
lib/providers.ts                Provider adapters (slideshow / replicate / HF)
lib/ffmpeg.ts                   Concat/normalize/SRT/assembly
lib/store.ts                    JSON file storage (SQLite-suitable later)
lib/validate.ts                 zod schemas + prompt sanitizing
tests/                          vitest suite
```

## Production notes (not done for you)

- Single-user file storage; for multi-user: Postgres + object storage + auth
  (e.g. Auth.js), per-user project ownership, signed media URLs, rate limiting.
- Never commit `.env.local`. Secrets stay server-side (`process.env` in routes only).
- Long generations need a real job queue/worker (e.g. BullMQ/Redis or a GPU
  worker host) — the file-poll design here is for local use.

## Scripts

- `npm run dev` — local server
- `npm test` — vitest suite
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` / `npm start` — production build/serve

## Push to GitHub (exact steps)

GitHub Desktop is already installed on this PC (it also gives you Git).

1. Create an **empty** repository on https://github.com/new (no README, no .gitignore).
2. In GitHub Desktop: **File → Add local repository →** choose `C:\Users\rafid\zoro-ai`.
3. **Publish repository** → sign in with your GitHub account → Publish. Done —
   code, tests and docs go up; your videos/secrets never do (`.gitignore`
   excludes `data/`, `.env.local`, `node_modules`, `.next`).

Command-line alternative (repo-local git, no global config touched):

```powershell
cd C:\Users\rafid\zoro-ai
git remote add origin https://github.com/YOURNAME/zoro-ai.git
git push -u origin main
```

## Deploy — read this first

ZORO AI renders video with **long FFmpeg jobs + local files**. That decides hosting:

| Host | Works? | Notes |
|---|---|---|
| **VPS with Docker (recommended)** — Hetzner, Contabo, DigitalOcean, Render (Docker), Railway, Fly.io | ✅ Full features | Build with the included `Dockerfile` (FFmpeg + voice included). Mount a volume at `/app/data` so projects survive restarts. Set `ZORO_DATA_DIR=/app/data`. |
| **Render / Railway (Node service)** | ✅ with setup | Use `npm run build` + `npm start`; add an FFmpeg buildpack or Dockerfile; attach a disk for `data/`. |
| **Vercel / Netlify (serverless)** | ⚠️ Demo only | No FFmpeg binary, ~60s function timeouts (kills renders), filesystem is ephemeral (the app auto-falls back to `/tmp`, but projects vanish on redeploy). Storyboard/characters UI works; exports don't. Not recommended for real use. |

Docker deploy (any VPS with Docker):

```bash
docker build -t zoro-ai .
docker run -d -p 3000:3000 -v zoro-data:/app/data --env-file .env.local --name zoro-ai zoro-ai
```

Then open `http://YOUR-SERVER-IP:3000`. For paid Replicate video on a server,
set `PUBLIC_BASE_URL=https://your-domain` so the provider can fetch reference stills.
