"""Rewrite a clip's texts (hook, title, descriptions, why, score) from what is
said inside its cut, for when the cut changed or the clip was made by hand."""
import os
from typing import Optional

from pydantic import BaseModel

import llm_backend


class ClipTexts(BaseModel):
    viral_hook_text: str
    video_title_for_youtube_short: str
    video_description_for_tiktok: str
    video_description_for_instagram: str
    why: str
    predicted_score: int


PROMPT = """You write the texts for ONE short-form video clip (TikTok / Reels / YouTube Shorts) cut from a longer video.
Base everything ONLY on what is said inside the clip. Write in the SAME LANGUAGE AS THE CLIP TRANSCRIPT.

SOURCE VIDEO: {video_title}
CLIP: {start:.1f}s to {end:.1f}s ({length:.0f}s long)

CLIP TRANSCRIPT:
{text}

Return ONLY a JSON object with:
- "viral_hook_text": SHORT punchy text overlay (max 10 words) with 1-2 fitting emojis, shown in the first seconds.
- "video_title_for_youtube_short": title for the YouTube Short oriented to get views, 100 chars max; it must match what the clip actually says.
- "video_description_for_tiktok": description for TikTok oriented to get views, with a few hashtags.
- "video_description_for_instagram": description for Instagram oriented to get views, with a few hashtags.
- "why": one or two sentences on why this clip can perform well (hook, payoff, emotion).
- "predicted_score": integer 0-100, how likely the clip is to perform well on its own.
"""


def clip_transcript(segments, start, end):
    """Words spoken inside [start, end] (word timings when available)."""
    out = []
    for seg in segments or []:
        words = seg.get('words') or []
        if words:
            out += [w['word'].strip() for w in words
                    if float(w['end']) > start and float(w['start']) < end]
        elif float(seg.get('end', 0)) > start and float(seg.get('start', 0)) < end:
            out.append((seg.get('text') or '').strip())
    return " ".join(t for t in out if t)


def generate(segments, start, end, video_title="", gemini_key: Optional[str] = None,
             spans=None) -> dict:
    """spans: the cut's (start, end) pieces in order, when it has more than
    one or differs from start/end."""
    spans = spans or [(start, end)]
    text = " ".join(t for t in (clip_transcript(segments, s, e) for s, e in spans) if t)
    if not text:
        raise ValueError("Nothing is said inside this cut")
    prompt = PROMPT.format(video_title=video_title or "-", start=spans[0][0], end=spans[-1][1],
                           length=sum(e - s for s, e in spans), text=text)
    if llm_backend.active():
        data, _ = llm_backend.generate_json(prompt, ClipTexts)
    else:
        if not gemini_key:
            raise ValueError("No AI configured: add a Gemini API key")
        from google import genai
        from google.genai import types as genai_types
        import gemini_worker
        client = genai.Client(api_key=gemini_key)
        response = client.models.generate_content(
            model=os.environ.get("GEMINI_MODEL") or 'gemini-3.1-flash-lite', contents=prompt,
            config=genai_types.GenerateContentConfig(response_mime_type="application/json",
                                                     response_schema=ClipTexts))
        gemini_worker.raise_if_blocked(response)
        data = gemini_worker._parse_json_response_text(gemini_worker._get_response_text(response))
    texts = ClipTexts(**data).model_dump()
    texts['video_title_for_youtube_short'] = texts['video_title_for_youtube_short'].strip()[:100]
    texts['predicted_score'] = max(0, min(100, int(texts['predicted_score'])))
    return texts
