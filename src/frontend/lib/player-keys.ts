// ALO-188: keyboard shortcut translation. The handler is defined as a pure
// function so it's testable without a DOM, and so the Watch page only owns
// the side-effect plumbing.
export type PlayerKeyAction =
  | { type: 'toggle-play' }
  | { type: 'seek-relative'; seconds: number }
  | { type: 'toggle-fullscreen' }
  | { type: 'toggle-mute' };

interface KeyEventLike {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  target?: EventTarget | null;
}

function isTypingTarget(target: EventTarget | null | undefined): boolean {
  if (!target) return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable === true) return true;
  return false;
}

export function keyToPlayerAction(event: KeyEventLike): PlayerKeyAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (isTypingTarget(event.target ?? null)) return null;

  switch (event.key) {
    case ' ':
    case 'Spacebar':
    case 'k':
    case 'K':
      return { type: 'toggle-play' };
    case 'j':
    case 'J':
      return { type: 'seek-relative', seconds: -10 };
    case 'l':
    case 'L':
      return { type: 'seek-relative', seconds: 10 };
    case 'ArrowLeft':
      return { type: 'seek-relative', seconds: -5 };
    case 'ArrowRight':
      return { type: 'seek-relative', seconds: 5 };
    case 'f':
    case 'F':
      return { type: 'toggle-fullscreen' };
    case 'm':
    case 'M':
      return { type: 'toggle-mute' };
    default:
      return null;
  }
}
