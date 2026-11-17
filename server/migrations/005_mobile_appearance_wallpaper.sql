-- Store a separately cropped wallpaper for narrow phone screens.
BEGIN;

ALTER TABLE user_appearances
  ADD COLUMN IF NOT EXISTS mobile_wallpaper_path text,
  ADD COLUMN IF NOT EXISTS mobile_wallpaper_content_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'user_appearances'::regclass
       AND conname = 'user_appearances_mobile_wallpaper_content_type_check'
  ) THEN
    ALTER TABLE user_appearances
      ADD CONSTRAINT user_appearances_mobile_wallpaper_content_type_check
      CHECK (mobile_wallpaper_content_type IS NULL OR
             mobile_wallpaper_content_type IN ('image/webp', 'image/jpeg', 'image/png'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'user_appearances'::regclass
       AND conname = 'user_appearances_mobile_wallpaper_pair_check'
  ) THEN
    ALTER TABLE user_appearances
      ADD CONSTRAINT user_appearances_mobile_wallpaper_pair_check
      CHECK ((mobile_wallpaper_path IS NULL) = (mobile_wallpaper_content_type IS NULL));
  END IF;
END $$;

COMMIT;
