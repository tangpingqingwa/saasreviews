# SaaSReviews — one-VPS runbook

Single Docker host. SQLite on a named volume. Adapters stay on recorded fixtures until you opt into live G2/Capterra.

## Env

Copy [`.env.example`](../.env.example) to `/etc/saasreviews.env` (mode `600`). Set:

| Variable | Production |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | listen port (default `3000`) |
| `SAASREVIEWS_DATABASE` | required; must sit on the volume, e.g. `/app/data/saasreviews.sqlite` |
| `SAASREVIEWS_BOOTSTRAP_KEY` | optional first `sr_live_...` when the keys table is empty |
| `SAASREVIEWS_LIVE_DIRECTORIES` | leave `0` (or unset) until soak |

Do not bake secrets into the image. Do not commit `.env`. A bind-mount over `/app/data` must be writable by uid `1000` (`node`).

## Build and run

```bash
docker build -t saasreviews:local .
docker run -d --name saasreviews --restart unless-stopped --init \
  --env-file /etc/saasreviews.env \
  -p 127.0.0.1:3000:3000 \
  -v saasreviews-data:/app/data \
  saasreviews:local
```

The process listens on `0.0.0.0:$PORT` as the non-root `node` user (uid 1000). The data volume must be writable by that uid. Keep the published port on loopback and terminate TLS on Caddy or nginx.

## Health

`GET /healthz` → `200 {"ok":true}`. No auth.

```bash
curl -fsS "http://127.0.0.1:${PORT:-3000}/healthz"
```

After bootstrap:

```bash
curl -fsS -H "Authorization: Bearer $SAASREVIEWS_BOOTSTRAP_KEY" \
  "http://127.0.0.1:${PORT:-3000}/v1/me"
```

## Enable live directories

1. Confirm `/healthz` is green with live off (fixtures only).
2. Set `SAASREVIEWS_LIVE_DIRECTORIES=1` in the env file (also `true` / `yes`).
3. Recreate the container. Only public G2 and Capterra HTML is fetched.
4. Bot wall / 403 / 429 / 5xx are `upstream_blocked` (0 credits). Missing overall stays `null`.
5. Leave the flag unset in CI. `scripts/test.sh` sets `SAASREVIEWS_FIXTURE_ONLY=1` and never fetches.

Roll back: set `SAASREVIEWS_LIVE_DIRECTORIES=0` (or unset) and recreate. Do not run live directories from CI. No TrustRadius. No badge image hosting.
