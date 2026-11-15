import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, Pause, Clapperboard, AlertTriangle } from 'lucide-react';
import { apiFetch, apiJson } from '../lib/api';
import { getApiUrl } from '../config';

// Review step of a job created with "review before rendering": the AI picked
// the clips but nothing was rendered yet. Each clip is previewed over the
// source video (center crop, hook and captions drawn in CSS as an
// approximation of the burned ones), its cut and texts can be edited, and only
// the approved clips go to the render.

const HOOK_LOOK = {
    pill: { background: '#fff', color: '#000' },
    classic: { background: 'rgba(255,255,255,0.94)', color: '#000', fontFamily: 'Georgia, serif' },
    dark: { background: 'rgba(18,18,20,0.92)', color: '#fff' },
    yellow: { background: '#FFD600', color: '#000' },
    red: { background: '#DC2626', color: '#fff' },
    outline: { color: '#fff', WebkitTextStroke: '1.5px #000', paintOrder: 'stroke fill' },
    outline_yellow: { color: '#FFD600', WebkitTextStroke: '1.5px #000', paintOrder: 'stroke fill' },
};

const ASPECT = { vertical: '9 / 16', auto: '9 / 16', square: '1 / 1', horizontal: '16 / 9' };

// Same limit as the burned captions (subtitles.AUTO_CAPTION_STYLE max_chars).
const CAPTION_MAX_CHARS = 16;

const fmt = (s) => {
    const n = Math.max(0, Number(s) || 0);
    const m = Math.floor(n / 60);
    return `${m}:${(n - m * 60).toFixed(1).padStart(4, '0')}`;
};

function captionChunks(words, start, end) {
    const chunks = [];
    let cur = null;
    for (const [ws, we, text] of words) {
        if (we <= start || ws >= end) continue;
        const gap = cur ? ws - cur.end : 0;
        const len = cur ? cur.text.length + 1 + text.length : text.length;
        if (!cur || len > CAPTION_MAX_CHARS || gap > 0.6) {
            cur = { start: ws, end: we, words: [], text: '' };
            chunks.push(cur);
        }
        cur.words.push([ws, we, text]);
        cur.text = cur.text ? `${cur.text} ${text}` : text;
        cur.end = we;
    }
    return chunks;
}

function spokenText(segments, start, end) {
    return segments.filter(([s, e]) => e > start && s < end).map(([, , t]) => t).join(' ');
}

