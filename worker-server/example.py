"""
ZORO AI reference worker — YOUR model, YOUR hardware, zero third parties.

Runs ANY Hugging Face image model you choose (default: a tiny CPU-friendly one)
behind the exact contract ZORO AI expects:

  POST /v1/generate  { kind, prompt, negativePrompt?, width, height,
                       durationSec?, seed?, referenceImageDataUrl? } -> { jobId }
  GET  /v1/jobs/{jobId} -> { status, outputUrl?, error? }
  GET  /v1/files/{name} -> the image file

Honest limits of THIS example file:
- "still" jobs: real inference with YOUR model via diffusers (CPU ok, slow).
- "clip" jobs: HTTP 400 with a clear message — wire YOUR video model
  (e.g. Stable Video Diffusion / AnimateDiff on a CUDA GPU) into make_clip().

Setup (Windows):
  cd worker-server
  python -m venv .venv
  .venv\\Scripts\\activate
  pip install -r requirements.txt
  pip install torch --index-url https://download.pytorch.org/whl/cpu
  pip install diffusers transformers accelerate safetensors pillow
  set SD_MODEL=segmind/tiny-sd
  uvicorn example:app --host 127.0.0.1 --port 8188

Then in ZORO AI .env.local:  WORKER_URL=http://127.0.0.1:8188
and pick provider "Your own model server". No account, no key, no middleman.
"""

import base64
import io
import os
import threading
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from PIL import Image

OUT = Path(__file__).parent / "outputs"
OUT.mkdir(exist_ok=True)

app = FastAPI(title="ZORO AI own-model worker")

JOBS: dict = {}
PIPE = None
PIPE_LOCK = threading.Lock()


class GenerateIn(BaseModel):
    kind: str = Field(pattern="^(still|clip)$")
    prompt: str = Field(min_length=1, max_length=4000)
    negativePrompt: str = ""
    width: int = 768
    height: int = 1344
    durationSec: int = 5
    seed: int = 0
    referenceImageDataUrl: str | None = None


def get_pipe():
    """Lazily load YOUR model once. Raises with install help if torch is missing."""
    global PIPE
    if PIPE is not None:
        return PIPE
    try:
        import torch  # noqa: F401
        from diffusers import AutoPipelineForText2Image
    except ImportError:
        raise RuntimeError(
            "torch/diffusers are not installed in this worker. Run: "
            "pip install torch --index-url https://download.pytorch.org/whl/cpu "
            "&& pip install diffusers transformers accelerate safetensors pillow"
        )
    model = os.environ.get("SD_MODEL", "segmind/tiny-sd")
    use_cuda = False
    try:
        import torch

        use_cuda = torch.cuda.is_available()
    except Exception:
        pass
    if use_cuda:
        import torch

        pipe = AutoPipelineForText2Image.from_pretrained(model)
        pipe.to("cuda")
    else:
        # CPU needs float32 (float16 fails with dtype errors) — slower but works.
        import torch

        pipe = AutoPipelineForText2Image.from_pretrained(model, torch_dtype=torch.float32)
        pipe.to("cpu")
    PIPE = pipe
    return pipe


def make_still(job_id: str, data: GenerateIn):
    JOBS[job_id]["status"] = "processing"
    try:
        import torch

        pipe = get_pipe()
        w = max(64, min(1024, 8 * round(data.width / 8)))
        h = max(64, min(1024, 8 * round(data.height / 8)))
        steps = int(os.environ.get("SD_STEPS", "4" if "turbo" in os.environ.get("SD_MODEL", "") else ("15" if "tiny" in os.environ.get("SD_MODEL", "") else "20")))
        gen = torch.Generator().manual_seed(data.seed or 0)
        with PIPE_LOCK:  # one inference at a time on small hardware
            img = pipe(prompt=data.prompt, negative_prompt=data.negativePrompt or None,
                       width=w, height=h, num_inference_steps=steps, generator=gen).images[0]
        # Reference image: this example archives it; YOUR model can do img2img/control here.
        if data.referenceImageDataUrl:
            try:
                _head, b64 = data.referenceImageDataUrl.split(",", 1)
                ref = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
                ref.thumbnail((256, 256))
                ref.save(OUT / f"{job_id}_ref.jpg")
            except Exception:
                pass
        out = OUT / f"{job_id}.jpg"
        img.save(out)
        JOBS[job_id].update(status="succeeded", outputUrl=f"/v1/files/{job_id}.jpg")
    except Exception as e:  # never fake success
        JOBS[job_id].update(status="failed", error=str(e)[:500])


@app.post("/v1/generate", status_code=201)
def generate(body: GenerateIn):
    if body.kind == "clip":
        raise HTTPException(
            status_code=400,
            detail="This example worker does text-to-image only. Extend make_clip() with YOUR video model (GPU recommended), then retry.",
        )
    job_id = uuid.uuid4().hex[:12]
    JOBS[job_id] = {"status": "queued", "createdAt": time.time()}
    threading.Thread(target=make_still, args=(job_id, body), daemon=True).start()
    return {"jobId": job_id}


@app.get("/v1/jobs/{job_id}")
def status(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown jobId.")
    out = {"status": job["status"]}
    if job.get("outputUrl"):
        out["outputUrl"] = job["outputUrl"]
    if job.get("error"):
        out["error"] = job["error"]
    return out


@app.get("/v1/files/{name}")
def files(name: str):
    p = (OUT / name).resolve()
    if not str(p).startswith(str(OUT.resolve())) or not p.is_file():
        raise HTTPException(status_code=404, detail="Not found.")
    return FileResponse(p)
