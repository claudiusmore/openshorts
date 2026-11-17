"""Posting queue for YouTube Studio uploads (youtube_studio.py).

Each item is one clip with its own publish time; a single worker uploads the
due items one by one (the Chrome profile cannot be opened twice). The queue
lives in a JSON file outside the job dirs so the retention sweep never
touches it. Uploads happen at publish time, so the PC and the server must be
on: an item that comes due while they are off goes out as soon as they are
back.
"""
import asyncio
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import uuid

from jsonfile import write_json_atomic
import youtube_studio

VISIBILITIES = ("public", "unlisted", "private")
ACTIVE = ("uploading", "waiting_checks")
_lock = threading.Lock()


def queue_path():
    return os.environ.get("YT_QUEUE_FILE") or os.path.join(
        os.path.dirname(youtube_studio.profiles_dir()), "youtube_queue.json")


def load():
    try:
        with open(queue_path(), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return []


def _save(items):
    write_json_atomic(queue_path(), items, indent=2)


def update(item_id, **fields):
    with _lock:
        items = load()
        for it in items:
            if it["id"] == item_id:
                it.update(fields, updated_at=time.time())
        _save(items)


def add(entries):
    """entries: dicts with job_id, clip_index, title, description, account,
    visibility, publish_at (epoch seconds)."""
    now = time.time()
    new = [{**e, "id": uuid.uuid4().hex[:12], "status": "scheduled", "error": "",
            "created_at": now, "updated_at": now} for e in entries]
    with _lock:
        _save(load() + new)
    return new


def cancel(item_id):
    with _lock:
        items = load()
        keep = [it for it in items if not (it["id"] == item_id and it["status"] in ("scheduled", "failed"))]
        if len(keep) == len(items):
            return False
        _save(keep)
    return True


def recover():
    """An upload cut by a restart may or may not have gone out: flag it
    instead of posting it twice."""
    with _lock:
        items = load()
        for it in items:
            if it["status"] in ACTIVE:
                it.update(status="failed", error="interrupted by a restart; check YouTube Studio",
                          updated_at=time.time())
        _save(items)


def _next_due():
    now = time.time()
    due = [it for it in load() if it["status"] == "scheduled" and it["publish_at"] <= now]
    return min(due, key=lambda it: it["publish_at"]) if due else None


async def _upload(item, resolve_path):
    path = resolve_path(item["job_id"], item["clip_index"])
    if not path:
        update(item["id"], status="failed", error="clip file not found (not rendered or deleted)")
        return
    update(item["id"], status="uploading")
    # Clip names run past Windows' 260-char path limit, which Chrome cannot
    # read ("unreadable file" in Studio): upload a short-named copy.
    work = tempfile.mkdtemp(prefix="ytup_")
    short = os.path.join(work, "short.mp4")
    shutil.copyfile(path, short)
    items_file = os.path.join(work, "items.json")
    with open(items_file, "w", encoding="utf-8") as f:
        json.dump([{"id": item["id"], "path": short, "title": item["title"],
                    "description": item["description"]}], f, ensure_ascii=False)
    final = None
    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-u", "youtube_studio.py", "upload", "--account", item["account"],
            "--items", items_file, "--visibility", item["visibility"],
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            env={**os.environ, "PYTHONUTF8": "1"}, cwd=os.path.dirname(os.path.abspath(__file__)))
        tail = []
        async for raw in proc.stdout:
            line = raw.decode("utf-8", "replace").strip()
            try:
                event = json.loads(line)
            except ValueError:
                tail = (tail + [line])[-5:]
                continue
            status = event.get("status")
            if status in ("uploading", "waiting_checks", "published", "failed"):
                final = status
                update(item["id"], status=status, error=event.get("error", ""),
                       url=event.get("url") or item.get("url", ""))
        await proc.wait()
        if final not in ("published", "failed"):
            update(item["id"], status="failed",
                   error=(" | ".join(tail) or f"uploader exited with code {proc.returncode}")[-500:])
    finally:
        shutil.rmtree(work, ignore_errors=True)


async def worker(resolve_path, is_active=lambda: True):
    recover()
    while True:
        try:
            item = _next_due() if is_active() else None
            if item:
                await _upload(item, resolve_path)
                continue
        except Exception as e:
            print(f"⚠️ [youtube] worker error: {e}")
        await asyncio.sleep(15)
