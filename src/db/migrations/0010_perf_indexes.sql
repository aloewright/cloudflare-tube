-- Performance indexes (ALO-200, parent ALO-198)
--
-- The trending feed (`/api/videos/trending`) does:
--   LEFT JOIN views ON views.video_id = v.id
--     AND views.viewed_at >= datetime('now', '-7 days')
-- The existing single-column idx_views_video_id can satisfy the JOIN equality
-- but the date range still requires reading every row for that video. The
-- composite (video_id, viewed_at) lets SQLite seek directly to the slice of
-- recent views per video in O(log n + k).
CREATE INDEX IF NOT EXISTS idx_views_video_viewed_at
  ON views(video_id, viewed_at);

-- Every videos query filters `WHERE deleted_at IS NULL` and most order by
-- created_at DESC. A composite (deleted_at, created_at DESC) lets SQLite seek
-- to NULL deleted_at rows then walk created_at backwards without a separate
-- sort.
CREATE INDEX IF NOT EXISTS idx_videos_active_created
  ON videos(deleted_at, created_at DESC);