const PlanReview = ({ jobId, geminiKey, onRendered }) => {
    const [plan, setPlan] = useState(null);
    const [clips, setClips] = useState([]);
    const [error, setError] = useState('');
    const [selected, setSelected] = useState(0);
    const [videoSrc, setVideoSrc] = useState(null);
    const [now, setNow] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const videoRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await apiJson(`/api/plan/${jobId}`);
                if (cancelled) return;
                setPlan(data);
                setClips(data.clips.map((c) => ({ ...c, include: true })));
                setVideoSrc(getApiUrl(data.source_url));
            } catch (e) {
                if (!cancelled) setError(e.detail || e.message || 'Could not load the plan.');
            }
        })();
        return () => { cancelled = true; };
    }, [jobId]);

    const clip = clips[selected];
    const cs = Number(clip?.start) || 0;
    const ce = Number(clip?.end) || 0;
    const chunks = useMemo(
        () => (plan && clip ? captionChunks(plan.words, cs, ce) : []),
        [plan, clip, cs, ce],
    );

    const seek = (t) => {
        const v = videoRef.current;
        if (v) v.currentTime = t;
        setNow(t);
    };

    const select = (i) => {
        setSelected(i);
        seek(Number(clips[i].start) || 0);
    };

    const togglePlay = () => {
        const v = videoRef.current;
        if (!v || !clip) return;
        if (v.paused) {
            if (v.currentTime < cs - 0.05 || v.currentTime >= ce - 0.05) v.currentTime = cs;
            v.play();
        } else {
            v.pause();
        }
    };

    const onTimeUpdate = () => {
        const v = videoRef.current;
        if (!v || !clip) return;
        setNow(v.currentTime);
        if (!v.paused && v.currentTime >= ce) {
            v.pause();
            v.currentTime = ce;
        }
    };

    const update = (i, patch) => setClips((prev) => prev.map((c, k) => (k === i ? { ...c, ...patch } : c)));

    const render = async () => {
        const approved = clips.filter((c) => c.include);
        if (!approved.length) return;
        setSubmitting(true);
        setError('');
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (geminiKey) headers['X-Gemini-Key'] = geminiKey;
            const res = await apiFetch(`/api/plan/${jobId}/render`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    clips: approved.map(({ include: _include, ...c }) => ({
                        ...c, start: Number(c.start), end: Number(c.end),
                    })),
                }),
            });
            if (!res.ok) {
                let detail = await res.text();
                try { detail = JSON.parse(detail).detail || detail; } catch { /* plain text */ }
                throw new Error(typeof detail === 'string' ? detail : 'Render request failed');
            }
            onRendered();
        } catch (e) {
            setError(e.message);
            setSubmitting(false);
        }
    };

    if (error && !plan) {
        return (
            <div className="p-6 text-danger text-sm flex items-center gap-2">
                <AlertTriangle size={16} /> {error}
            </div>
        );
    }
    if (!plan) {
        return (
            <div className="h-full min-h-[140px] flex items-center justify-center text-muted">
                <Loader2 size={24} className="animate-spin text-brass" />
            </div>
        );
    }

    const t = now - cs;
    const showHook = plan.hook.enabled && clip?.viral_hook_text && t >= 0 && t < plan.hook.seconds;
    const chunk = plan.captions ? chunks.find((c, k) => now >= c.start
        && now < Math.max(c.end, Math.min((chunks[k + 1]?.start ?? c.end + 0.5), c.end + 0.5))) : null;
    const approvedCount = clips.filter((c) => c.include).length;
    const windowStart = Math.max(0, cs - 10);
    const windowEnd = ce + 10;

    return (
        <div className="flex flex-col lg:flex-row gap-4 pb-10">
            {/* Preview player */}
            <div className="lg:w-[300px] shrink-0 lg:sticky lg:top-0 self-start w-full max-w-[340px] mx-auto">
                <div
                    className="relative w-full bg-black rounded-card overflow-hidden"
                    style={{ aspectRatio: ASPECT[plan.output_format] || '9 / 16' }}
                >
                    {videoSrc && (
                        <video
                            ref={videoRef}
                            src={videoSrc}
                            className="absolute inset-0 w-full h-full object-cover"
                            playsInline
                            preload="metadata"
                            onLoadedMetadata={() => clip && seek(cs)}
                            onTimeUpdate={onTimeUpdate}
                            onPlay={() => setPlaying(true)}
                            onPause={() => setPlaying(false)}
                            onClick={togglePlay}
                        />
                    )}
                    {showHook && (
                        <div className="absolute left-0 right-0 top-[16%] flex justify-center px-4 pointer-events-none">
                            <span
                                className="text-center font-extrabold leading-snug rounded-xl px-3 py-1.5 text-[15px]"
                                style={{ ...(HOOK_LOOK[plan.hook.style] || HOOK_LOOK.pill), boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}
                            >
                                {clip.viral_hook_text}
                            </span>
                        </div>
                    )}
                    {chunk && (
                        <div
                            className="absolute left-0 right-0 bottom-[22%] text-center px-3 pointer-events-none uppercase"
                            style={{ fontFamily: "'Anton-Regular', Impact, sans-serif", fontSize: 26, color: '#fff', WebkitTextStroke: '1.5px #000', paintOrder: 'stroke fill', letterSpacing: '0.02em' }}
                        >
                            {chunk.words.map(([ws, we, w], k) => (
                                <span key={k} style={now >= ws && now < we ? { color: '#FFE500' } : undefined}>
                                    {w}{k < chunk.words.length - 1 ? ' ' : ''}
                                </span>
                            ))}
                        </div>
                    )}
                    <style>{"@font-face{font-family:'Anton-Regular';src:url('/fonts/Anton-Regular.ttf') format('truetype');font-weight:400;}"}</style>
                </div>
                {clip && (
                    <div className="mt-2 space-y-1.5">
                        <div className="flex items-center gap-2">
                            <button type="button" onClick={togglePlay} className="btn-quiet p-1.5" aria-label={playing ? 'pause' : 'play'}>
                                {playing ? <Pause size={14} /> : <Play size={14} />}
                            </button>
                            <input
                                type="range"
                                min={windowStart}
                                max={windowEnd}
                                step={0.1}
                                value={Math.min(Math.max(now, windowStart), windowEnd)}
                                onChange={(e) => seek(Number(e.target.value))}
                                className="flex-1 accent-[var(--color-accent)]"
                            />
                        </div>
                        <p className="font-mono text-[11px] text-muted text-center">
                            {fmt(now)} · clip {fmt(cs)}–{fmt(ce)}
                            {(now < cs || now > ce) && <span className="text-brass"> · outside the cut</span>}
                        </p>
                        <p className="text-[11px] leading-snug text-muted text-center">
                            Approximate preview: center crop, hook and captions drawn in the browser.
                            The final render follows the speaker.
                        </p>
                    </div>
                )}
            </div>

            {/* Clips */}
            <div className="flex-1 min-w-0 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-ink">
                        <b>{clips.length}</b> clips picked · nothing rendered yet. Review, edit and approve.
                    </p>
                    <button
                        type="button"
                        onClick={render}
                        disabled={submitting || !approvedCount}
                        className="btn-primary !w-auto px-4 py-2 text-sm flex items-center gap-2"
                    >
                        {submitting ? <Loader2 size={14} className="animate-spin" /> : <Clapperboard size={14} />}
                        Render {approvedCount} clip{approvedCount === 1 ? '' : 's'}
                    </button>
                </div>
                {error && <p className="text-danger text-sm">{error}</p>}

                {clips.map((c, i) => {
                    const active = i === selected;
                    const length = Number(c.end) - Number(c.start);
                    return (
                        <div
                            key={c.index}
                            className={`card p-3.5 space-y-2.5 transition-opacity ${active ? 'ring-1 ring-brass' : ''} ${c.include ? '' : 'opacity-50'}`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <label className="flex items-center gap-2 text-sm text-ink cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={c.include}
                                        onChange={(e) => update(i, { include: e.target.checked })}
                                        className="w-4 h-4 accent-[var(--color-accent)]"
                                    />
                                    Clip {c.index + 1}
                                    <span className="font-mono text-xs text-muted">{length.toFixed(1)}s</span>
                                </label>
                                <button type="button" onClick={() => select(i)} className="btn-quiet py-1 px-2.5 text-xs lowercase flex items-center gap-1.5">
                                    <Play size={12} /> preview
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                {['start', 'end'].map((field) => (
                                    <div key={field} className="flex items-center gap-1.5">
                                        <span className="text-xs text-muted w-8">{field}</span>
                                        <input
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            value={c[field]}
                                            onChange={(e) => update(i, { [field]: e.target.value })}
                                            className="input-field !py-1 text-xs font-mono"
                                        />
                                        <button
                                            type="button"
                                            disabled={!active}
                                            title="Use the player's current time"
                                            onClick={() => update(i, { [field]: Number(now.toFixed(2)) })}
                                            className="btn-quiet py-1 px-1.5 text-[11px] lowercase whitespace-nowrap"
                                        >
                                            = now
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <label className="block">
                                <span className="text-xs text-muted">hook (on screen for the first {plan.hook.seconds}s{plan.hook.enabled ? '' : ' — auto hook is off for this job'})</span>
                                <input
                                    value={c.viral_hook_text}
                                    onChange={(e) => update(i, { viral_hook_text: e.target.value })}
                                    className="input-field !py-1.5 text-sm"
                                />
                            </label>
                            <label className="block">
                                <span className="text-xs text-muted">title</span>
                                <input
                                    value={c.video_title_for_youtube_short}
                                    onChange={(e) => update(i, { video_title_for_youtube_short: e.target.value })}
                                    className="input-field !py-1.5 text-sm"
                                />
                            </label>
                            <label className="block">
                                <span className="text-xs text-muted">description (TikTok)</span>
                                <textarea
                                    rows={2}
                                    value={c.video_description_for_tiktok}
                                    onChange={(e) => update(i, { video_description_for_tiktok: e.target.value })}
                                    className="input-field !py-1.5 text-sm resize-y"
                                />
                            </label>
                            <label className="block">
                                <span className="text-xs text-muted">description (Instagram)</span>
                                <textarea
                                    rows={2}
                                    value={c.video_description_for_instagram}
                                    onChange={(e) => update(i, { video_description_for_instagram: e.target.value })}
                                    className="input-field !py-1.5 text-sm resize-y"
                                />
                            </label>
                            <details className="text-xs">
                                <summary className="cursor-pointer text-muted">what is said in this cut</summary>
                                <p className="mt-1.5 leading-relaxed text-ink2 whitespace-pre-wrap">
                                    {spokenText(plan.segments, Number(c.start), Number(c.end)) || '(no speech)'}
                                </p>
                            </details>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default PlanReview;
