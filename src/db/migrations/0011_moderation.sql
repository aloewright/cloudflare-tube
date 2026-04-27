-- ALO-171: content moderation queue
--
-- `reports` is the user-submitted complaint surface (target = video|comment).
-- `moderation_actions` is the audit log of admin decisions, append-only.
-- `videos.hidden_at` lets admins hide a video without deleting it (404s to
-- non-owners). `user.banned_at` blocks sign-in via the session middleware.

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_user_id TEXT,
  target_type TEXT NOT NULL CHECK (target_type IN ('video', 'comment')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_user_id) REFERENCES user(id)
);

CREATE INDEX IF NOT EXISTS idx_reports_status_updated ON reports(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id TEXT PRIMARY KEY,
  report_id TEXT,
  admin_user_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approve', 'hide', 'ban', 'dismiss')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES reports(id),
  FOREIGN KEY (admin_user_id) REFERENCES user(id)
);

CREATE INDEX IF NOT EXISTS idx_moderation_actions_report ON moderation_actions(report_id);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_target ON moderation_actions(target_type, target_id);

ALTER TABLE videos ADD COLUMN hidden_at TEXT;
ALTER TABLE user ADD COLUMN banned_at INTEGER;
