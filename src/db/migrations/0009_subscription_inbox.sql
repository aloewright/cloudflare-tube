-- ALO-156: subscriber inbox populated by ChannelSubscriberDO when a creator
-- uploads a new video. Composite PK lets us idempotently re-fan-out, and the
-- index supports the inbox feed query.

CREATE TABLE IF NOT EXISTS subscription_inbox (
  subscriber_user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  seen_at TEXT,
  PRIMARY KEY (subscriber_user_id, video_id),
  FOREIGN KEY (subscriber_user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (video_id) REFERENCES videos(id),
  FOREIGN KEY (channel_user_id) REFERENCES user(id)
);

CREATE INDEX IF NOT EXISTS idx_inbox_user_added
  ON subscription_inbox(subscriber_user_id, added_at DESC);
