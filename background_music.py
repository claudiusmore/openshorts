"""Background music under a clip's speech.

The track loops to the clip length, fades in and out, and is ducked by the
speech itself (sidechain compression): it drops while someone talks and comes
back up in the pauses, so it never fights the voice. Mixed into the canonical
clip right after the reframe, so the hook, captions and later re-renders all
inherit it.
"""
import os
import subprocess

ALLOWED_EXTENSIONS = (".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac")
DEFAULT_VOLUME = 0.15
FADE_IN = 1.0
FADE_OUT = 1.5


def clamp_volume(value, default=DEFAULT_VOLUME):
    """Volume as a 0.01-1.0 gain; accepts a fraction or a percentage."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    if v > 1.0:
        v = v / 100.0
    return min(max(v, 0.01), 1.0)


def _probe(path, entries):
    out = subprocess.run(
        ["ffprobe", "-v", "error", *entries, "-of", "csv=p=0", path],
        capture_output=True, text=True, timeout=60)
    return out.stdout.strip()


def build_filter(duration, volume, has_voice=True):
    """ffmpeg filter graph: input 0 = clip, input 1 = (looped) music."""
    fade_out_at = max(0.0, duration - FADE_OUT)
    # Normalised first so a percentage sounds the same whatever the track's own
    # mastering; at 15 % the bed sits ~16 dB under -14 LUFS, i.e. under speech.
    music = (f"[1:a]aformat=sample_rates=48000:channel_layouts=stereo,"
             f"loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,volume={volume:.3f}")
    fades = (f"afade=t=in:st=0:d={FADE_IN},"
             f"afade=t=out:st={fade_out_at:.3f}:d={FADE_OUT}")
    if not has_voice:
        return f"{music},{fades}[out]"
    return (
        "[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[voice][key];"
        f"{music}[bed];"
        # Gentle ducking: a few dB under speech, back up in the pauses.
        "[bed][key]sidechaincompress=threshold=0.1:ratio=4:attack=20:release=500[ducked];"
        f"[ducked]{fades}[music];"
        "[voice][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]"
    )


def mix_into(video_path, music_path, volume=DEFAULT_VOLUME):
    """Mix ``music_path`` under ``video_path`` in place. Returns True on success;
    on any failure the clip is left untouched."""
    if not (music_path and os.path.exists(music_path) and os.path.exists(video_path)):
        return False
    try:
        duration = float(_probe(video_path, ["-show_entries", "format=duration"]) or 0)
        if duration <= 0:
            return False
        has_voice = bool(_probe(video_path, ["-select_streams", "a",
                                             "-show_entries", "stream=index"]))
        tmp = video_path + ".music.mp4"
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", video_path, "-stream_loop", "-1", "-i", music_path,
            "-filter_complex", build_filter(duration, clamp_volume(volume), has_voice),
            "-map", "0:v", "-map", "[out]", "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k", "-t", f"{duration:.3f}",
            "-movflags", "+faststart", tmp,
        ]
        subprocess.run(cmd, check=True, capture_output=True, timeout=600)
        os.replace(tmp, video_path)
        return True
    except Exception as e:
        print(f"   ⚠️ Background music skipped ({type(e).__name__}: {e})")
        try:
            os.remove(video_path + ".music.mp4")
        except OSError:
            pass
        return False
