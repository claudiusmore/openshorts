// Read-only summary of the choices a job was created with, shown under the
// video in Live Analysis. Built from the same `data` handleProcess sends.

const FORMATS = { vertical: '9:16 vertical', square: '1:1 square', horizontal: '16:9 horizontal', auto: 'auto' };

const clock = (s) => {
    const n = Math.max(0, Math.round(Number(s) || 0));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

export function describeJobSettings(data, { groq = false, model = 'Gemini' } = {}) {
    const source = data.type === 'url'
        ? data.payload
        : data.type === 'file' ? (data.payload?.name || 'uploaded file') : 'Thumbnail Studio';
    const min = data.clipMinSeconds || 15;
    const max = data.clipMaxSeconds || 60;
    const custom = data.clipMinSeconds || data.clipMaxSeconds;
    const items = [
        ['source', source],
        ['format', FORMATS[data.outputFormat] || data.outputFormat || 'auto'],
        ['layout', data.layout && data.layout !== 'auto' ? data.layout : 'auto'],
        ['clips', data.targetClips ? `aim for ${data.targetClips}` : 'AI decides'],
        ['length', `${min}–${max}s${custom ? '' : ' (default)'}`],
        ['hook', data.autoHook ? `on · ${data.autoHookStyle || 'pill'}` : 'off'],
        ['music', data.musicFile ? `${data.musicFile.name} · ${data.musicVolume ?? 15}%` : 'none'],
        ['transcription', groq ? 'Groq · whisper-large-v3-turbo' : 'local whisper'],
        ['clip picking', model],
    ];
    if (data.sourceStart != null || data.sourceEnd != null) {
        items.push(['stretch', `${clock(data.sourceStart || 0)} – ${data.sourceEnd != null ? clock(data.sourceEnd) : 'end'}`]);
    }
    if (data.maxMinutes) items.push(['first minutes', String(data.maxMinutes)]);
    return items;
}
