-- Allow wallpaper opacity up to 100% for databases created before the range was expanded.
BEGIN;

ALTER TABLE user_appearances
  DROP CONSTRAINT IF EXISTS user_appearances_opacity_check;

ALTER TABLE user_appearances
  ADD CONSTRAINT user_appearances_opacity_check
  CHECK (opacity BETWEEN 0.10 AND 1.00);

COMMIT;
