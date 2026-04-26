-- ALO-137: store auto-generated thumbnail candidates so creators can pick one
-- without re-encoding. Custom uploads override this and live in R2 under
-- `thumbnails/<userId>/<videoId>/<uuid>.<ext>`.

ALTER TABLE videos ADD COLUMN thumbnail_candidates TEXT;
