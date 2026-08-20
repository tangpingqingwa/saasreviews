# SaaSReviews — Detailed Specification and Build Plan

**Product contract:** [SPEC.md](./SPEC.md) wins on API shape, credits, and errors.  
**This file** wins on stack, module boundaries, test layout, and the PR sequence.  
**Git:** [CONTRIBUTING.md](./CONTRIBUTING.md). Each row below is one squash-merged PR. `main` stays green.

G2 + Capterra only. Keys `sr_live_` / `sr_test_`. Product ids `sr_prod_…`. Never invent stars. Unmatched compare returns both cards + `warning: "unmatched"`.

---

## 1. Stack

Node 22, TypeScript strict, Fastify, Zod, SQLite product registry, `node:test` + `tsx`.  
Fixture JSON for 10 G2 + 10 Capterra products in `tests/fixtures/`. Live adapters isolated; unit tests never hit G2 or Capterra.

**Out of stack:** Prisma, Nest, Redis, Kubernetes, TrustRadius, Gartner, badge image hosting.

---

## 2. Matching

```
normalize(name) + registrable domain → candidate
if score < 0.9: do not merge; sameAs stays empty
```

Do not fuzzy-merge “Notion” and “Motion”.

`scores.max` is **5** for both G2 and Capterra public stars in v1 unless fixture says otherwise. If a directory uses 10, set `max` explicitly — never scale silently.

Missing overall → `null`, **not** `0`.

Unknown directory → `directory_unsupported` 422. Unknown product → `product_not_found` 404. Compare of unlinked ids → HTTP 200 + `warning: "unmatched"` (SPEC `unmatched_compare`), never a fake `sameAs`.

---

## 3. Compare

Credits **2** always when both lookups succeed (including unmatched).  
`scoreDelta` only if both `overall` are numbers. Do not invent a delta from `null`.

---

## 4. Tests

Fixtures first: product cards, review pages, missing overall, unmatched pair, unsupported directory.  
`scripts/test.sh` stays offline (no live G2 / Capterra / TikTok / Reddit / Amazon). After PR 1 it also runs `tsc --noEmit` and `node:test`. Live adapters exist but stay env-gated: default and CI use fixtures (`SAASREVIEWS_FIXTURE_ONLY=1`). Set `SAASREVIEWS_LIVE_DIRECTORIES=1` only on a machine that may fetch public G2/Capterra HTML.

---

## 5. PR plan

Each PR is independently mergeable. Dependencies are hard.

### PR 1: Skeleton + keys + ProductRef types
- **Files:** package.json, tsconfig, src/types.ts (`ProductRef`), src/server.ts `/healthz`, keys `sr_live_` / `sr_test_`, scripts/test.sh
- **Dependencies:** None
- **Acceptance:** `GET /healthz` 200. `ProductRef` matches SPEC. `scripts/test.sh` green offline.

### PR 2: G2 product + reviews fixtures
- **Files:** adapters/g2/fixture.ts, core/product.ts, core/reviews.ts, tests
- **Dependencies:** PR 1
- **Acceptance:** SPEC 1, 3, 6

### PR 3: Capterra + shared schema
- **Files:** adapters/capterra, same core
- **Dependencies:** PR 2
- **Acceptance:** SPEC 2

### PR 4: compare + search + categories
- **Files:** core/compare.ts, core/search.ts, core/categories.ts
- **Dependencies:** PR 3
- **Acceptance:** SPEC 4–5; unmatched → both cards + `warning: "unmatched"`; 2 credits when both lookups succeed

### PR 5: MCP
- **Tools:** get_saas, list_reviews, compare_saas
- **Dependencies:** PR 4

### PR 6: Live G2 + Capterra adapters (env-gated)
- **Files:** `src/adapters/live.ts`, `src/adapters/http.ts`, `src/adapters/parse.ts`, `src/config.ts`, recorded HTML under `tests/fixtures/html/`, `tests/live-adapters.test.ts`
- **Dependencies:** PR 5
- **Acceptance:** default `createAppAdapters()` stays fixtures. `SAASREVIEWS_LIVE_DIRECTORIES=1` swaps in live adapters. Failures map to SPEC (`product_not_found`, `upstream_blocked`). Missing overall stays `null`. Unmatched compare stays unmatched. `scripts/test.sh` remains offline. No TrustRadius. No badge hosting. No Dockerfile.

No badge image hosting. No TrustRadius files. Control-plane `/v1/me` and `/v1/usage` ride with keys in PR 1; billing $19 is after M3, not in this DAG.
