import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Youtube, X } from 'lucide-react';
import Modal from './ui/Modal';
import { apiFetch, apiJson } from '../lib/api';

// Posts rendered clips to YouTube through the local Chrome (youtube_studio.py),
// one every N minutes. The server uploads each clip at its time, so the PC
// and the backend must be on then.

const STATUS_LABEL = {
    scheduled: 'scheduled', uploading: 'uploading…', waiting_checks: 'waiting for checks…',
    published: 'published', failed: 'failed',
};
const ACTIVE = ['scheduled', 'uploading', 'waiting_checks', 'published'];

function toLocalInput(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nextFullHour() {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d.getTime();
}

function fmt(sec) {
    return new Date(sec * 1000).toLocaleString([], { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function YoutubePostModal({ jobId, clips: openClips, onClose }) {
    // The list as it was when the dialog opened: the dashboard keeps polling.
    const [clips] = useState(openClips);
    const [accounts, setAccounts] = useState(null);
    const [account, setAccount] = useState('');
    const [queue, setQueue] = useState([]);
    const [visibility, setVisibility] = useState('public');
    const [interval, setIntervalMin] = useState(60);
    const [startAt, setStartAt] = useState('');
    const [picked, setPicked] = useState({});
    const [titles, setTitles] = useState({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const loadQueue = useCallback(async () => {
        const data = await apiJson('/api/youtube/queue');
        setQueue(data.items || []);
        return data.items || [];
    }, []);

    useEffect(() => {
        let cancelled = false;
        Promise.all([apiJson('/api/youtube/accounts'), loadQueue()]).then(([acc, items]) => {
            if (cancelled) return;
            const list = acc.accounts || [];
            setAccounts(list);
            setAccount(list[0] || '');
            const taken = new Set(items.filter((it) => it.job_id === jobId && ACTIVE.includes(it.status)).map((it) => it.clip_index));
            setPicked(Object.fromEntries(clips.map(({ index }) => [index, !taken.has(index)])));
            setTitles(Object.fromEntries(clips.map(({ clip, index }) => [index, (clip.video_title_for_youtube_short || '').slice(0, 100)])));
            // Continue the chain after the last post already scheduled.
            const last = Math.max(0, ...items.filter((it) => it.status === 'scheduled').map((it) => it.publish_at * 1000));
            setStartAt(toLocalInput(Math.max(nextFullHour(), last ? last + 60 * 60000 : 0)));
        }).catch((e) => { if (!cancelled) setError(e.message || 'Could not load YouTube accounts'); });
        const timer = setInterval(() => { loadQueue().catch(() => {}); }, 10000);
        return () => { cancelled = true; clearInterval(timer); };
    }, [jobId, clips, loadQueue]);

    const chosen = clips.filter(({ index }) => picked[index]);
    const jobQueue = useMemo(() => queue.filter((it) => it.job_id === jobId), [queue, jobId]);

    const schedule = async () => {
        setBusy(true);
        setError('');
        try {
            const res = await apiFetch('/api/youtube/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_id: jobId, account, visibility,
                    start_at: new Date(startAt).getTime() / 1000,
                    interval_minutes: Number(interval),
                    clips: chosen.map(({ index }) => ({ index, title: titles[index] || '' })),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Could not schedule');
            await loadQueue();
            setPicked({});
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    const remove = async (id) => {
        const res = await apiFetch(`/api/youtube/queue/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setError(data.detail || 'Could not remove');
        }
        loadQueue().catch(() => {});
    };

    const footer = (
        <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">Uploads run on this PC at each time: keep it and the server on.</p>
            <button
                onClick={schedule}
                disabled={busy || !account || !startAt || chosen.length === 0}
                className="btn-primary px-4 py-2 text-xs shrink-0"
            >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Youtube size={14} />}
                schedule {chosen.length || ''}
            </button>
        </div>
    );

    return (
        <Modal isOpen onClose={onClose} size="lg" eyebrow="YOUTUBE STUDIO" title="post to youtube" footer={footer}>
            {accounts && accounts.length === 0 ? (
                <p className="text-sm text-ink">
                    No YouTube account signed in. Run <code className="readout">python youtube_studio.py login --account main</code> once,
                    sign in to the channel and close the window.
                </p>
            ) : (
                <div className="space-y-5">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <label className="text-xs text-muted space-y-1">
                            <span className="eyebrow block">account</span>
                            <select className="input-field w-full" value={account} onChange={(e) => setAccount(e.target.value)}>
                                {(accounts || []).map((a) => <option key={a} value={a}>{a}</option>)}
                            </select>
                        </label>
                        <label className="text-xs text-muted space-y-1">
                            <span className="eyebrow block">visibility</span>
                            <select className="input-field w-full" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                                <option value="public">public</option>
                                <option value="unlisted">unlisted</option>
                                <option value="private">private</option>
                            </select>
                        </label>
                        <label className="text-xs text-muted space-y-1">
                            <span className="eyebrow block">first post</span>
                            <input type="datetime-local" className="input-field w-full" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
                        </label>
                        <label className="text-xs text-muted space-y-1">
                            <span className="eyebrow block">every (min)</span>
                            <input type="number" min="0" className="input-field w-full" value={interval} onChange={(e) => setIntervalMin(e.target.value)} />
                        </label>
                    </div>

                    <div className="space-y-2">
                        <p className="eyebrow">rendered clips</p>
                        {clips.length === 0 && <p className="text-sm text-muted">No rendered clips yet.</p>}
                        {clips.map(({ index }) => {
                            const slot = chosen.findIndex((c) => c.index === index);
                            const when = slot >= 0 && startAt ? new Date(startAt).getTime() / 1000 + slot * Number(interval) * 60 : null;
                            return (
                                <div key={index} className="flex items-center gap-2">
                                    <input type="checkbox" checked={!!picked[index]} onChange={(e) => setPicked((p) => ({ ...p, [index]: e.target.checked }))} />
                                    <span className="readout w-10 shrink-0">#{index + 1}</span>
                                    <input
                                        className="input-field flex-1 min-w-0 text-sm"
                                        maxLength={100}
                                        value={titles[index] || ''}
                                        onChange={(e) => setTitles((t) => ({ ...t, [index]: e.target.value }))}
                                    />
                                    <span className="readout w-32 shrink-0 text-right">{when ? fmt(when) : ''}</span>
                                </div>
                            );
                        })}
                    </div>

                    {jobQueue.length > 0 && (
                        <div className="space-y-1.5">
                            <p className="eyebrow">queue of this project</p>
                            {jobQueue.map((it) => (
                                <div key={it.id} className="flex items-center gap-2 text-sm">
                                    <span className="readout w-10 shrink-0">#{it.clip_index + 1}</span>
                                    <span className="flex-1 min-w-0 truncate text-ink" title={it.error || it.title}>{it.title}</span>
                                    <span className="readout shrink-0">{fmt(it.publish_at)}</span>
                                    <span className={`readout shrink-0 w-36 text-right ${it.status === 'failed' ? 'text-danger' : it.status === 'published' ? 'text-brass' : ''}`} title={it.error || ''}>
                                        {STATUS_LABEL[it.status] || it.status}
                                    </span>
                                    {(it.status === 'scheduled' || it.status === 'failed') ? (
                                        <button onClick={() => remove(it.id)} className="p-1 text-muted hover:text-ink" title="remove">
                                            <X size={14} />
                                        </button>
                                    ) : <span className="w-[22px]" />}
                                </div>
                            ))}
                        </div>
                    )}
                    {error && <p className="text-sm text-danger">{error}</p>}
                </div>
            )}
        </Modal>
    );
}
