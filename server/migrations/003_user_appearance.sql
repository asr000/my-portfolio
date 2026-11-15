-- Per-account appearance preferences and uploaded assets.
BEGIN;

CREATE TABLE user_appearances (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  wallpaper_path text,
  wallpaper_content_type text
    CHECK (wallpaper_content_type IS NULL OR wallpaper_content_type IN ('image/webp', 'image/jpeg', 'image/png')),
  avatar_path text,
  avatar_content_type text
    CHECK (avatar_content_type IS NULL OR avatar_content_type IN ('image/webp', 'image/jpeg', 'image/png')),
  opacity numeric(3,2) NOT NULL DEFAULT 0.30 CHECK (opacity BETWEEN 0.10 AND 0.70),
  clarity smallint NOT NULL DEFAULT 92 CHECK (clarity BETWEEN 0 AND 100),
  theme_color text CHECK (theme_color IS NULL OR theme_color ~ '^#[0-9a-fA-F]{6}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((wallpaper_path IS NULL) = (wallpaper_content_type IS NULL)),
  CHECK ((avatar_path IS NULL) = (avatar_content_type IS NULL))
);

COMMIT;
