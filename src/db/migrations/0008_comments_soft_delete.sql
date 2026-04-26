-- ALO-154: soft-delete column for comments so authors can remove without
-- breaking reply parent references.

ALTER TABLE comments ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_video_created ON comments(video_id, created_at DESC);
