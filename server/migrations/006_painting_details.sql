-- Optional details for existing and new paintings.
BEGIN;
ALTER TABLE paintings
  ADD COLUMN IF NOT EXISTS duration_text text CHECK (char_length(duration_text) <= 40),
  ADD COLUMN IF NOT EXISTS stroke_count integer CHECK (stroke_count >= 0),
  ADD COLUMN IF NOT EXISTS description text CHECK (char_length(description) <= 1000);
COMMIT;
