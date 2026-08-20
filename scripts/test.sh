#!/usr/bin/env bash
# Offline gate for main. Must exit 0 on a clean clone with no secrets.
# Contract checks stay; once package.json exists we also typecheck and run
# node:test. Do not require live G2 / Capterra / TikTok / Reddit / Amazon.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "== contract files =="
for f in README.md SPEC.md BUILD.md CONTRIBUTING.md scripts/test.sh llms.txt; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done

echo "== contributing rules are documented =="
grep -q 'main must always be buildable' CONTRIBUTING.md \
  || grep -q 'main` must always be buildable' CONTRIBUTING.md \
  || fail "CONTRIBUTING.md does not state the main-branch rule"

echo "== SPEC mentions git collaboration =="
grep -q 'Git collaboration' SPEC.md || fail "SPEC.md missing Git collaboration section"

echo "== no committed secrets =="
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git ls-files | grep -E '(^|/)\.env$|(^|/)id_rsa$|\.pem$|credentials\.json$' >/dev/null; then
    fail "secret-like path is tracked"
  fi
fi

echo "== markdown is UTF-8 text =="
file -b --mime-encoding README.md SPEC.md CONTRIBUTING.md BUILD.md llms.txt | grep -qiE 'utf-8|us-ascii' \
  || fail "docs are not UTF-8/ASCII"

echo "== G2 fixtures (PR 2) =="
[[ -d tests/fixtures/g2/products ]] || fail "missing tests/fixtures/g2/products"
[[ -d tests/fixtures/g2/reviews ]] || fail "missing tests/fixtures/g2/reviews"
g2_products="$(find tests/fixtures/g2/products -name '*.json' | wc -l | tr -d ' ')"
[[ "$g2_products" -eq 10 ]] || fail "expected 10 G2 product fixtures, got $g2_products"
[[ -f tests/fixtures/g2/products/notion.json ]] || fail "missing notion G2 product fixture"
[[ -f tests/fixtures/g2/products/ghostwriter.json ]] || fail "missing missing-score G2 fixture"
[[ -f tests/fixtures/g2/reviews/notion-page-1.json ]] || fail "missing notion review fixture"
grep -q '"overall": null' tests/fixtures/g2/products/ghostwriter.json \
  || fail "ghostwriter fixture must keep overall null"
if grep -R --include='*.json' '"overall": 0' tests/fixtures/g2/products >/dev/null; then
  fail "G2 product fixture invented overall 0"
fi

echo "== Capterra fixtures (PR 3) =="
[[ -d tests/fixtures/capterra/products ]] || fail "missing tests/fixtures/capterra/products"
[[ -d tests/fixtures/capterra/reviews ]] || fail "missing tests/fixtures/capterra/reviews"
capterra_products="$(find tests/fixtures/capterra/products -name '*.json' | wc -l | tr -d ' ')"
[[ "$capterra_products" -eq 10 ]] || fail "expected 10 Capterra product fixtures, got $capterra_products"
[[ -f tests/fixtures/capterra/products/notion.json ]] || fail "missing notion Capterra product fixture"
[[ -f tests/fixtures/capterra/products/ghostnote.json ]] || fail "missing missing-score Capterra fixture"
[[ -f tests/fixtures/capterra/reviews/notion-page-1.json ]] || fail "missing notion Capterra review fixture"
grep -q '"directory": "capterra"' tests/fixtures/capterra/products/notion.json \
  || fail "Capterra notion fixture must set directory capterra"
grep -q '"overall": null' tests/fixtures/capterra/products/ghostnote.json \
  || fail "ghostnote fixture must keep overall null"
if grep -R --include='*.json' '"overall": 0' tests/fixtures/capterra/products >/dev/null; then
  fail "Capterra product fixture invented overall 0"
fi
if grep -R --include='*.json' '"max": 10' tests/fixtures/capterra/products >/dev/null; then
  fail "Capterra fixture used max 10 without an explicit directory scale (v1 public stars are 5)"
fi

echo "== HTTP must not import adapters/* =="
if [[ -d src/http ]]; then
  if grep -R --include='*.ts' -l 'adapters/' src/http >/dev/null 2>&1; then
    # fastify.d.ts may import AdapterLookup types only.
    if grep -R --include='*.ts' --exclude='fastify.d.ts' -l 'adapters/' src/http >/dev/null 2>&1; then
      fail "src/http imported adapters (routes must call core/* only)"
    fi
  fi
fi

echo "== product cards must use adapter.directory, not hardcoded g2 =="
if [[ -f src/core/product.ts ]]; then
  if grep -n 'directory: "g2"' src/core/product.ts >/dev/null; then
    fail "src/core/product.ts hardcodes directory g2; use adapter.directory"
  fi
fi

echo "== live HTTP stays isolated; default adapters remain fixtures =="
if [[ -d src/core ]]; then
  if grep -RInE --include='*.ts' '(^|[^[:alnum:]_])(fetch|axios|got)\s*\(' src/core >/dev/null; then
    fail "live HTTP client call in src/core (core must stay offline)"
  fi
