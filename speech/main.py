"""Readback speech worker: one Runpod Serverless queue endpoint on a GPU.
task="tts"        controller text -> radio-filtered WAV (Kokoro)
task="transcribe" pilot WAV       -> transcript (Whisper fine-tuned for ATC)
task="ping"       warm-up / health check; loads the models
Every Runpod-specific line is tagged `# RUNPOD:`."""
import base64
import io
import os
import wave

import numpy as np
import runpod
from scipy.signal import butter, sosfilt

# RUNPOD STEP 1 — one App = one `rp flash deploy speech/`
app = runpod.App("readback-speech")  # RUNPOD: app name used by deploy/undeploy

# RUNPOD STEP 2 — declare the model so Runpod stages weights on the host before a worker starts
WHISPER = runpod.Model("jacktol/whisper-large-v3-finetuned-for-ATC")  # RUNPOD: cold start skips the download

_models: dict = {}  # filled on first job, reused by later jobs on the same warm worker
_load_count = 0  # how many times this worker filled _models; stays 1 while warm

# RUNPOD STEP 3 — describe the GPU worker; no Dockerfile
# RUNPOD: deploy vendors requirements.txt with pip. Without --no-deps, kokoro and accelerate
# pull a second torch into the artifact, and it shadows the image's CUDA build.
os.environ.setdefault("PIP_NO_DEPS", "1")


@app.queue(
    gpu=runpod.GpuGroup.ADA_24,  # RUNPOD: 24 GB Ada pool (RTX 4090) avoids waiting on one SKU
    workers=(0, 1),  # RUNPOD: zero workers when idle = zero GPU cost
    idle_timeout=300,  # RUNPOD: stay warm 5 min across a practice session
    execution_timeout_ms=60_000,  # RUNPOD: hard cap per job
    model=WHISPER,  # RUNPOD: weights mounted read-only at WHISPER.path
    dependencies=[  # RUNPOD: pinned, same as the top block of requirements.txt; torch comes with the image
        "transformers==5.20.2",
        "accelerate==1.15.0",
        "kokoro==0.9.4",
        "scipy==1.18.1",
        "numpy==2.5.4",
        "en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl",
    ],
)
# RUNPOD STEP 4 — the job's `input` dict arrives as keyword arguments
def speech(task: str, text: str = "", audio_wav_b64: str = "", radio_effect: bool = True) -> dict:
    models = _load_models(str(WHISPER.path))  # RUNPOD: where Runpod staged the Whisper weights
    if task == "ping":
        return {"ok": True, "gpu": models["gpu"], "models_loaded": True, "load_count": _load_count}
    if task == "tts":
        return _tts(models["tts"], text, radio_effect)
    if task == "transcribe":
        return _transcribe(models["asr"], audio_wav_b64)
    raise ValueError(f"unknown task: {task}")  # RUNPOD: surfaces as status FAILED in the JS client


# ---- No Runpod below this line ----

WHISPER_NAME = "jacktol/whisper-large-v3-finetuned-for-ATC"
KOKORO_REPO = "hexgrad/Kokoro-82M"
VOICE = "am_michael"  # Kokoro American English male voice
TTS_RATE = 24_000  # Kokoro's output sample rate
ASR_RATE = 16_000  # Whisper's input sample rate
MAX_TEXT = 600


def _load_models(whisper_path: str) -> dict:
    global _load_count
    if _models:
        return _models
    # Heavy imports stay inside the function so pytest needs only numpy and scipy.
    import torch
    from kokoro import KPipeline
    from transformers import pipeline

    tts = KPipeline(lang_code="a", repo_id=KOKORO_REPO, device="cuda")  # downloads ~330 MB once
    if tts.g2p.fallback is None:
        raise RuntimeError("espeak-ng fallback failed to load; Kokoro would skip unknown words")
    asr = pipeline(
        "automatic-speech-recognition",
        model=whisper_path,
        dtype=torch.float16,
        device="cuda:0",
        generate_kwargs={"language": "en", "task": "transcribe"},
    )
    _models.update(gpu=torch.cuda.get_device_name(0), tts=tts, asr=asr)
    _load_count += 1
    return _models


def _tts(tts, text: str, radio_effect: bool) -> dict:
    text = text.strip()
    if not text or len(text) > MAX_TEXT:
        raise ValueError(f"text must be 1-{MAX_TEXT} characters, got {len(text)}")
    chunks = [r.audio.cpu().numpy() for r in tts(text, voice=VOICE) if r.audio is not None]
    if not chunks:
        raise ValueError("Kokoro produced no audio for this text")
    samples = (np.clip(np.concatenate(chunks), -1, 1) * 32_767).astype(np.int16)
    if radio_effect:
        samples = radio_filter(samples, TTS_RATE)
    return {
        "audio_wav_b64": base64.b64encode(_wav_bytes(samples, TTS_RATE)).decode("ascii"),
        "sample_rate": TTS_RATE,
        "duration_s": round(len(samples) / TTS_RATE, 2),
    }


def _transcribe(asr, audio_wav_b64: str) -> dict:
    samples = validate_wav(base64.b64decode(audio_wav_b64, validate=True))
    result = asr({"raw": samples.astype(np.float32) / 32_768, "sampling_rate": ASR_RATE})
    return {
        "transcript": result["text"].strip(),
        "duration_s": round(len(samples) / ASR_RATE, 2),
        "model": WHISPER_NAME,
    }


def validate_wav(data: bytes) -> np.ndarray:
    """Return the int16 samples of a 16 kHz mono 16-bit PCM WAV of 0.5-30 s.

    Raises ValueError naming the first problem found."""
    try:
        with wave.open(io.BytesIO(data)) as w:
            channels, width, rate = w.getnchannels(), w.getsampwidth(), w.getframerate()
            frames = w.readframes(w.getnframes())
    except (wave.Error, EOFError) as e:
        raise ValueError(f"audio must be a RIFF/WAVE PCM file: {e}") from e
    if channels != 1:
        raise ValueError(f"audio must be mono, got {channels} channels")
    if width != 2:
        raise ValueError(f"audio must be 16-bit PCM, got {width * 8}-bit")
    if rate != ASR_RATE:
        raise ValueError(f"audio must be {ASR_RATE} Hz, got {rate} Hz")
    samples = np.frombuffer(frames, dtype="<i2")
    seconds = len(samples) / ASR_RATE
    if not 0.5 <= seconds <= 30:
        raise ValueError(f"audio must be 0.5-30 s long, got {seconds:.2f} s")
    return samples


def radio_filter(samples: np.ndarray, rate: int) -> np.ndarray:
    """Make int16 speech sound like VHF radio: hiss, 300-3,000 Hz band, soft clipping."""
    x = samples.astype(np.float64) / 32_768
    rms = np.sqrt(np.mean(x**2)) or 1e-3
    hiss = np.random.default_rng(0).normal(0, rms * 10 ** (-30 / 20), len(x))  # about -30 dB
    band = butter(4, [300, 3_000], btype="bandpass", fs=rate, output="sos")
    y = sosfilt(band, x + hiss)
    drive = 2.0
    y = np.tanh(drive * y) / np.tanh(drive)
    return (np.clip(y, -1, 1) * 32_767).astype(np.int16)


def _wav_bytes(samples: np.ndarray, rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples.astype("<i2").tobytes())
    return buf.getvalue()
