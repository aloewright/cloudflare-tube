-- ALO-170: DMCA takedown workflow.
--
-- LEGAL-REVIEW: this entire workflow needs counsel sign-off before public
-- launch. The forms and templates are placeholders; the schema is the
-- engineering surface that copy will be plugged into.
--
-- `dmca_claims` stores complainant submissions per 17 U.S.C. § 512(c)(3).
-- `dmca_counter_notices` stores uploader counter-notices per § 512(g).
-- `videos.dmca_status` is the per-video disable flag — rendered as a 451
-- response from /api/videos/:id and a notice page in the SPA.
-- `videos.dmca_restore_eligible_at` is set when a counter-notice clears
-- review, after which the daily cron auto-restores if no court order arrives.

CREATE TABLE IF NOT EXISTS dmca_claims (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  complainant_name TEXT NOT NULL,
  complainant_email TEXT NOT NULL,
  complainant_address TEXT NOT NULL,
  complainant_phone TEXT NOT NULL,
  copyrighted_work TEXT NOT NULL,
  infringing_urls TEXT NOT NULL,
  good_faith_signed INTEGER NOT NULL DEFAULT 0,
  perjury_signed INTEGER NOT NULL DEFAULT 0,
  signature TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'disabled', 'dismissed', 'counter_pending', 'restored')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (video_id) REFERENCES videos(id)
);

CREATE INDEX IF NOT EXISTS idx_dmca_claims_status ON dmca_claims(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_dmca_claims_video ON dmca_claims(video_id);

CREATE TABLE IF NOT EXISTS dmca_counter_notices (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  uploader_user_id TEXT NOT NULL,
  uploader_name TEXT NOT NULL,
  uploader_address TEXT NOT NULL,
  uploader_phone TEXT NOT NULL,
  uploader_email TEXT NOT NULL,
  statement TEXT NOT NULL,
  signature TEXT NOT NULL,
  consent_to_jurisdiction INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES dmca_claims(id),
  FOREIGN KEY (uploader_user_id) REFERENCES user(id)
);

CREATE INDEX IF NOT EXISTS idx_dmca_counter_claim ON dmca_counter_notices(claim_id);

ALTER TABLE videos ADD COLUMN dmca_status TEXT;
ALTER TABLE videos ADD COLUMN dmca_restore_eligible_at INTEGER;
