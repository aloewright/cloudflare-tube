import { Badge, Button, Surface } from '@cloudflare/kumo';
import videojs from 'video.js';
import type Player from 'video.js/dist/types/player';
import 'video.js/dist/video-js.css';
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

  if (error) {
    return <Surface className="p-4">{error}</Surface>;
  }

  if (!video) {
    return <Surface className="p-4">Loading…</Surface>;
  }

  return (
    <Surface className="p-4 space-y-3">
      <div>
        <video ref={videoEl} className="video-js vjs-big-play-centered" />
      </div>
      <h1>{video.title}</h1>
      <div className="flex gap-2">
        <Badge>{video.view_count} views</Badge>
        <Badge>{video.channel_name ?? 'Unknown Channel'}</Badge>
      </div>
      <p>{video.description}</p>
      <Button>Subscribe</Button>
    </Surface>
  );
}
