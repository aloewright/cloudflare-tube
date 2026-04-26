// ALO-154: lightweight, deterministic spam pre-filter for comments.
// Designed as a hook so we can swap in an AI Gateway dynamic-route classifier
// later without touching call sites.

export interface SpamCheckResult {
  blocked: boolean;
  reason?: 'too_short' | 'link_spam' | 'all_caps' | 'repeat_chars';
}

const URL_RE = /https?:\/\/\S+/gi;

export function isLikelySpam(body: string): SpamCheckResult {
  const trimmed = body.trim();
  if (trimmed.length === 0) return { blocked: true, reason: 'too_short' };

  // > 3 links in a single comment is almost always spam at this scale.
  const urlMatches = trimmed.match(URL_RE);
  if (urlMatches && urlMatches.length > 3) {
    return { blocked: true, reason: 'link_spam' };
  }

  // ALL-CAPS shouting longer than ~20 letters.
  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  if (letters.length > 20 && letters === letters.toUpperCase()) {
    return { blocked: true, reason: 'all_caps' };
  }

  // Same character repeated >= 12 times in a row (zalgo-ish floods).
  if (/(.)\1{11,}/.test(trimmed)) {
    return { blocked: true, reason: 'repeat_chars' };
  }

  return { blocked: false };
}
