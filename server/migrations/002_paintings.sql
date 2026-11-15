-- Public painting gallery managed by the site author.
BEGIN;

CREATE TABLE paintings (
  id uuid PRIMARY KEY,
  title text NOT NULL
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 120)
    CHECK (title = btrim(title))
    CHECK (title !~ '[[:cntrl:]]'),
  image_path text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/webp', 'image/jpeg', 'image/png')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX paintings_public_order_idx ON paintings(created_at DESC, id DESC);

COMMIT;
