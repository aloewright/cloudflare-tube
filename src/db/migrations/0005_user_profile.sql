-- ALO-131: profile fields owned by spooool (better-auth still owns
-- name/email/image but we add channel-facing presentation fields).

ALTER TABLE user ADD COLUMN username TEXT;
ALTER TABLE user ADD COLUMN displayName TEXT;
ALTER TABLE user ADD COLUMN bio TEXT;
ALTER TABLE user ADD COLUMN avatarUrl TEXT;
ALTER TABLE user ADD COLUMN bannerUrl TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_username ON user(username);
