-- Public homepage introduction, shared across devices.
CREATE TABLE IF NOT EXISTS site_about (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  content text NOT NULL CHECK (char_length(content) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
