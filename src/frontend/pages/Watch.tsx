import videojs from 'video.js';
import type Player from 'video.js/dist/types/player';
import 'video.js/dist/video-js.css';
import '../styles/videojs-strand.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSession } from '../lib/auth-client';

type VideoResponse = {
  id: string;
  title: string;
  description: string;
  view_count: number;
  channel_name?: string;
  channel_username?: string | null;
  stream_video_id?: string;
};

export function Watch(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const [video, setVideo] = useState<VideoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [likes, setLikes] = useState<{ count: number; liked: boolean } | null>(null);
  const [likeBusy, setLikeBusy] = useState(false);
  const [likeError, setLikeError] = useState<string | null>(null);
  const [sub, setSub] = useState<{ subscribed: boolean; subscriberCount: number } | null>(null);
  const [subBusy, setSubBusy] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);
  const videoEl = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<Player | null>(null);

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
      </div>
      {likeError ? <p className="status-error">{likeError}</p> : null}
      {subError ? <p className="status-error">{subError}</p> : null}
    </main>
  );
}
