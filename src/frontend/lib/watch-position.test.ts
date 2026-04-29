import { describe, expect, it } from 'vitest';
import {
  RESUME_THRESHOLD_SECONDS,
  clearStoredPosition,
  formatTimeParam,
  loadStoredPosition,
  parseTimeParam,
  saveStoredPosition,
  shouldResumeAt,
} from './watch-position';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('parseTimeParam', () => {
  it('parses raw seconds', () => {
    expect(parseTimeParam('0')).toBe(0);
    expect(parseTimeParam('90')).toBe(90);
    expect(parseTimeParam('3600')).toBe(3600);
  });

  it('parses h/m/s suffix combos', () => {
    expect(parseTimeParam('1m30s')).toBe(90);
    expect(parseTimeParam('1h')).toBe(3600);
    expect(parseTimeParam('1h2m3s')).toBe(3723);
    expect(parseTimeParam('45s')).toBe(45);
    expect(parseTimeParam('2m')).toBe(120);
  });

  it('parses colon-form mm:ss and h:mm:ss', () => {
    expect(parseTimeParam('1:30')).toBe(90);
    expect(parseTimeParam('1:02:03')).toBe(3723);
    expect(parseTimeParam('0:05')).toBe(5);
  });

  it('returns null for garbage', () => {
    expect(parseTimeParam(null)).toBeNull();
    expect(parseTimeParam(undefined)).toBeNull();
    expect(parseTimeParam('')).toBeNull();
    expect(parseTimeParam('abc')).toBeNull();
    expect(parseTimeParam('1m2x')).toBeNull();
    expect(parseTimeParam('-30')).toBeNull();
  });
});

describe('formatTimeParam', () => {
  it('matches the format parseTimeParam expects (round-trip)', () => {
    for (const t of [0, 5, 60, 90, 3600, 3723, 7322]) {
      const formatted = formatTimeParam(t);
      expect(parseTimeParam(formatted)).toBe(t);
    }
  });

  it('strips empty segments', () => {
    expect(formatTimeParam(3600)).toBe('1h');
    expect(formatTimeParam(3661)).toBe('1h1m1s');
    expect(formatTimeParam(120)).toBe('2m');
  });

  it('clamps negatives and floors fractions', () => {
    expect(formatTimeParam(-5)).toBe('0s');
    expect(formatTimeParam(90.7)).toBe('1m30s');
  });
});

describe('shouldResumeAt', () => {
  it('returns null below the threshold', () => {
    expect(shouldResumeAt(RESUME_THRESHOLD_SECONDS - 1, 600)).toBeNull();
    expect(shouldResumeAt(0, 600)).toBeNull();
    expect(shouldResumeAt(null, 600)).toBeNull();
  });

  it('returns the stored time when comfortably mid-video', () => {
    expect(shouldResumeAt(120, 600)).toBe(120);
  });

  it('returns null when within the tail buffer', () => {
    expect(shouldResumeAt(595, 600)).toBeNull();
  });

  it('still returns when duration is unknown', () => {
    expect(shouldResumeAt(120, null)).toBe(120);
  });
});

describe('localStorage helpers', () => {
  it('round-trips a position', () => {
    const s = new MemoryStorage();
    saveStoredPosition('vid1', 42, s);
    expect(loadStoredPosition('vid1', s)).toBe(42);
  });

  it('returns null for unknown ids', () => {
    const s = new MemoryStorage();
    expect(loadStoredPosition('missing', s)).toBeNull();
  });

  it('clears a single entry', () => {
    const s = new MemoryStorage();
    saveStoredPosition('vid1', 42, s);
    saveStoredPosition('vid2', 84, s);
    clearStoredPosition('vid1', s);
    expect(loadStoredPosition('vid1', s)).toBeNull();
    expect(loadStoredPosition('vid2', s)).toBe(84);
  });

  it('caps stored entries at the max', () => {
    const s = new MemoryStorage();
    for (let i = 0; i < 60; i += 1) {
      saveStoredPosition(`vid${i}`, i, s);
    }
    const raw = JSON.parse(s.getItem('spooool:watch:positions:v1') ?? '{}') as Record<string, unknown>;
    expect(Object.keys(raw).length).toBeLessThanOrEqual(50);
  });

  it('survives malformed storage', () => {
    const s = new MemoryStorage();
    s.setItem('spooool:watch:positions:v1', 'not-json');
    expect(loadStoredPosition('vid', s)).toBeNull();
    saveStoredPosition('vid', 5, s);
    expect(loadStoredPosition('vid', s)).toBe(5);
  });

  it('ignores invalid positions', () => {
    const s = new MemoryStorage();
    saveStoredPosition('vid', Number.NaN, s);
    saveStoredPosition('vid', -5, s);
    expect(loadStoredPosition('vid', s)).toBeNull();
  });
});
