import { describe, expect, it } from 'vitest';
import { keyToPlayerAction } from './player-keys';

describe('keyToPlayerAction', () => {
  it('maps space and k to toggle-play', () => {
    expect(keyToPlayerAction({ key: ' ' })).toEqual({ type: 'toggle-play' });
    expect(keyToPlayerAction({ key: 'k' })).toEqual({ type: 'toggle-play' });
    expect(keyToPlayerAction({ key: 'K' })).toEqual({ type: 'toggle-play' });
  });

  it('maps j/l to ±10s and arrows to ±5s', () => {
    expect(keyToPlayerAction({ key: 'j' })).toEqual({ type: 'seek-relative', seconds: -10 });
    expect(keyToPlayerAction({ key: 'l' })).toEqual({ type: 'seek-relative', seconds: 10 });
    expect(keyToPlayerAction({ key: 'ArrowLeft' })).toEqual({ type: 'seek-relative', seconds: -5 });
    expect(keyToPlayerAction({ key: 'ArrowRight' })).toEqual({ type: 'seek-relative', seconds: 5 });
  });

  it('maps f and m to fullscreen + mute', () => {
    expect(keyToPlayerAction({ key: 'f' })).toEqual({ type: 'toggle-fullscreen' });
    expect(keyToPlayerAction({ key: 'm' })).toEqual({ type: 'toggle-mute' });
  });

  it('returns null for unknown keys', () => {
    expect(keyToPlayerAction({ key: 'a' })).toBeNull();
    expect(keyToPlayerAction({ key: 'Enter' })).toBeNull();
  });

  it('returns null when modifier keys are held (so browser shortcuts win)', () => {
    expect(keyToPlayerAction({ key: 'k', metaKey: true })).toBeNull();
    expect(keyToPlayerAction({ key: 'l', ctrlKey: true })).toBeNull();
    expect(keyToPlayerAction({ key: 'f', altKey: true })).toBeNull();
  });

  it('returns null when typing in form fields', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(keyToPlayerAction({ key: 'k', target: { tagName: tag } as unknown as EventTarget })).toBeNull();
    }
    expect(
      keyToPlayerAction({
        key: 'k',
        target: { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget,
      }),
    ).toBeNull();
  });

  it('still fires on non-typing targets like buttons', () => {
    expect(
      keyToPlayerAction({ key: 'k', target: { tagName: 'BUTTON' } as unknown as EventTarget }),
    ).toEqual({ type: 'toggle-play' });
  });
});
