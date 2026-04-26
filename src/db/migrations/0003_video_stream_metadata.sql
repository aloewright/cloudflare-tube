-- Cloudflare Stream emits webhook events that include playback and thumbnail
-- URLs once encoding completes. ALO-187 wires those fields into the videos
-- row so the watch page and feed can render thumbnails without an extra fetch.

ALTER TABLE videos ADD COLUMN playback_hls_url TEXT;
ALTER TABLE videos ADD COLUMN thumbnail_url TEXT;
