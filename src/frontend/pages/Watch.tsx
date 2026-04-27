import videojs from 'video.js';
import type Player from 'video.js/dist/types/player';
import 'video.js/dist/video-js.css';
import '../styles/videojs-strand.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Comments } from '../components/Comments';
import { useSession } from '../lib/auth-client';
import { keyToPlayerAction } from '../lib/player-keys';
import {
  formatTimeParam,
  loadStoredPosition,
  parseTimeParam,
  saveStoredPosition,
  shouldResumeAt,
} from '../lib/watch-position';

type VideoResponse = {
  id: string;
  title: string;
  description: string;
  view_count: number;
  channel_name?: string;
  channel_username?: string | null;
  stream_video_id?: string;
};

const POSITION_SAVE_INTERVAL_MS = 5_000;

export function Watch(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { data: session } = useSession();
  const [video, setVideo] = useState<VideoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [likes, setLikes] = useState<{ count: number; liked: boolean } | null>(null);
  const [likeBusy, setLikeBusy] = useState(false);
  const [likeError, setLikeError] = useState<string | null>(null);
  const [sub, setSub] = useState<{ subscribed: boolean; subscriberCount: number } | null>(null);
  const [subBusy, setSubBusy] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const videoEl = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<Player | null>(null);

  const tParam = searchParams.get('t');
  const startAt = useMemo(() => parseTimeParam(tParam), [tParam]);

  const playbackUrl = useMemo(() => {
    if (!video?.stream_video_id) {
      return '';
    }
    return `https://videodelivery.net/${video.stream_video_id}/manifest/video.m3u8`;
  }, [video?.stream_video_id]);

  useEffect(() => {
    if (!id) {
      setError('Missing video ID');
      return;
    }
    void fetch(`/api/videos/${id}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Failed to load video');
        }
        return (await response.json()) as VideoResponse;
      })
      .then((data) => setVideo(data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Unknown error'));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void fetch(`/api/videos/${encodeURIComponent(id)}/like`, { credentials: 'same-origin' })
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to load likes');
        return (await r.json()) as { likes: number; liked: boolean };
      })
      .then((data) => {
        if (!cancelled) setLikes({ count: data.likes, liked: data.liked });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id]);

  const channelUsername = video?.channel_username ?? null;

  useEffect(() => {
    if (!channelUsername) return;
    let cancelled = false;
    void fetch(
      `/api/channels/${encodeURIComponent(channelUsername)}/subscription`,
      { credentials: 'same-origin' },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to load subscription');
        return (await r.json()) as { subscribed: boolean; subscriberCount: number };
      })
      .then((data) => {
        if (!cancelled) setSub(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [channelUsername]);

  const toggleSubscribe = useCallback(async (): Promise<void> => {
    if (!channelUsername || subBusy) return;
    if (!session) {
      setSubError('Sign in to subscribe.');
      return;
    }
    const wasSubscribed = sub?.subscribed ?? false;
    setSubBusy(true);
    setSubError(null);
    try {
      const r = await fetch(
        `/api/channels/${encodeURIComponent(channelUsername)}/subscribe`,
        { method: wasSubscribed ? 'DELETE' : 'POST', credentials: 'same-origin' },
      );
      if (!r.ok) throw new Error('Failed to update subscription');
      setSub((s) => ({
        subscribed: !wasSubscribed,
        subscriberCount: Math.max(0, (s?.subscriberCount ?? 0) + (wasSubscribed ? -1 : 1)),
      }));
    } catch (err: unknown) {
      setSubError(err instanceof Error ? err.message : 'Failed to update subscription');
    } finally {
      setSubBusy(false);
    }
  }, [channelUsername, session, sub?.subscribed, subBusy]);

  const toggleLike = useCallback(async (): Promise<void> => {
    if (!id || likeBusy) return;
    if (!session) {
      setLikeError('Sign in to like videos.');
      return;
    }
    setLikeBusy(true);
    setLikeError(null);
    try {
      const r = await fetch(`/api/videos/${encodeURIComponent(id)}/like`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!r.ok) throw new Error('Failed to update like');
      const data = (await r.json()) as { likes: number; liked: boolean };
      setLikes({ count: data.likes, liked: data.liked });
    } catch (err: unknown) {
      setLikeError(err instanceof Error ? err.message : 'Failed to update like');
    } finally {
      setLikeBusy(false);
    }
  }, [id, likeBusy, session]);

  useEffect(() => {
    if (!videoEl.current || !playbackUrl) {
      return;
    }

    playerRef.current?.dispose();
    playerRef.current = videojs(videoEl.current, {
      controls: true,
      fluid: true,
      sources: [{ src: playbackUrl, type: 'application/x-mpegURL' }],
    });

    return () => {
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, [playbackUrl]);

  // ALO-146/147: seek to ?t= when present, otherwise resume from localStorage.
  // Runs once per loadedmetadata so we know the duration before deciding.
  useEffect(() => {
    const player = playerRef.current;
    if (!id || !player) return;
    let applied = false;
    const onLoaded = (): void => {
      if (applied) return;
      applied = true;
      const p = playerRef.current;
      if (!p) return;
      const duration = typeof p.duration === 'function' ? p.duration() ?? null : null;
      const stored = loadStoredPosition(id, window.localStorage);
      // ?t= wins over a resume position.
      const target = startAt != null ? startAt : shouldResumeAt(stored, duration);
      if (target != null && target > 0) {
        const safe = duration != null && duration > 0 ? Math.min(target, duration - 1) : target;
        p.currentTime(safe);
      }
    };
    player.on('loadedmetadata', onLoaded);
    return () => {
      player.off('loadedmetadata', onLoaded);
    };
  }, [id, playbackUrl, startAt]);

  // ALO-146: persist position. Save while playing on a 5s tick, on pause,
  // and on tab hide (which is when most viewers vanish without "ending").
  useEffect(() => {
    const player = playerRef.current;
    if (!id || !player) return;

    const persist = (): void => {
      const p = playerRef.current;
      if (!p) return;
      const t = typeof p.currentTime === 'function' ? p.currentTime() ?? 0 : 0;
      saveStoredPosition(id, t, window.localStorage);
    };
    const tick = (): void => {
      const p = playerRef.current;
      if (!p || p.paused()) return;
      persist();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') persist();
    };

    const interval = window.setInterval(tick, POSITION_SAVE_INTERVAL_MS);
    player.on('pause', persist);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      persist();
      player.off('pause', persist);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [id, playbackUrl]);

  // ALO-188: window-level keyboard shortcuts.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const action = keyToPlayerAction(event);
      if (!action) return;
      const p = playerRef.current;
      if (!p) return;
      event.preventDefault();
      switch (action.type) {
        case 'toggle-play':
          if (p.paused()) {
            void p.play();
          } else {
            p.pause();
          }
          return;
        case 'seek-relative': {
          const duration = typeof p.duration === 'function' ? p.duration() ?? 0 : 0;
          const current = typeof p.currentTime === 'function' ? p.currentTime() ?? 0 : 0;
          const next = Math.max(0, duration > 0 ? Math.min(current + action.seconds, duration) : current + action.seconds);
          p.currentTime(next);
          return;
        }
        case 'toggle-fullscreen':
          if (p.isFullscreen()) {
            void p.exitFullscreen();
          } else {
            void p.requestFullscreen();
          }
          return;
        case 'toggle-mute':
          p.muted(!p.muted());
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playbackUrl]);

  useEffect(() => {
    const player = playerRef.current;
    if (!id || !player) return;
    const HEARTBEAT_MS = 10_000;
    let lastTick = Date.now();

    const ping = (): void => {
      const p = playerRef.current;
      if (!p || p.paused()) {
        lastTick = Date.now();
        return;
      }
      const now = Date.now();
      const delta = Math.min(60, Math.max(0, (now - lastTick) / 1000));
      lastTick = now;
      if (delta < 1) return;
      const position = typeof p.currentTime === 'function' ? p.currentTime() ?? 0 : 0;
      void fetch(`/api/videos/${encodeURIComponent(id)}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta, position }),
        credentials: 'same-origin',
        keepalive: true,
      }).catch(() => undefined);
    };

    const interval = window.setInterval(ping, HEARTBEAT_MS);
    const onPlay = (): void => {
      lastTick = Date.now();
    };
    player.on('play', onPlay);
    return () => {
      window.clearInterval(interval);
      ping();
      player.off('play', onPlay);
    };
  }, [id, playbackUrl]);

  const shareAtCurrentTime = useCallback(async (): Promise<void> => {
    const p = playerRef.current;
    if (!p) return;
    const t = typeof p.currentTime === 'function' ? Math.floor(p.currentTime() ?? 0) : 0;
    const url = new URL(window.location.href);
    if (t > 0) {
      url.searchParams.set('t', formatTimeParam(t));
    } else {
      url.searchParams.delete('t');
    }
    try {
      await navigator.clipboard.writeText(url.toString());
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable on insecure contexts; fall back to
      // updating the address bar so the user can copy manually.
      window.history.replaceState(null, '', url.toString());
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    }
  }, []);

  if (error) {
    return (
      <main className="app-main stack">
        <p className="status-error">{error}</p>
      </main>
    );
  }

  if (!video) {
    return (
      <main className="app-main stack">
        <p className="ds-meta">Loading…</p>
      </main>
    );
  }

  return (
    <main className="app-main stack-lg fade-in">
      <div
        className="card--tight"
        style={{
          padding: 0,
          overflow: 'hidden',
          borderRadius: 'var(--radius-2xl)',
          border: '1px solid color-mix(in oklch, var(--border), transparent 30%)',
          background: 'oklch(0 0 0)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <video ref={videoEl} className="video-js vjs-big-play-centered vjs-strand" />
      </div>
      <div className="stack-sm">
        <h1 className="ds-h2">{video.title}</h1>
        <div className="row">
          <span className="badge">{video.view_count} views</span>
          <span className="badge">{video.channel_name ?? 'Unknown channel'}</span>
        </div>
      </div>
      <p>{video.description}</p>
      <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={likes?.liked ? 'btn' : 'btn btn--secondary'}
          onClick={() => {
            void toggleLike();
          }}
          disabled={likeBusy}
          aria-pressed={likes?.liked ?? false}
        >
          {likes?.liked ? '♥ Liked' : '♡ Like'}
          {likes ? ` · ${likes.count}` : ''}
        </button>
        <button
          type="button"
          className={sub?.subscribed ? 'btn btn--secondary' : 'btn'}
          onClick={() => {
            void toggleSubscribe();
          }}
          disabled={subBusy || !channelUsername}
          aria-pressed={sub?.subscribed ?? false}
        >
          {sub?.subscribed ? 'Subscribed' : 'Subscribe'}
          {sub ? ` · ${sub.subscriberCount}` : ''}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            void shareAtCurrentTime();
          }}
          aria-live="polite"
        >
          {shareCopied ? 'Link copied' : 'Share at current time'}
        </button>
      </div>
      {likeError ? <p className="status-error">{likeError}</p> : null}
      {subError ? <p className="status-error">{subError}</p> : null}
      <p className="ds-meta">
        Shortcuts: space/k play · j/l ±10s · ←/→ ±5s · f fullscreen · m mute
      </p>
      {id ? <Comments videoId={id} /> : null}
    </main>
  );
}
