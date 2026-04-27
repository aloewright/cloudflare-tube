-- ALO-132: GDPR-compliant soft-delete with 30-day grace window.
--
-- `deletion_requested_at` is when the user clicked "delete" in settings;
-- `deletion_scheduled_for` is when the daily cron will hard-delete (now + 30d).
-- Both reset to NULL when the user cancels within the grace window.
-- Stored as INTEGER ms-since-epoch to match better-auth's `createdAt`/`updatedAt`.

ALTER TABLE user ADD COLUMN deletion_requested_at INTEGER;
ALTER TABLE user ADD COLUMN deletion_scheduled_for INTEGER;

CREATE INDEX IF NOT EXISTS idx_user_deletion_scheduled
  ON user(deletion_scheduled_for)
  WHERE deletion_scheduled_for IS NOT NULL;
