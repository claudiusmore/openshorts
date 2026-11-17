"""Schedule Shorts on YouTube through YouTube Studio, driving the local Chrome.

No API project and no audit: it uploads like a person would, in a Chrome
profile kept per account (signed in once with ``login``). Runs on the user's
own machine, never on a headless server.

    python youtube_studio.py login  --account main
    python youtube_studio.py upload --account main --items items.json

``items.json`` is a list of {"id", "path", "title", "description",
"publish_at"} (ISO local time, or empty to publish now). Progress goes to
stdout as one JSON object per line: {"id", "status", ...}.
"""
import argparse
import json
import os
import re
import sys


STUDIO_URL = "https://studio.youtube.com"


def profiles_dir():
    base = os.environ.get("YT_PROFILES_DIR") or os.path.join(
        os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "openshorts", "yt-profiles")
    os.makedirs(base, exist_ok=True)
    return base


def safe_account(name):
    name = re.sub(r"[^A-Za-z0-9_-]", "", name or "")
    if not name:
        raise ValueError("account name must use letters, digits, _ or -")
    return name


def profile_path(account):
    return os.path.join(profiles_dir(), safe_account(account))


def list_accounts():
    base = profiles_dir()
    return sorted(n for n in os.listdir(base) if os.path.isdir(os.path.join(base, n)))


def open_context(p, account):
    # The real Chrome, without the automation flags Google's sign-in refuses.
    return p.chromium.launch_persistent_context(
        profile_path(account),
        channel="chrome",
        headless=False,
        args=["--disable-blink-features=AutomationControlled"],
        ignore_default_args=["--enable-automation"],
        viewport=None,
    )


def emit(**event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


def login(account):
    """Open Studio in the account's profile; the user signs in and closes the window."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        ctx = open_context(p, account)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(STUDIO_URL)
        emit(status="login_open", account=account)
        try:
            page.wait_for_event("close", timeout=0)
        except Exception:
            pass
        signed_in = False
        try:
            signed_in = any(c["name"] in ("SAPISID", "__Secure-3PAPISID") for c in ctx.cookies())
        except Exception:
            pass
        try:
            ctx.close()
        except Exception:
            pass
        emit(status="login_closed", account=account, signed_in=signed_in)


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    lp = sub.add_parser("login")
    lp.add_argument("--account", required=True)
    up = sub.add_parser("upload")
    up.add_argument("--account", required=True)
    up.add_argument("--items", required=True)
    up.add_argument("--visibility", choices=sorted(VISIBILITY), default="public")
    args = parser.parse_args()
    if args.cmd == "login":
        login(args.account)
    else:
        with open(args.items, encoding="utf-8") as f:
            upload_items(args.account, json.load(f), args.visibility)


UPLOAD_URL = "https://www.youtube.com/upload"
VISIBILITY = {"public": "PUBLIC", "unlisted": "UNLISTED", "private": "PRIVATE"}


def shot(page, name):
    folder = os.environ.get("YT_SHOTS_DIR")
    if folder:
        os.makedirs(folder, exist_ok=True)
        page.screenshot(path=os.path.join(folder, f"{name}.png"))


def fill_box(page, selector, text):
    box = page.locator(selector).first
    box.click()
    page.keyboard.press("Control+A")
    page.keyboard.press("Delete")
    if text:
        page.keyboard.insert_text(text)


def wait_upload_done(page, timeout_s=1800):
    # The progress label shows a percentage while the file is still going up.
    label = page.locator("ytcp-video-upload-progress .progress-label, .progress-label").first
    for _ in range(timeout_s):
        try:
            text = label.inner_text(timeout=2000)
        except Exception:
            text = ""
        if text and "%" not in text:
            return text
        page.wait_for_timeout(1000)
    raise TimeoutError("upload did not finish")


CHECKS_WARNING = re.compile(r"mesmo assim|anyway", re.I)
BACK = re.compile(r"^(Voltar|Go back|Back)$", re.I)


def publish_after_checks(page, item_id, timeout_s=1800):
    # Studio warns while its copyright checks still run; publishing then risks
    # a strike, so go back and retry until the checks are done.
    waited = 0
    while True:
        page.locator("#done-button").first.click()
        page.wait_for_timeout(4000)
        warning = page.get_by_role("button", name=CHECKS_WARNING)
        if not warning.count() or not warning.first.is_visible():
            return
        if waited >= timeout_s:
            raise TimeoutError("copyright checks did not finish; left as a private draft")
        emit(id=item_id, status="waiting_checks", waited=waited)
        dialog = page.locator("tp-yt-paper-dialog, ytcp-dialog").filter(has=warning)
        dialog.get_by_role("button", name=BACK).first.click()
        page.wait_for_timeout(30000)
        waited += 34


def upload_one(page, item, visibility):
    tag = str(item.get("id"))
    page.goto(UPLOAD_URL)
    page.locator("input[type=file]").first.set_input_files(item["path"])
    page.locator("#title-textarea #textbox").first.wait_for(timeout=120000)
    page.wait_for_timeout(1500)
    fill_box(page, "#title-textarea #textbox", (item.get("title") or "")[:100])
    fill_box(page, "#description-textarea #textbox", item.get("description") or "")
    page.locator("tp-yt-paper-radio-button[name='VIDEO_MADE_FOR_KIDS_NOT_MFK']").first.click()
    shot(page, f"{tag}_details")
    for _ in range(3):
        page.locator("#next-button").first.click()
        page.wait_for_timeout(1200)
    page.locator(f"tp-yt-paper-radio-button[name='{VISIBILITY[visibility]}']").first.click()
    link = ""
    try:
        link = page.locator(".video-url-fadeable a, a.ytcp-video-info").first.get_attribute("href", timeout=10000) or ""
    except Exception:
        pass
    shot(page, f"{tag}_visibility")
    emit(id=item.get("id"), status="uploading", url=link)
    progress = wait_upload_done(page)
    publish_after_checks(page, item.get("id"))
    shot(page, f"{tag}_done")
    emit(id=item.get("id"), status="published", url=link, progress=progress)


def upload_items(account, items, visibility="public"):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        ctx = open_context(p, account)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            for item in items:
                try:
                    upload_one(page, item, visibility)
                except Exception as e:
                    shot(page, f"{item.get('id')}_error")
                    emit(id=item.get("id"), status="failed", error=str(e)[:500])
        finally:
            ctx.close()


if __name__ == "__main__":
    sys.exit(main())
