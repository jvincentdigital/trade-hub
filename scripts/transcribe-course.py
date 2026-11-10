# Transcribe the Market Maker / Marvel FX course videos with timestamps.
# Usage: ~/.local/share/media-tools/.venv/bin/python -I scripts/transcribe-course.py <videos_root> <out_dir>
# Skips videos already transcribed, so re-running is safe.
import sys, pathlib, time, subprocess
import numpy as np
from faster_whisper import WhisperModel

FFMPEG = str(pathlib.Path.home() / '.local/bin/ffmpeg')

def load_audio(path):
    # Decode with ffmpeg (this faster-whisper/PyAV pair is incompatible).
    raw = subprocess.run([FFMPEG, '-nostdin', '-i', str(path), '-f', 's16le', '-ac', '1', '-ar', '16000', '-loglevel', 'error', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0
root, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
order = {'teoria': 0, 'Lo demas': 1, 'practica': 2}
vids = sorted(root.rglob('*.mp4'), key=lambda p: (order.get(p.parent.name, 9), p.name))
model = WhisperModel('small', device='cpu', compute_type='int8', cpu_threads=8)
prog = out / '_progress.md'
done = []
for v in vids:
    name = f"{v.parent.name} - {v.stem.strip() or 'sin titulo'}".replace('/', '-')
    dest = out / f"{name}.txt"
    if dest.exists() and dest.stat().st_size > 0:
        done.append(name); continue
    prog.write_text(f"# Transcription (Mac Mini)\nUpdated {time.strftime('%H:%M')}\nDone {len(done)}/{len(vids)}\nNow: {name}\n")
    t0 = time.time()
    try:
        segs, info = model.transcribe(load_audio(v), language='es', vad_filter=True, beam_size=1)
        lines = [f"# {name}\n# source: {v.relative_to(root)}\n"]
        for s in segs:
            m, sec = divmod(int(s.start), 60)
            lines.append(f"[{m:02d}:{sec:02d}] {s.text.strip()}")
        tmp = dest.with_suffix('.part')
        tmp.write_text('\n'.join(lines) + '\n')
        tmp.rename(dest)
        done.append(name)
        print(f"done {name} in {time.time()-t0:.0f}s ({info.duration/60:.0f} min audio)", flush=True)
    except Exception as e:
        print(f"FAIL {name}: {e}", flush=True)
prog.write_text(f"# Transcription (Mac Mini)\nFinished {time.strftime('%H:%M')}\nDone {len(done)}/{len(vids)}\n")
