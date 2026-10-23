"""Readback speech worker: one Runpod Serverless queue endpoint on a GPU.
task="ping"       warm-up / health check
(T10 adds task="tts" and task="transcribe".)
Every Runpod-specific line is tagged `# RUNPOD:`."""
import runpod

# RUNPOD STEP 1 — one App = one `rp flash deploy speech/`
app = runpod.App("readback-speech")  # RUNPOD: app name used by deploy/undeploy

# RUNPOD STEP 2 — model staging arrives in T10 (runpod.Model); the ping spike needs no weights

_models: dict = {}  # filled on first job, reused by later jobs on the same warm worker
_load_count = 0  # how many times this worker filled _models; stays 1 while warm


# RUNPOD STEP 3 — describe the GPU worker; no Dockerfile
@app.queue(
    gpu=runpod.GpuGroup.ADA_24,  # RUNPOD: 24 GB Ada pool (RTX 4090) avoids waiting on one SKU
    workers=(0, 1),  # RUNPOD: zero workers when idle = zero GPU cost
    idle_timeout=300,  # RUNPOD: stay warm 5 min across a practice session
    execution_timeout_ms=60_000,  # RUNPOD: hard cap per job
    dependencies=[],  # RUNPOD: torch ships preinstalled in the builtin GPU image
)
# RUNPOD STEP 4 — the job's `input` dict arrives as keyword arguments
def speech(task: str) -> dict:
    if task == "ping":
        return {"ok": True, "gpu": _load()["gpu"], "models_loaded": False, "load_count": _load_count}
    raise ValueError(f"unknown task: {task}")  # RUNPOD: surfaces as status FAILED in the JS client


# ---- No Runpod below this line ----


def _load() -> dict:
    global _load_count
    if not _models:
        import torch  # preinstalled on the GPU image; lazy so local imports stay light

        _models["gpu"] = torch.cuda.get_device_name(0)
        _load_count += 1
    return _models