fi
if [[ -d src/adapters ]]; then
  if grep -RInE --include='*.ts' '(^|[^[:alnum:]_])(axios|got)\s*\(' src/adapters >/dev/null; then
    fail "adapters must not import axios/got"
  fi
  # fetch() is allowed only in the env-gated live HTTP helper.
  if grep -RInE --include='*.ts' --exclude='http.ts' '(^|[^[:alnum:]_])fetch\s*\(' src/adapters >/dev/null; then
    fail "fetch() outside src/adapters/http.ts (live client must stay isolated)"
  fi
fi
[[ -f src/adapters/live.ts ]] || fail "missing src/adapters/live.ts"
[[ -f src/adapters/http.ts ]] || fail "missing src/adapters/http.ts"
[[ -f src/adapters/parse.ts ]] || fail "missing src/adapters/parse.ts"
grep -q 'SAASREVIEWS_LIVE_DIRECTORIES' src/config.ts \
  || fail "src/config.ts must env-gate live directories"
grep -q 'SAASREVIEWS_FIXTURE_ONLY' src/config.ts \
  || fail "src/config.ts must honor SAASREVIEWS_FIXTURE_ONLY"
grep -q 'parseAdapterMode' src/adapters/index.ts \
  || fail "createAppAdapters must consult parseAdapterMode"
if grep -n 'createG2LiveAdapter()' src/adapters/index.ts >/dev/null && \
   ! grep -q 'parseAdapterMode' src/adapters/index.ts; then
  fail "live adapters wired without an env gate"
fi
if grep -R --include='*.ts' -E 'trustradius' src/adapters >/dev/null; then
  fail "TrustRadius adapter files are out of v1"
fi

echo "== recorded HTML fixtures for live parsers (offline) =="
[[ -d tests/fixtures/html ]] || fail "missing tests/fixtures/html"
[[ -f tests/fixtures/html/g2-notion.html ]] || fail "missing G2 HTML fixture"
[[ -f tests/fixtures/html/capterra-notion.html ]] || fail "missing Capterra HTML fixture"
[[ -f tests/fixtures/html/g2-ghostwriter.html ]] || fail "missing missing-score G2 HTML fixture"
[[ -f tests/live-adapters.test.ts ]] || fail "missing tests/live-adapters.test.ts"
if grep -RIn --include='*.ts' 'createDirectoryFetch(' tests >/dev/null; then
  fail "unit tests must inject a recorded fetch, not createDirectoryFetch()"
fi
if grep -RInE --include='*.ts' 'SAASREVIEWS_LIVE_DIRECTORIES[[:space:]]*=[[:space:]]*1' tests >/dev/null; then
  fail "unit tests must not enable live directories against the public web"
fi

echo "== compare + search + categories (PR 4) =="
[[ -f src/core/compare.ts ]] || fail "missing src/core/compare.ts"
[[ -f src/core/search.ts ]] || fail "missing src/core/search.ts"
[[ -f src/core/categories.ts ]] || fail "missing src/core/categories.ts"
[[ -f tests/compare.test.ts ]] || fail "missing tests/compare.test.ts"
[[ -f tests/search.test.ts ]] || fail "missing tests/search.test.ts"
[[ -f tests/categories.test.ts ]] || fail "missing tests/categories.test.ts"
if grep -R --include='*.ts' --exclude='fastify.d.ts' -l 'adapters/' src/http >/dev/null 2>&1; then
  fail "src/http imported adapters (routes must call core/* only)"
fi

echo "== MCP tools (PR 5) =="
[[ -f src/mcp/server.ts ]] || fail "missing src/mcp/server.ts"
[[ -f src/mcp/tools.ts ]] || fail "missing src/mcp/tools.ts"
[[ -f tests/mcp.test.ts ]] || fail "missing tests/mcp.test.ts"
[[ -f llms.txt ]] || fail "missing llms.txt"
grep -q 'get_saas' src/mcp/tools.ts || fail "src/mcp/tools.ts missing get_saas"
grep -q 'list_reviews' src/mcp/tools.ts || fail "src/mcp/tools.ts missing list_reviews"
grep -q 'compare_saas' src/mcp/tools.ts || fail "src/mcp/tools.ts missing compare_saas"
grep -q 'get_saas' llms.txt || fail "llms.txt missing get_saas"
grep -q 'list_reviews' llms.txt || fail "llms.txt missing list_reviews"
grep -q 'compare_saas' llms.txt || fail "llms.txt missing compare_saas"
grep -q 'When not to call' llms.txt || fail "llms.txt missing when-not-to-call"
grep -qi 'not complete vs G2' llms.txt || fail "llms.txt missing sold-dataset disclaimer"
grep -qi 'affiliation' llms.txt || fail "llms.txt missing affiliation disclaimer"
if grep -RIn --include='*.ts' -E "from ['\"].*adapters/" src/mcp | grep -v 'import type' >/dev/null; then
  fail "src/mcp imported adapters (tools must call core/* only)"
