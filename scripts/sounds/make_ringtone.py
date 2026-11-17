"""Synthesises AMIVARA's incoming-call ringtone (apps/mobile/assets/sounds/amivara_ringtone.mp3).

A warm, bell-like chime melody (soft FM-ish bells with a gentle echo), about
3.6 seconds, made to loop seamlessly while a call rings. Original audio, no
samples, so there's nothing to license.

Usage (from the repo root):  python scripts/sounds/make_ringtone.py
Needs numpy and ffmpeg on PATH.
"""
import pathlib
import subprocess
import tempfile
import wave

import numpy as np

RATE = 44100
LOOP_SECONDS = 3.6
OUT = pathlib.Path(__file__).resolve().parents[2] / 'apps' / 'mobile' / 'assets' / 'sounds' / 'amivara_ringtone.mp3'


def note(freq: float, start: float, length: float, gain: float, buf: np.ndarray) -> None:
    """A soft bell: a few inharmonic partials, a quick attack and an exponential decay."""
    t = np.arange(int(length * RATE)) / RATE
    partials = [(1.0, 1.0), (2.0, 0.42), (2.76, 0.22), (5.4, 0.06)]
    tone = sum(a * np.sin(2 * np.pi * freq * m * t) * np.exp(-t * (2.6 + 1.6 * m)) for m, a in partials)
    attack = np.minimum(1.0, t / 0.008)
    i = int(start * RATE)
    seg = (tone * attack * gain)[: len(buf) - i]
    buf[i : i + len(seg)] += seg


def main() -> None:
    buf = np.zeros(int(LOOP_SECONDS * RATE))
    # A rising, then answering phrase in A major (A5 C#6 E6 A6 · F#6 E6 C#6 E6), warm rather than shrill.
    phrase = [
        (880.00, 0.00, 0.55),
        (1108.73, 0.18, 0.5),
        (1318.51, 0.36, 0.5),
        (1760.00, 0.54, 0.45),
        (1479.98, 1.20, 0.42),
        (1318.51, 1.38, 0.42),
        (1108.73, 1.56, 0.42),
        (1318.51, 1.80, 0.48),
    ]
    for freq, start, gain in phrase:
        note(freq, start, 1.6, gain, buf)
        note(freq / 2, start, 1.2, gain * 0.25, buf)  # a soft lower octave for warmth
    # A gentle echo, folded back into the loop so the end flows into the start.
    echo = np.roll(buf, int(0.23 * RATE)) * 0.28
    buf = buf + echo
    # Fade the last 120 ms so the loop point never clicks.
    fade = int(0.12 * RATE)
    buf[-fade:] *= np.linspace(1, 0, fade)
    buf /= np.max(np.abs(buf)) / 0.7

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav = pathlib.Path(tmp) / 'ring.wav'
        with wave.open(str(wav), 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes((buf * 32767).astype('<i2').tobytes())
        subprocess.run(
            ['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav), '-codec:a', 'libmp3lame', '-b:a', '96k', str(OUT)],
            check=True,
        )
    print(f'Wrote {OUT} ({OUT.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
