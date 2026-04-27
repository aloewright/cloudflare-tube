import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';
import type { Metric } from 'web-vitals';

const RUM_ENDPOINT = '/api/rum';

type RumPayload = {
  name: string;
  value: number;
  delta: number;
  id: string;
  rating: string;
  navigationType: string;
  path: string;
};

function send(metric: Metric): void {
  const payload: RumPayload = {
    name: metric.name,
    value: metric.value,
    delta: metric.delta,
    id: metric.id,
    rating: metric.rating,
    navigationType: metric.navigationType,
    path: window.location.pathname,
  };
  const body = JSON.stringify(payload);

  // sendBeacon is a single-shot fire-and-forget POST that survives
  // pagehide/visibilitychange — exactly what we need for INP and LCP
  // which can fire as the user navigates away.
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon(RUM_ENDPOINT, blob)) return;
  }

  // Best-effort fallback. keepalive lets the request outlive page transitions
  // when sendBeacon isn't available.
  void fetch(RUM_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export function startRum(): void {
  onCLS(send);
  onFCP(send);
  onINP(send);
  onLCP(send);
  onTTFB(send);
}
