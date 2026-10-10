# Your own model server (no dependence on anyone)

ZORO AI talks to YOUR hardware through two plain endpoints. Any program that
answers them — Python, Node, ComfyUI wrapper, a GPU box in another city —
becomes your private image/video backend.

## The contract

Base URL = `WORKER_URL` (e.g. `http://127.0.0.1:8188`).

- `POST /v1/generate` with
  `{ kind: "still"|"clip", prompt, negativePrompt?, width, height,
    durationSec?, seed?, referenceImageDataUrl? }`
  returns `201 { jobId }`.
- `GET /v1/jobs/{jobId}` returns
  `{ status: "queued"|"processing"|"succeeded"|"failed"|"cancelled",
    outputUrl?, error? }`.
- `outputUrl` must be directly downloadable (jpg/png/mp4/webm).

That is the whole contract. `example.py` in this folder implements it.

## Run the example (Windows, CPU ok)

```powershell
cd worker-server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install diffusers transformers accelerate safetensors
set SD_MODEL=segmind/tiny-sd
uvicorn example:app --host 127.0.0.1 --port 8188
```

Then in ZORO AI `.env.local`:

```
WORKER_URL=http://127.0.0.1:8188
```

Restart ZORO AI, pick provider **"Your own model server"**, generate.
Stills come from YOUR model. No account, no key, no per-image fee, no data
leaving your machines (unless you host the worker elsewhere — your choice).

## Reality notes (no sugar-coating)

- CPU image inference is SLOW (minutes per still on an i3) — that is physics,
  not a bug. A CUDA GPU makes it 10–50x faster. Same code, both cases.
- `SD_MODEL` can be any Diffusers text-to-image model you have rights to use.
  Bigger models need more RAM/VRAM — `segmind/tiny-sd` fits small PCs.
- `example.py` does **stills only**. For `clip` jobs it answers HTTP 400 and
  tells you exactly where to plug YOUR video model (`make_clip()`), because
  inventing a fake video endpoint would be lying.
- Reference images arrive as data URLs — use them for img2img / ControlNet /
  IP-Adapter in your own pipeline; the example only archives them.
