# SaaSReviews — Product Development Spec

**Version:** 1.0  
**Status:** Ready to build  
**Repo:** https://github.com/tangpingqingwa/saasreviews  
**Directories v1:** G2 + Capterra only

Public SaaS review cards and review lists. Not a G2 partnership. Not a G2 clone UI.

---

## 1. Product statement

Product URL / slug → scores, review counts, public review bodies. Compare two products’ **public** scores without inventing stars.

One-line pitch: **G2 and Capterra public reviews as one JSON schema. Same-day key.**

---

## 2. Goals and non-goals

### Goals

- `GET /v1/products/by-url` 1 credit; reviews 1 / page; compare 2 credits.
- Never invent a star rating. If missing, `null`.
- Dual ids when G2 and Capterra cannot be matched: return both, `match: "unmatched"`.
- Our other products may not cite review scores unless fetched through this API.

### Non-goals

- Fake reviews, review gating, “we’ll post to G2.”
- TrustRadius / Gartner in v1.
- Enterprise warehouse.
- Consumer UI that looks like G2.

---

## 3. Auth and envelope

Bearer `sk_live_...` (prefix `srv_` if `sk_` collides with Stripe in docs — use **`sr_live_`**).

| code | HTTP | meaning |
|---|---|---|
| `directory_unsupported` | 422 | not g2/capterra |
| `product_not_found` | 404 | |
| `unmatched_compare` | 200 | compare ran but ids not linked; see data.warning |

---

## 4. Identity

```ts
type ProductRef = {
  id: string                 // sr_prod_...
  directory: "g2" | "capterra"
  directorySlug: string
  url: string
  name: string
}
```

Matching: lowercase name + vendor domain if present. Store `sameAs: string[]`. If confidence < threshold, do not merge.

---

## 5. Endpoints

### 5.1 `GET /v1/products/by-url`

**Credits:** 1.

`data`:

```ts
{
  product: ProductRef
  sameAs: ProductRef[]
  scores: {
    overall: number | null
    max: number              // 5 or 10 depending on directory, always stated
    reviewCount: number | null
  }
  pricingTeaser: string | null
  categories: string[]
  extractedAt: string
}
```

### 5.2 `GET /v1/products/{id}/reviews`

**Credits:** 1 / page.

```ts
{
  page: number
  hasMore: boolean
  reviews: Array<{
    id: string | null
    title: string | null
    body: string
    stars: number | null
    createdAt: string | null
    reviewerTitle: string | null
    industry: string | null
    companySize: string | null
    validated: boolean | null
  }>
}
```

Only public text. No login wall bypass.

### 5.3 `GET /v1/compare`

**Credits:** 2. Query: `a` + `b` (ids or slugs with `directory:` prefix).

Returns two product cards + `scoreDelta` only if both `overall` non-null. If unmatched directories, still return both cards and `warning: "unmatched"`.

### 5.4 `GET /v1/categories/{slug}`

**Credits:** 1 / page. Directory-specific slug; query `directory=g2|capterra`.

### 5.5 `GET /v1/search`

**Credits:** 1 / page. `q`, `directory`.

### 5.6 Control plane

`/v1/me`, `/v1/usage`, `/healthz`.

---

## 6. Billing

| Plan | Price | Credits |
|---|---|---|
| Free | $0 | 100 once |
| Monthly | $19 | 2,000 |
| Annual | $190 | 2,000 / mo |

---

## 7. Caching

Product cards 24h. Reviews 12h. Compare = two cached reads + merge (no extra scrape if both warm).

No badge image hosting.

---

## 8. MCP

`get_saas`, `list_reviews`, `compare_saas`.

Skill: public reviews only; not complete vs G2’s sold dataset; do not imply affiliation.

SEO: `G2 API access 2026`, `Capterra data without a partnership`.

---

## 9. Acceptance

| # | Case | Expected |
|---|---|---|
| 1 | G2 product URL | name + scores.overall number or null |
| 2 | Capterra product URL | same schema, `max` correct |
| 3 | Reviews | real bodies, no login-only content |
| 4 | Compare two known products | 2 credits, both cards |
| 5 | Compare unmatched names | warning unmatched, no fake merge |
| 6 | Missing score | null, not 0 |
| 7 | Internal rule | a sample README quote must have a stored fetch id |

---

## 10. Milestones

**M1:** G2 product + reviews.  
**M2:** Capterra + shared schema.  
**M3:** compare + search + keys + $19.  
**M4:** MCP + SEO.

Launch = M3.

---

## 11. Legal

Independent index of public reviews. Do not say “G2 alternative dataset.” Customer ToS: no republishing a full mirror, no fake reviews. Fixture tests on HTML change.

## 12. Git collaboration (normative)

Development is GitHub trunk-based. **`main` is always cloneable, buildable, and testable.**

| Rule | Requirement |
|---|---|
| Integration branch | `main` only. No long-lived `develop`. |
| How code lands | Pull request into `main`. No direct push. |
| Required check | GitHub Actions workflow `ci` (job id `ci`) must be green. |
| Local / CI test | `bash scripts/test.sh` — offline, no production secrets. |
| Branch names | `feat/` `fix/` `docs/` `chore/` `test/` + short slug. |
| Merge | Squash. Delete the head branch. |
| Broken `main` | Treat as an incident. Fix on `fix/…` via PR. |

Full process: [CONTRIBUTING.md](./CONTRIBUTING.md).

Until there is an application binary, `scripts/test.sh` still has to pass: contract files exist, SPEC/CONTRIBUTING agree, no tracked secrets. Adding a server or CLI means **extending** that script with unit/contract tests. Live upstream calls are optional and must not be required for `main` to stay green.
