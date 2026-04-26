-- ALO-150: full-text search over videos using FTS5.
-- Index title + description + channel name; keep in sync via triggers so
-- writes to videos and renames on user.name reflect immediately.

CREATE VIRTUAL TABLE IF NOT EXISTS videos_fts USING fts5(
  video_id UNINDEXED,
  title,
  description,
  channel_name,
  tokenize = "unicode61 remove_diacritics 2"
);

-- Backfill existing non-deleted videos.
INSERT INTO videos_fts (video_id, title, description, channel_name)
  SELECT v.id, v.title, v.description, COALESCE(u.name, '')
  FROM videos v
  LEFT JOIN user u ON u.id = v.user_id
  WHERE v.deleted_at IS NULL;

CREATE TRIGGER IF NOT EXISTS videos_fts_ai AFTER INSERT ON videos
WHEN new.deleted_at IS NULL
BEGIN
  INSERT INTO videos_fts (video_id, title, description, channel_name)
  VALUES (
    new.id,
    new.title,
    new.description,
    COALESCE((SELECT name FROM user WHERE id = new.user_id), '')
  );
END;

-- Only resync when an indexed column or ownership/soft-delete state changes.
-- Skipping general UPDATEs avoids re-indexing on every view-count increment.
CREATE TRIGGER IF NOT EXISTS videos_fts_au
AFTER UPDATE OF title, description, user_id, deleted_at ON videos
BEGIN
  DELETE FROM videos_fts WHERE video_id = old.id;
  INSERT INTO videos_fts (video_id, title, description, channel_name)
    SELECT new.id, new.title, new.description, COALESCE(u.name, '')
    FROM (SELECT 1) AS s LEFT JOIN user u ON u.id = new.user_id
    WHERE new.deleted_at IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS videos_fts_ad AFTER DELETE ON videos BEGIN
  DELETE FROM videos_fts WHERE video_id = old.id;
END;

-- When a creator renames their channel, refresh all of their video rows.
CREATE TRIGGER IF NOT EXISTS user_name_videos_fts
AFTER UPDATE OF name ON user
BEGIN
  DELETE FROM videos_fts WHERE video_id IN (SELECT id FROM videos WHERE user_id = new.id);
  INSERT INTO videos_fts (video_id, title, description, channel_name)
    SELECT v.id, v.title, v.description, new.name
    FROM videos v
    WHERE v.user_id = new.id AND v.deleted_at IS NULL;
END;
