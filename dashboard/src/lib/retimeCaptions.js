// Re-times edited caption words against the transcript's own word timings.
//
// The editor used to spread the edited words evenly over the clip, so a single
// fixed comma made every caption drift off the speech. Instead the new words
// are aligned to the originals (longest common subsequence on a normalised
// form, so case and punctuation edits still match):
//   - an unchanged word keeps its own timestamps;
//   - a run of replaced words takes the span of the words it replaced;
//   - inserted words share the gap between their neighbours, or the previous
//     word's span when the neighbours touch;
//   - deleted words simply drop out.

const MIN_WORD_MS = 80;

const norm = (w) => String(w || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function spread(words, startMs, endMs) {
    const step = (endMs - startMs) / words.length;
    return words.map((text, k) => ({
        text,
        startMs: Math.round(startMs + k * step),
        endMs: Math.round(startMs + (k + 1) * step),
    }));
}

export function retimeEditedWords(original, newWords) {
    if (!newWords.length || !original.length) return [];
    const a = original.map((c) => norm(c.text));
    const b = newWords.map(norm);
    const n = a.length;
    const m = b.length;

    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] && a[i] === b[j]
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const matches = [];
    for (let i = 0, j = 0; i < n && j < m;) {
        if (a[i] && a[i] === b[j]) { matches.push([i, j]); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
        else j++;
    }
    matches.push([n, m]); // sentinel closes the trailing gap

    const out = [];
    let i0 = 0;
    let j0 = 0;
    for (const [i1, j1] of matches) {
        const gapWords = newWords.slice(j0, j1);
        if (gapWords.length) {
            if (i1 > i0) {
                // Replaced run: same count maps one-to-one, otherwise share the span.
                if (i1 - i0 === gapWords.length) {
                    gapWords.forEach((text, k) => out.push({
                        text, startMs: original[i0 + k].startMs, endMs: original[i0 + k].endMs,
                    }));
                } else {
                    out.push(...spread(gapWords, original[i0].startMs, original[i1 - 1].endMs));
                }
            } else {
                // Pure insertion between two kept words.
                const prev = out[out.length - 1];
                const start = prev ? prev.endMs : original[0].startMs;
                const end = i1 < n ? original[i1].startMs : original[n - 1].endMs;
                if (end - start >= MIN_WORD_MS * gapWords.length) {
                    out.push(...spread(gapWords, start, end));
                } else if (prev) {
                    out.pop();
                    out.push(...spread([prev.text, ...gapWords], prev.startMs, Math.max(prev.endMs, end)));
                } else {
                    const next = original[Math.min(i1, n - 1)];
                    out.push(...spread(gapWords, start, Math.max(start + MIN_WORD_MS * gapWords.length, next.startMs)));
                }
            }
        }
        if (j1 < m) out.push({ text: newWords[j1], startMs: original[i1].startMs, endMs: original[i1].endMs });
        i0 = i1 + 1;
        j0 = j1 + 1;
    }
    return out;
}
