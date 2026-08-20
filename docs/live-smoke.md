# Live G2 + Capterra smoke

Opt-in. **Not** part of `scripts/test.sh` or GitHub Actions `ci`. CI stays on fixtures (`SAASREVIEWS_FIXTURE_ONLY=1` wins).

`100%` for this unit means a **local process** with live flags **on** walked every required flow against **real G2 / Capterra public pages**. Never invent stars. If a public overall is missing, it stays `null`.

## Flags

| Variable | Live smoke | CI / `test.sh` |
|---|---|---|
| `SAASREVIEWS_LIVE_DIRECTORIES` | `1` | unset |
| `SAASREVIEWS_FIXTURE_ONLY` | **unset** | `1` |

`SAASREVIEWS_FIXTURE_ONLY=1` always wins. If it is set, `scripts/live-smoke.sh` exits before listen.

## How to run

```bash
bash scripts/live-smoke.sh
```

The script:

1. Refuses `CI=true` / `GITHUB_ACTIONS=true`.
2. Unsets `SAASREVIEWS_FIXTURE_ONLY` and sets `SAASREVIEWS_LIVE_DIRECTORIES=1`.
3. Starts `node --import tsx src/server.ts` on a free loopback port with a temp SQLite file and bootstrap key `sr_test_live_smoke`.
4. Waits for `GET /healthz` and checks the server logged live-directory mode.
5. Hits the required flows below.
6. Kills the process and deletes the temp database.

Overrides: `SAASREVIEWS_LIVE_SMOKE_G2_URL` (default `https://www.g2.com/products/notion/reviews`), `SAASREVIEWS_LIVE_SMOKE_CAPTERRA_URL` (default `https://www.capterra.com/p/186596/Notion/`), `SAASREVIEWS_LIVE_SMOKE_COMPARE_A` / `_B` (default `g2:notion` vs `capterra:notion`), `SAASREVIEWS_LIVE_SMOKE_KEY`, `SAASREVIEWS_LIVE_SMOKE_PORT`.

## Required flows

| Flow | Request | Honest pass |
|---|---|---|
| G2 product | `GET /v1/products/by-url?url=https://www.g2.com/products/notion/reviews` | `200` + name + `scores.overall` number **or** `null`, or `503 upstream_blocked` / `404 product_not_found` with **0 credits**. Never invent stars. |
| G2 reviews | `GET /v1/products/{id}/reviews?page=1` | `200` + `data.reviews` array (empty allowed; public bodies only), or `503 upstream_blocked` / 0 credits. Never synthesize a row or star `0`. |
| Capterra product | `GET /v1/products/by-url?url=https://www.capterra.com/p/186596/Notion/` | Same schema, stated `max`. Missing overall stays `null`. Honest `upstream_blocked` / `product_not_found` is allowed. |
| Compare | `GET /v1/compare?a=g2:notion&b=capterra:notion` | Both cards + `scoreDelta` only if both overalls are numbers; unmatched stays `warning: "unmatched"`. Or honest blocked / 0 credits. No fake merge. |

Verdicts printed per flow: `PASS`, `PASS-ERROR` (SPEC error, 0 credits, nothing invented), `FAIL`.

The process exit is 0 only when every required flow is `PASS` or `PASS-ERROR`. Fixture strings (`Public review: search is good enough`, `Ghostwriter Labs`, `g2_notion_live_r1`, extractedAt `2026-01-15T12:00:00.000Z`) fail the run — that means the live adapter was not on.

## Public fallbacks

`.com` HTML is often DataDome / Cloudflare. Live adapters still try public directory surfaces before returning `upstream_blocked`:

- G2 `https://www.g2.com/products/{slug}/reviews.rss` — public review bodies. Channel title is the product name. **No overall** in that feed, so `scores.overall` stays `null`.
- Capterra regional product HTML (`capterra.ca` / `.com.au` / `.in` `/software/{id}/{slug}`) when `capterra.com` is a bot wall. Same schema; missing overall stays `null`.

A blanket `PASS-ERROR` on every required flow is honest but **not** enough. G2 product + reviews must `PASS` with SPEC-shaped live data. Capterra may still be a documented `upstream_blocked` when every public Capterra host is Cloudflare-walled — that is a SPEC error, not invented stars.

## This session

Ran `bash scripts/live-smoke.sh` on 2026-08-20 from `feat/live-smoke-unblocked` with `SAASREVIEWS_LIVE_DIRECTORIES=1` and `SAASREVIEWS_FIXTURE_ONLY` unset. Local process on loopback. Real G2 / Capterra public surfaces (not fixtures).

| Flow | Result |
|---|---|
| G2 product Notion | **PASS** HTTP 200 name=Notion `overall=null` (HTML is DataDome; public `reviews.rss` has the name, no aggregate — overall not invented) |
| G2 reviews page 1 | **PASS** HTTP 200, 25 public review bodies from `reviews.rss` |
| Capterra product Notion | **PASS-ERROR** HTTP 503 `upstream_blocked`, 0 credits. `.com` and regional `/software/186596/notion` HTML still Cloudflare-walled from this host. Stars not invented. |
| Compare `g2:notion` vs `capterra:notion` | **PASS-ERROR** HTTP 503 `upstream_blocked`, 0 credits (Capterra still walled; no fake merge or delta) |

Process exit 0. G2 required flows are live SPEC data. Capterra remains a documented SPEC error, not a blanket bot-wall on every product.

## What this does not do

- Does not call G2 or Capterra from `scripts/test.sh`.
- Does not set `SAASREVIEWS_LIVE_DIRECTORIES=1` in Docker or CI.
- Does not invent a star rating when the public page is a bot wall or has no overall.
- Does not add TrustRadius or badge image hosting.