fi
grep -q 'getProductByUrl' src/mcp/tools.ts || fail "get_saas must call core/product"
grep -q 'getProductReviews' src/mcp/tools.ts || fail "list_reviews must call core/reviews"
grep -q 'compareProducts' src/mcp/tools.ts || fail "compare_saas must call core/compare"
if grep -RInE --include='*.ts' '(^|[^[:alnum:]_])(fetch|axios|got)\s*\(' src/mcp >/dev/null; then
  fail "live HTTP client call in src/mcp (fixture adapter only)"
fi
if grep -R --include='*.ts' -E 'https?://(www\.)?(g2|capterra)\.com' src/mcp >/dev/null; then
  fail "src/mcp must not hardcode live G2/Capterra hosts"
fi

echo "== deploy artifacts (Dockerfile + runbook) =="
[[ -f Dockerfile ]] || fail "missing Dockerfile"
[[ -f .env.example ]] || fail "missing .env.example"
[[ -f deploy/runbook.md ]] || fail "missing deploy/runbook.md"
grep -q 'node:22' Dockerfile || fail "Dockerfile must use Node 22"
grep -qE '^USER[[:space:]]+node$' Dockerfile || fail "Dockerfile must run as non-root USER node"
grep -q 'PORT' Dockerfile || fail "Dockerfile must honor PORT"
grep -q 'src/server.ts' Dockerfile || fail "Dockerfile must start src/server.ts"
if grep -E 'SAASREVIEWS_LIVE_DIRECTORIES[[:space:]]*=[[:space:]]*(1|true|yes|on)' Dockerfile >/dev/null; then
  fail "Dockerfile must not enable live directories"
fi
if [[ -f docker-compose.yml ]]; then
  fail "one-box deploy is Dockerfile only; do not add docker-compose"
fi
grep -q 'SAASREVIEWS_LIVE_DIRECTORIES' .env.example || fail ".env.example missing SAASREVIEWS_LIVE_DIRECTORIES"
grep -q 'SAASREVIEWS_DATABASE' .env.example || fail ".env.example missing SAASREVIEWS_DATABASE"
grep -q 'SAASREVIEWS_BOOTSTRAP_KEY' .env.example || fail ".env.example missing SAASREVIEWS_BOOTSTRAP_KEY"
if grep -E '^[[:space:]]*SAASREVIEWS_LIVE_DIRECTORIES=1[[:space:]]*$' .env.example >/dev/null; then
  fail ".env.example must not default live directories on"
fi
if grep -E '^[[:space:]]*SAASREVIEWS_BOOTSTRAP_KEY=sr_(live|test)_' .env.example >/dev/null; then
  fail ".env.example must not ship a real bootstrap key"
fi
grep -q '/healthz' deploy/runbook.md || fail "runbook missing /healthz"
grep -q 'SAASREVIEWS_LIVE_DIRECTORIES' deploy/runbook.md || fail "runbook missing live directory enablement"
grep -q 'docker build' deploy/runbook.md || fail "runbook missing docker build"
grep -q 'docker run' deploy/runbook.md || fail "runbook missing docker run"
if grep -RInE 'trustradius' Dockerfile deploy .env.example >/dev/null 2>&1; then
  fail "deploy artifacts must not target TrustRadius"
fi

if [[ -f package.json ]]; then
  echo "== install =="
  if [[ ! -d node_modules ]]; then
    if [[ -f package-lock.json ]]; then
      npm ci
    else
      npm install
    fi
  fi

  echo "== tsc --noEmit =="
  npx tsc --noEmit

  ls tests/*.test.ts >/dev/null 2>&1 || fail "no tests/*.test.ts files"

  echo "== unit tests =="
  # Quoted so bash 3.2 does not eat **; Node 22's test runner expands the glob.
  # Offline: fixture adapters + recorded HTML. Never hit live G2 or Capterra.
  export SAASREVIEWS_FIXTURE_ONLY=1
  unset SAASREVIEWS_LIVE_DIRECTORIES || true
  test_log="$(mktemp)"
  trap 'rm -f "$test_log"' EXIT
  set +e
  npx tsx --test --test-reporter spec 'tests/**/*.test.ts' | tee "$test_log"
  test_status=${PIPESTATUS[0]}
  set -e
  [[ $test_status -eq 0 ]] || fail "unit tests failed"
  grep -Eq 'tests[[:space:]]+[1-9][0-9]*' "$test_log" \
    || fail "test runner reported 0 tests"
  if grep -E 'g2.com|capterra.com' "$test_log" | grep -Ei 'ECONN|ENOTFOUND|fetch failed|socket hang up' >/dev/null; then
    fail "unit tests appear to have opened a live directory socket"
  fi
fi

echo "OK: buildable and testable"
