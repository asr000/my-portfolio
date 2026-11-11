# Portfolio API

The browser app uses this Node API for accounts, records, invitations, cover files, and daily check-ins. PostgreSQL stays on the same server and is not exposed to the internet. The Node process listens only on `127.0.0.1:3001`; Caddy is the public HTTPS entry point.

## Local development on Windows

1. Keep the SSH tunnel to PostgreSQL open on local port `5433`.
2. Copy `.env.example` to `.env.local` and fill in the database password. Add the QQ SMTP values and set `AUTHOR_EMAIL` to the email that will own the site.
3. For local email-link testing, set `APP_BASE_URL=http://localhost:5173`. After deployment, set it to the public Netlify site URL.
4. In this folder, run `npm install` once and `npm run dev`.
5. In another terminal at the repository root, run `npm run dev`. Vite forwards `/api/*` to `127.0.0.1:3001`.

Do not put `.env.local` in Git or send its values in chat.

## Production files

The example deployment files assume the repository is at `/home/tap000/my-portfolio`, the system account is `tap000`, the API domain is `pub.lonnet.uk`, and PostgreSQL listens on `127.0.0.1:5432`. Edit the service and Caddyfile if any of those are different.

- `.env.production.example` is a template for `/etc/portfolio-api.env`. Use the server PostgreSQL port `5432`, not the Windows tunnel port `5433`.
- `deploy/portfolio-api.service` runs the API as `tap000` and stores cover images under `/var/lib/portfolio-api/covers`.
- `deploy/Caddyfile` proxies HTTPS requests to the loopback-only Node process.
- The repository `netlify.toml` proxies the browser's `/api/*` requests to `https://pub.lonnet.uk/api/*`.

Before enabling the Netlify proxy, confirm that `pub.lonnet.uk` resolves to this server, HTTP/HTTPS traffic can reach it, and Caddy has obtained a valid TLS certificate. Keep port `3001` private; expose ports `80` and `443` for Caddy.

## Account and record migration

Old Supabase passwords, sessions, invitation codes, and account IDs are not imported. Each person creates a new account and verifies the email. Set `AUTHOR_EMAIL` before the owner's first registration so that account receives author permissions. The author must re-issue invitations to other people.

Each account imports its own JSON or ZIP export from the site's Data Backup page after email verification and note access are enabled. ZIP imports restore included cover files. JSON imports restore text and metadata but have no cover images. Import adds records without overwriting existing IDs. Passwords, sessions, invite codes, check-in history, and first-publication history are not included in the record backup. Keep the old site and Supabase available until each account has checked its imported records.

## Current service limitations

- Registration and password recovery require the configured SMTP server.
- Cover files are local files; back up `/var/lib/portfolio-api/covers` along with PostgreSQL.
- Configure regular PostgreSQL backups and a server restore procedure before relying on this as the only copy of the records.
