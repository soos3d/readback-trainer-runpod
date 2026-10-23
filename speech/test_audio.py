"""CPU tests for the worker's WAV handling. Run: .venv/bin/pytest -q test_audio.py"""
import io
import wave
from pathlib import Path

import numpy as np
import pytest

from main import radio_filter, validate_wav

HERE = Path(__file__).parent


def make_wav(rate=16_000, channels=1, width=2, seconds=2.0) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(b"\x00" * int(rate * seconds) * channels * width)
    return buf.getvalue()


def test_valid_wav_passes():
    samples = validate_wav(make_wav())
    assert samples.dtype == np.int16
    assert len(samples) == 32_000


@pytest.mark.parametrize(
    ("wav", "problem"),
    [
        (make_wav(rate=44_100), "16000 Hz"),
        (make_wav(channels=2), "mono"),
        (make_wav(width=1), "16-bit"),
        (make_wav(seconds=0.3), "0.30 s"),
        (make_wav(seconds=31), "31.00 s"),
        (b"ID3 this is an mp3" + b"\x00" * 64, "RIFF/WAVE"),
    ],
    ids=["44.1kHz", "stereo", "8-bit", "0.3s", "31s", "non-RIFF"],
)
def test_bad_wav_raises_naming_the_problem(wav, problem):
    with pytest.raises(ValueError, match=problem):
        validate_wav(wav)


def band_energy(x: np.ndarray, rate: int, hi_hz: float) -> float:
    spectrum = np.abs(np.fft.rfft(x.astype(np.float64))) ** 2
    freqs = np.fft.rfftfreq(len(x), 1 / rate)
    return float(spectrum[freqs < hi_hz].sum())


def test_radio_filter_keeps_shape_and_cuts_lows():
    rate = 24_000
    t = np.arange(rate) / rate
    tone = 0.4 * np.sin(2 * np.pi * 100 * t) + 0.4 * np.sin(2 * np.pi * 1_000 * t)
    audio = (tone * 32_767).astype(np.int16)
    out = radio_filter(audio, rate)
    assert out.shape == audio.shape
    assert out.dtype == np.int16
    drop_db = 10 * np.log10(band_energy(audio, rate, 200) / band_energy(out, rate, 200))
    assert drop_db > 20


def test_requirements_head_matches_decorator():
    head = HERE.joinpath("requirements.txt").read_text().split("\n\n")[0].splitlines()
    pins = [line for line in head if not line.startswith("#")]
    source = HERE.joinpath("main.py").read_text()
    assert pins, "requirements.txt has no direct pins"
    assert all(f'"{pin}"' in source for pin in pins)
