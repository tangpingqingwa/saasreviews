# SaaSReviews

Build contract: [SPEC.md](./SPEC.md).

Public SaaS reviews from G2, Capterra, and similar directories. One schema for product pages and review lists.

G2 and Capterra sell data to enterprises. Developers and agents who want “what do reviews say about Notion vs Obsidian” get HTML or a $20k contract.

## Why this, and why overseas

English B2B software is bought in those directories. Compare pages, win/loss agents, and “summarize objections for this competitor” are real jobs. Official partner APIs are not same-day and not $19.

Queries: `g2 api`, `capterra reviews api`, `g2 reviews scrape`, `saas review api`.

## Exact demand

- Who: product marketers, indie SEO compare sites, sales agents, our own positioning work
- Input: product URL, slug, or category
- Output: scores, review counts, pricing teaser if public, review bodies with persona/industry when shown
- Acceptance: `GET /v1/products/by-url` 1 credit; `GET /v1/products/{id}/reviews` 1 / page

## Exact connector

| Endpoint | Job | Credits |
|---|---|---|
| `/v1/products/by-url` | Directory product card | 1 |
| `/v1/products/{id}/reviews` | Reviews | 1 / page |
| `/v1/compare` | Two slugs → side-by-side scores | 2 |
| `/v1/categories/{slug}` | Category ranking page | 1 / page |
| `/v1/search` | Product search | 1 / page |

Normalize G2 and Capterra into one product id space where we can; if we cannot match, return both and say so. Never invent a star rating.

MCP: `get_saas`, `list_reviews`, `compare_saas`.

## Exact combination

- SEO: `G2 API access 2026` / `Capterra data without a partnership`
- Free 100 credits, $19 / mo / 2,000
- Skill: “pull last 20 G2 reviews for X, cluster complaints”
- Our own READMEs and landing pages must not cite review scores we did not fetch through this API
- No G2-shaped consumer UI

## Cost control

- Product cards cache 24h; reviews 12h
- Compare is two cached reads plus a merge, not a live double scrape when possible
- No screenshot hosting of badges
- Directory HTML changes: fixture tests first

## Business model

Credits to teams who cannot get a G2 partnership. Do not claim completeness vs. G2’s sold dataset. Claim: public reviews, today, in JSON.

Success: 10 paying product/marketing teams; compare-site builders on annual; we stopped hand-copying review quotes into decks.

## Will not do

- No fake reviews, no review gating
- No “we’ll post this on G2 for you”
- No enterprise BI warehouse in year one
- No TrustRadius/Gartner boil-the-ocean launch — G2 + Capterra only until boring

## First two weeks

1. G2 product + reviews
2. Capterra product + reviews
3. Shared schema + compare
4. MCP `get_saas`

## Dogfood

Every competitive slide for our other nine products pulls quotes through SaaSReviews. If someone pastes a G2 URL into a doc by hand, log a bug.

## Risk

Directories dislike scrapers and have lawyers. Stay on public review text. No login walls. Branding: independent index of public reviews, not “G2 but cheaper” in a way that implies affiliation.
