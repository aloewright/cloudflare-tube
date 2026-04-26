import videojs from 'video.js';
import type Player from 'video.js/dist/types/player';
import 'video.js/dist/video-js.css';
import '../styles/videojs-strand.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

type VideoResponse = {
  id: string;
  title: string;
  description: string;
  view_count: number;
  channel_name?: string;
  stream_video_id?: string;
};

export function Watch(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [video, setVideo] = useState<VideoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      <div>
        <button type="button" className="btn">
          Subscribe
        </button>
      </div>
    </main>
  );
}
