import React, { useMemo, useRef, useState } from 'react';
import { Loader2, Scissors, Clapperboard, TrendingUp, AlertCircle, FileText, PenLine } from 'lucide-react';
import { TEXT_FIELDS, editsOf, postPlan } from '../lib/plan';
import { getApiUrl } from '../config';
import Modal from './ui/Modal';
import AiTextsButton from './AiTextsButton';

// Review step of a job created with "review before rendering": the AI picked
// the clips but they are not rendered yet. Each one shows as a card like the
// rendered ones, previewed over the source video (center crop, hook and
// captions drawn in CSS as an approximation of the burned ones), with its own
// edit and render buttons.

const HOOK_LOOK = {
    pill: { background: '#fff', color: '#000' },
    classic: { background: 'rgba(255,255,255,0.94)', color: '#000', fontFamily: 'Georgia, serif' },
    dark: { background: 'rgba(18,18,20,0.92)', color: '#fff' },
    yellow: { background: '#FFD600', color: '#000' },
    red: { background: '#DC2626', color: '#fff' },
    outline: { color: '#fff', WebkitTextStroke: '1.5px #000', paintOrder: 'stroke fill' },
    outline_yellow: { color: '#FFD600', WebkitTextStroke: '1.5px #000', paintOrder: 'stroke fill' },
};

const QUIET_BTN = 'group flex flex-col items-center justify-center gap-1 py-2.5 sm:py-2 px-1 rounded-input border border-rule hover:bg-paper3 text-[11px] lowercase text-ink2 whitespace-nowrap transition-colors disabled:opacity-45 disabled:cursor-not-allowed';

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

// Hook and karaoke captions drawn over a source video, as an approximation of
// what the render burns in. `words` are [start, end, text] in source seconds,
// already limited to the cut; `time` is the source time on screen.
export function PlanOverlay({ words, time, hookText, hookStyle, showHook, captions, compact = false }) {
    const chunks = useMemo(() => captionChunks(words, -Infinity, Infinity), [words]);
    const chunk = captions ? chunks.find((c, k) => time >= c.start
        && time < Math.max(c.end, Math.min((chunks[k + 1]?.start ?? c.end + 0.5), c.end + 0.5))) : null;
    return (
        <>
            {showHook && hookText && (
                <div className="absolute left-0 right-0 top-[16%] flex justify-center px-3 pointer-events-none">
                    <span
                        className={`text-center font-extrabold leading-snug rounded-xl px-2.5 py-1 ${compact ? 'text-[13px]' : 'text-[16px]'}`}
                        style={{ ...(HOOK_LOOK[hookStyle] || HOOK_LOOK.pill), boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}
                    >
                        {hookText}
                    </span>
                </div>
            )}
            {chunk && (
                <div
                    className="absolute left-0 right-0 bottom-[24%] text-center px-2 pointer-events-none uppercase"
                    style={{ fontFamily: "'Anton-Regular', Impact, sans-serif", fontSize: compact ? 22 : 28, color: '#fff', WebkitTextStroke: '1.2px #000', paintOrder: 'stroke fill', letterSpacing: '0.02em' }}
                >
                    {chunk.words.map(([ws, we, w], k) => (
                        <span key={k} style={time >= ws && time < we ? { color: '#FFE500' } : undefined}>
                            {w}{k < chunk.words.length - 1 ? ' ' : ''}
                        </span>
                    ))}
                </div>
            )}
            <style>{"@font-face{font-family:'Anton-Regular';src:url('/fonts/Anton-Regular.ttf') format('truetype');font-weight:400;}"}</style>
        </>
    );
}

function Preview({ plan, clip, start, end, videoRef, now, setNow }) {
    const words = useMemo(
        () => plan.words.filter(([ws, we]) => we > start && ws < end), [plan, start, end]);

    const onTimeUpdate = () => {
        const v = videoRef.current;
        if (!v) return;
        setNow(v.currentTime);
        if (!v.paused && v.currentTime >= end) {
            v.pause();
            v.currentTime = end;
        }
    };
    const onPlay = () => {
        const v = videoRef.current;
        if (v && (v.currentTime < start - 0.05 || v.currentTime >= end - 0.05)) v.currentTime = start;
    };

    return (
        <>
            <video
                ref={videoRef}
                src={getApiUrl(plan.source_url)}
                controls
                className="absolute inset-0 w-full h-full object-cover"
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => { e.target.currentTime = start; setNow(start); }}
                onTimeUpdate={onTimeUpdate}
                onPlay={onPlay}
            />
            <PlanOverlay
                words={words}
                time={now}
                hookText={clip.viral_hook_text}
                hookStyle={plan.hook.style}
                showHook={plan.hook.enabled && now - start >= 0 && now - start < plan.hook.seconds}
                captions={plan.captions}
                compact
            />
        </>
    );
}

