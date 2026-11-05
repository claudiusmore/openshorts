import React, { useState, useEffect } from 'react';
import { Loader2, Film, FolderOpen, RefreshCw } from 'lucide-react';
import { apiJson } from '../lib/api';

// Self-host project list: every job still on this machine's disk (Cloud has
// the R2-backed History tab instead). Opening one shows its clips and editor.
const BADGE = {
    completed: ['badge-ok', 'done'],
    processing: ['badge-brass', 'processing'],
    queued: ['badge-brass', 'queued'],
    failed: ['badge-danger', 'failed'],
    cancelled: ['badge-warn', 'cancelled'],
};

export default function ProjectsTab({ onOpen }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [opening, setOpening] = useState(null);

    const load = () => {
        setError('');
        apiJson('/api/local/projects')
            .then(setData)
            .catch(() => setError('Could not load your projects.'));
    };
    useEffect(load, []);

    const open = async (jobId) => {
        setOpening(jobId);
        try {
            await onOpen(jobId);
        } catch {
            setError('Could not open this project.');
            setOpening(null);
        }
    };

    if (data === null && !error) {
        return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-brass" /></div>;
    }
    const projects = data?.projects || [];
    const days = data?.retention_seconds ? Math.round(data.retention_seconds / 86400) : null;
    const fmt = (t) => new Date(t * 1000).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    return (
        <div className="animate-fade">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-2">
                <div>
                    <p className="eyebrow mb-1.5">07 · PROJECTS</p>
                    <h1 className="font-display lowercase text-2xl text-ink">Your projects</h1>
                </div>
                <button type="button" onClick={load} className="btn-quiet py-1.5 px-3 text-xs lowercase flex items-center gap-1.5">
                    <RefreshCw size={12} /> refresh
                </button>
            </div>
            <p className="text-muted text-sm mb-8 lowercase">
                Every video processed on this machine{days ? `, kept for ${days} day${days === 1 ? '' : 's'}` : ''}.
                Open one to see its shorts and keep editing.
            </p>

            {error && <p className="text-danger text-sm mb-4">{error}</p>}

            {projects.length === 0 && !error && (
                <div className="text-center py-20 text-muted">
                    <Film size={40} className="mx-auto mb-4 text-muted" />
                    <p className="lowercase">No projects yet. Generate your first shorts from the Clip Generator.</p>
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {projects.map((p) => {
                    const [badge, label] = BADGE[p.status] || ['badge-warn', p.status];
                    return (
                        <div key={p.job_id} className="card p-3 flex flex-col gap-3 min-w-0">
                            <div className="aspect-video rounded-input bg-paper3 overflow-hidden flex items-center justify-center">
                                {p.thumbnail ? (
                                    <video src={`${p.thumbnail}#t=1`} preload="metadata" muted className="h-full w-full object-contain" />
                                ) : (
                                    <Film size={24} className="text-muted" />
                                )}
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm text-ink truncate" title={p.title}>{p.title}</p>
                                <p className="text-xs text-muted mt-0.5">{fmt(p.created_at)}</p>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-2">
                                    <span className={badge}>{label}</span>
                                    <span className="text-xs text-muted">{p.clips} clip{p.clips === 1 ? '' : 's'}</span>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => open(p.job_id)}
                                    disabled={!!opening}
                                    className="btn-quiet py-1.5 px-3 text-xs lowercase flex items-center gap-1.5"
                                >
                                    {opening === p.job_id ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
                                    open
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
