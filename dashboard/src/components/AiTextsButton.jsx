import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { postPlan } from '../lib/plan';

// Asks the AI to rewrite the clip's hook, title, descriptions, why and score
// from what is said inside its current cut.
export default function AiTextsButton({ jobId, index, geminiKey, onResult, className, disabled = false, rendered = false }) {
    const [busy, setBusy] = useState(false);
    const run = async () => {
        setBusy(true);
        try {
            const data = await postPlan(`/api/clip/${jobId}/${index}/texts`, {}, geminiKey);
            onResult?.(data.result);
        } catch (e) {
            alert(e.message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <button
            type="button"
            onClick={run}
            disabled={disabled || busy}
            className={className}
            title={rendered
                ? 'AI rewrites hook, title, descriptions and why from this cut (the hook in the video changes on the next render)'
                : 'AI rewrites hook, title, descriptions and why from this cut'}
        >
            {busy
                ? <Loader2 size={16} className="animate-spin text-brass shrink-0" />
                : <Sparkles size={16} className="text-muted group-hover:text-brass transition-colors shrink-0" />}
            {busy ? 'writing…' : 'ai texts'}
        </button>
    );
}
