// ALO-146: resume-from-last-position state. Stored in localStorage so it
// works for anonymous viewers; when authenticated watch-history lands we'll
// migrate this to a server-side store.
const STORAGE_KEY = 'spooool:watch:positions:v1';
const MAX_ENTRIES = 50;

// Don't bother resuming for the first few seconds — likely you tapped through.
export const RESUME_THRESHOLD_SECONDS = 10;
// Don't resume if we'd push you within 15s of the end.
export const RESUME_TAIL_BUFFER_SECONDS = 15;

type PositionMap = Record<string, { p: number; t: number }>;

function readMap(storage: Storage): PositionMap {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as unknown;
    if (data && typeof data === 'object') return data as PositionMap;
    return {};
  } catch {
    return {};
  }
}

export function loadStoredPosition(videoId: string, storage: Storage): number | null {
  const entry = readMap(storage)[videoId];
  return entry && typeof entry.p === 'number' ? entry.p : null;
}

export function saveStoredPosition(videoId: string, position: number, storage: Storage): void {
  if (!Number.isFinite(position) || position < 0) return;
  try {
    const data = readMap(storage);
    data[videoId] = { p: Math.floor(position), t: Date.now() };
    const ids = Object.keys(data);
    if (ids.length > MAX_ENTRIES) {
      ids
        .map((id) => ({ id, t: data[id]?.t ?? 0 }))
        .sort((a, b) => b.t - a.t)
        .slice(MAX_ENTRIES)
        .forEach(({ id }) => delete data[id]);
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full / disabled — drop silently. We'll re-save on the next tick.
  }
}

export function clearStoredPosition(videoId: string, storage: Storage): void {
  try {
    const data = readMap(storage);
    if (videoId in data) {
      delete data[videoId];
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  } catch {
    // ignore
  }
}

export function shouldResumeAt(stored: number | null, duration: number | null): number | null {
  if (stored == null) return null;
  if (stored < RESUME_THRESHOLD_SECONDS) return null;
  if (duration != null && duration > 0 && stored >= duration - RESUME_TAIL_BUFFER_SECONDS) {
    return null;
  }
  return stored;
}

// ALO-147: timestamped share links. Accept ?t= in seconds (90), suffix combos
// (1m30s, 1h2m3s), and colon-form (1:30, 1:02:03). Anything else returns null.
export function parseTimeParam(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return null;

  if (/^\d+(:\d+){1,2}$/.test(trimmed)) {
    const parts = trimmed.split(':').map((n) => Number.parseInt(n, 10));
    if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
    let secs = 0;
    for (const p of parts) secs = secs * 60 + p;
    return secs;
  }

  if (/^\d+$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  const combo = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(trimmed);
  if (combo && combo.slice(1).some((g) => g != null)) {
    const h = Number.parseInt(combo[1] ?? '0', 10);
    const m = Number.parseInt(combo[2] ?? '0', 10);
    const s = Number.parseInt(combo[3] ?? '0', 10);
    return h * 3600 + m * 60 + s;
  }

  return null;
}

export function formatTimeParam(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total === 0) return '0s';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  let out = '';
  if (h > 0) out += `${h}h`;
  if (m > 0) out += `${m}m`;
  if (s > 0 || out === '') out += `${s}s`;
  return out;
}