export function PlanCard({ clip, index, jobId, plan, geminiKey, onResult, onEditClip, editorBusy = false }) {
    const videoRef = useRef(null);
    const [now, setNow] = useState(Number(clip.start) || 0);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(null);
    const [busy, setBusy] = useState(null); // 'save' | 'render'
    const [error, setError] = useState('');

    const start = Number(clip.start) || 0;
    const end = Number(clip.end) || 0;
    const state = clip.render_state;
    const queued = state === 'queued' || state === 'rendering' || editorBusy;
    const adjusted = Array.isArray(clip.adjusted) ? clip.adjusted : [start, end];

    const openEdit = () => {
        setDraft({ start, end, ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, clip[k] || ''])) });
        setError('');
        setEditing(true);
    };

    // `fields` = the modal draft, or the clip as it is (render from the card).
    const submit = async (render, fields) => {
        setBusy(render ? 'render' : 'save');
        setError('');
        try {
            const body = { clips: [editsOf(index, fields)] };
            const result = await postPlan(`/api/plan/${jobId}/${render ? 'render' : 'clips'}`, body, geminiKey);
            onResult(result);
            setEditing(false);
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(null);
        }
    };

    const seekCard = (t) => {
        if (videoRef.current) videoRef.current.currentTime = t;
        setNow(t);
    };

    return (
        <div className="card overflow-hidden flex flex-col md:flex-row group hover:border-rule2 transition-colors animate-fade md:min-h-[420px]">
            <div className="w-full max-w-[calc(64vh*0.5625)] md:max-w-none mx-auto md:mx-0 md:w-[236px] bg-black relative shrink-0 aspect-[9/16] md:aspect-auto overflow-hidden">
                <Preview plan={plan} clip={clip} start={start} end={end} videoRef={videoRef} now={now} setNow={setNow} />
                <div className="absolute top-3 left-3 flex flex-wrap gap-2 pointer-events-none">
                    <span className="bg-black/70 text-ink font-mono text-micro uppercase px-2 py-1 rounded-full">
                        Clip {index + 1}
                    </span>
                    {Number.isFinite(clip.predicted_score) && (
                        <span className="bg-black/70 font-mono text-micro uppercase px-2 py-1 rounded-full flex items-center gap-1">
                            <TrendingUp size={11} className="shrink-0 text-muted" />
                            <span className="text-muted">viral</span>
                            <b className={clip.predicted_score >= 80 ? 'text-ok' : clip.predicted_score >= 65 ? 'text-brass' : 'text-ink2'}>
                                {clip.predicted_score}
                            </b>
                            <span className="text-muted">/100</span>
                        </span>
                    )}
                    <span className="bg-brass/90 text-black font-mono text-micro uppercase px-2 py-1 rounded-full">preview</span>
                </div>
            </div>

            <div className="flex-1 p-4 md:p-5 flex flex-col overflow-hidden min-w-0">
                <div className="mb-3">
                    <h3 className="text-base font-medium text-ink leading-tight line-clamp-2 mb-2 break-words">
                        {clip.video_title_for_youtube_short || 'Untitled clip'}
                    </h3>
                    {clip.why && (
                        <p className="text-xs text-ink2 leading-snug mb-2 break-words">
                            <span className="text-muted">why the AI picked it: </span>{clip.why}
                        </p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                        <span className="readout bg-paper3 px-2 py-0.5 rounded-full">{(end - start).toFixed(1)}s</span>
                        <span className="readout bg-paper3 px-2 py-0.5 rounded-full">{fmt(start)}–{fmt(end)}</span>
                        <span className="readout bg-paper3 px-2 py-0.5 rounded-full">not rendered</span>
                    </div>
                </div>

                <div className="flex-1 min-h-0 space-y-2 mb-4">
                    <div className="bg-paper rounded-input px-3 py-2 border border-rule flex items-center gap-2 min-w-0">
                        <span className="eyebrow shrink-0">HOOK</span>
                        <p className="text-xs text-ink2 truncate flex-1 min-w-0">{clip.viral_hook_text || '—'}</p>
                    </div>
                    <div className="bg-paper rounded-input px-3 py-2 border border-rule flex items-center gap-2 min-w-0">
                        <span className="eyebrow shrink-0">TIKTOK · IG</span>
                        <p className="text-xs text-ink2 truncate flex-1 min-w-0">
                            {clip.video_description_for_tiktok || clip.video_description_for_instagram || '—'}
                        </p>
                    </div>
                    <details className="text-xs">
                        <summary className="cursor-pointer text-muted inline-flex items-center gap-1.5">
                            <FileText size={12} /> what is said in this cut
                        </summary>
                        <p className="mt-1.5 leading-relaxed text-ink2">
                            {spokenText(plan.segments, start, end) || '(no speech)'}
                        </p>
                    </details>
                </div>

                {state === 'failed' && (
                    <div className="mb-3 px-3 py-2 rounded-input text-xs text-danger bg-[color-mix(in_oklab,var(--color-danger)_10%,transparent)] flex items-center gap-2">
                        <AlertCircle size={14} className="shrink-0" /> render failed — check the log and try again
                    </div>
                )}
                {queued && (
                    <div className="mb-3 px-3 py-2 rounded-input text-xs text-ink2 bg-paper3 flex items-center gap-2 lowercase">
                        <Loader2 size={14} className="shrink-0 animate-spin text-brass" />
                        {state === 'rendering' || editorBusy ? 'rendering this clip…' : 'in line to render'}
                    </div>
                )}
                {error && !editing && <p className="mb-3 text-xs text-danger">{error}</p>}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-auto pt-4 border-t border-rule">
                    <button
                        type="button"
                        onClick={() => onEditClip(index)}
                        disabled={queued}
                        className={QUIET_BTN}
                        title="cut, framing, captions, hook and music, previewed before the render"
                    >
                        <Scissors size={16} className="text-muted group-hover:text-brass transition-colors shrink-0" />
                        edit
                    </button>
                    <button type="button" onClick={openEdit} disabled={queued} className={QUIET_BTN} title="title, descriptions and the AI's cut">
                        <PenLine size={16} className="text-muted group-hover:text-brass transition-colors shrink-0" />
                        texts &amp; ai cut
                    </button>
                    <AiTextsButton jobId={jobId} index={index} geminiKey={geminiKey} onResult={onResult} disabled={queued} className={QUIET_BTN} />
                    <button
                        type="button"
                        onClick={() => submit(true, clip)}
                        disabled={queued || !!busy}
                        className="btn-primary flex-col gap-1 py-2.5 sm:py-2 px-1 text-[11px] leading-none rounded-input whitespace-nowrap"
                    >
                        {busy === 'render' ? <Loader2 size={16} className="animate-spin shrink-0" /> : <Clapperboard size={16} className="shrink-0" />}
                        render
                    </button>
                </div>
            </div>

            <Modal
                isOpen={editing}
                onClose={() => !busy && setEditing(false)}
                eyebrow={`CLIP ${index + 1} · NOT RENDERED`}
                title="texts and the AI's cut"
                size="md"
                footer={(
                    <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" onClick={() => setEditing(false)} disabled={!!busy} className="btn-ghost px-3 py-2 text-xs">cancel</button>
                        <button type="button" onClick={() => submit(false, draft)} disabled={!!busy} className="btn-ghost px-3 py-2 text-xs">
                            {busy === 'save' && <Loader2 size={14} className="animate-spin" />} save
                        </button>
                        <button type="button" onClick={() => submit(true, draft)} disabled={!!busy} className="btn-primary !w-auto px-4 py-2 text-xs">
                            {busy === 'render' ? <Loader2 size={14} className="animate-spin" /> : <Clapperboard size={14} />} save &amp; render
                        </button>
                    </div>
                )}
            >
                {draft && (
                    <div className="space-y-3">
                        {clip.why && (
                            <p className="text-xs text-ink2 leading-relaxed">
                                <span className="text-muted">why the AI picked it: </span>{clip.why}
                                {Number.isFinite(clip.predicted_score) && <span className="text-muted"> · score {clip.predicted_score}/100</span>}
                            </p>
                        )}

                        <div className="rounded-input bg-paper2 border border-rule px-2.5 py-2 space-y-1 text-[11px] font-mono">
                            {[
                                ['AI pick', Array.isArray(clip.proposed) ? clip.proposed : null],
                                ['adjusted', adjusted],
                            ].filter(([, r]) => r).map(([label, [a, b]]) => {
                                const current = Math.abs(Number(draft.start) - a) < 0.05 && Math.abs(Number(draft.end) - b) < 0.05;
                                return (
                                    <div key={label} className="flex items-center justify-between gap-2">
                                        <span className={current ? 'text-ink' : 'text-muted'}>
                                            {label} · {fmt(a)}–{fmt(b)} · {(b - a).toFixed(1)}s{current ? ' ✓' : ''}
                                        </span>
                                        <button
                                            type="button"
                                            disabled={current}
                                            onClick={() => { setDraft((d) => ({ ...d, start: a, end: b })); seekCard(a); }}
                                            className="btn-quiet py-0.5 px-2 text-[11px] lowercase font-sans"
                                        >
                                            use
                                        </button>
                                    </div>
                                );
                            })}
                            <p className="font-sans text-muted leading-snug">
                                &quot;adjusted&quot; is the AI pick after the length limit and the snap to sentence ends.
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            {['start', 'end'].map((field) => (
                                <div key={field} className="flex items-center gap-1.5">
                                    <span className="text-xs text-muted w-8">{field}</span>
                                    <input
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        value={draft[field]}
                                        onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                                        className="input-field !py-1 text-xs font-mono"
                                    />
                                    <button
                                        type="button"
                                        title="Use the card player's current time"
                                        onClick={() => setDraft((d) => ({ ...d, [field]: Number(now.toFixed(2)) }))}
                                        className="btn-quiet py-1 px-1.5 text-[11px] lowercase whitespace-nowrap"
                                    >
                                        = player
                                    </button>
                                </div>
                            ))}
                        </div>
                        <p className="text-[11px] text-muted">
                            {(Number(draft.end) - Number(draft.start)).toFixed(1)}s · the card player is at {fmt(now)}
                        </p>

                        {[
                            ['viral_hook_text', `hook (on screen for the first ${plan.hook.seconds}s${plan.hook.enabled ? '' : ' — auto hook is off for this job'})`, false],
                            ['video_title_for_youtube_short', 'title', false],
                            ['video_description_for_tiktok', 'description (TikTok)', true],
                            ['video_description_for_instagram', 'description (Instagram)', true],
                        ].map(([field, label, multi]) => (
                            <label key={field} className="block">
                                <span className="text-xs text-muted">{label}</span>
                                {multi ? (
                                    <textarea
                                        rows={3}
                                        value={draft[field]}
                                        onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                                        className="input-field !py-1.5 text-sm resize-y"
                                    />
                                ) : (
                                    <input
                                        value={draft[field]}
                                        onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                                        className="input-field !py-1.5 text-sm"
                                    />
                                )}
                            </label>
                        ))}

                        <details className="text-xs">
                            <summary className="cursor-pointer text-muted">what is said in this cut</summary>
                            <p className="mt-1.5 leading-relaxed text-ink2">
                                {spokenText(plan.segments, Number(draft.start), Number(draft.end)) || '(no speech)'}
                            </p>
                        </details>
                        {error && <p className="text-xs text-danger">{error}</p>}
                    </div>
                )}
            </Modal>
        </div>
    );
}
