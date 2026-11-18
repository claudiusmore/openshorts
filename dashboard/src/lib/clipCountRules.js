// Clips per video by source length, set in Settings. Each row is
// { up_to_minutes, min, max }; a blank up_to_minutes is the "longer" row.
const STORAGE_KEY = 'os_clip_count_rules';

export const DEFAULT_CLIP_COUNT_RULES = [
  { up_to_minutes: 5, min: 3, max: 6 },
  { up_to_minutes: 15, min: 6, max: 10 },
  { up_to_minutes: '', min: 8, max: 12 },
];

const isBlank = (v) => v === '' || v == null;

export function validateClipCountRules(rows) {
  let catchAll = 0;
  for (const r of rows) {
    if (isBlank(r.up_to_minutes)) catchAll += 1;
    else if (!(Number(r.up_to_minutes) > 0)) return 'minutes must be above 0';
    const lo = Number(r.min);
    const hi = Number(r.max);
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || lo > hi) {
      return 'clips need 1 ≤ min ≤ max';
    }
  }
  if (catchAll > 1) return 'only one row can be "longer"';
  return '';
}

export function normalizeClipCountRules(rows) {
  return rows
    .map((r) => ({
      up_to_minutes: isBlank(r.up_to_minutes) ? null : Number(r.up_to_minutes),
      min: Number(r.min),
      max: Number(r.max),
    }))
    .sort((a, b) => (a.up_to_minutes ?? Infinity) - (b.up_to_minutes ?? Infinity));
}

export function savedClipCountRules() {
  try {
    const rows = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(rows) && !validateClipCountRules(rows) ? normalizeClipCountRules(rows) : [];
  } catch {
    return [];
  }
}

export function storeClipCountRules(rows) {
  try {
    if (rows.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeClipCountRules(rows)));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}
