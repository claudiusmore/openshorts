import { useEffect, useState } from 'react';
import { apiFetch, apiJson } from './api';

// Review-before-render plan: the clips the AI picked, not rendered yet.

export const TEXT_FIELDS = ['viral_hook_text', 'video_title_for_youtube_short',
    'video_description_for_tiktok', 'video_description_for_instagram'];

export function editsOf(index, draft) {
    return {
        index, start: Number(draft.start), end: Number(draft.end),
        ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, draft[k] ?? ''])),
    };
}

export async function postPlan(path, body, geminiKey) {
    const headers = { 'Content-Type': 'application/json' };
    if (geminiKey) headers['X-Gemini-Key'] = geminiKey;
    const res = await apiFetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
        let detail = await res.text();
        try { detail = JSON.parse(detail).detail || detail; } catch { /* plain text */ }
        throw new Error(typeof detail === 'string' ? detail : 'Request failed');
    }
    return res.json();
}

// Static data every card of the plan shares: transcript words, hook and
// caption settings, the source video. Fetched once per job.
export function usePlanData(jobId, active) {
    const [plan, setPlan] = useState(null);
    useEffect(() => {
        if (!active || !jobId) { setPlan(null); return undefined; }
        let cancelled = false;
        apiJson(`/api/plan/${jobId}`)
            .then((data) => { if (!cancelled) setPlan(data); })
            .catch(() => { if (!cancelled) setPlan(null); });
        return () => { cancelled = true; };
    }, [jobId, active]);
    return plan;
}

export async function renderPlanClips(jobId, entries, geminiKey) {
    return postPlan(`/api/plan/${jobId}/render`, {
        clips: entries.map(({ clip, index }) => editsOf(index, clip)),
    }, geminiKey);
}
