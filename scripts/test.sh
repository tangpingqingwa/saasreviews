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
for f in README.md SPEC.md BUILD.md CONTRIBUTING.md scripts/test.sh; do
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
file -b --mime-encoding README.md SPEC.md CONTRIBUTING.md BUILD.md | grep -qiE 'utf-8|us-ascii' \
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

echo "== no live G2 / Capterra HTTP in core or adapters =="
if [[ -d src/adapters ]] || [[ -d src/core ]]; then
  if grep -RInE --include='*.ts' '(^|[^[:alnum:]_])(fetch|axios|got)\s*\(' src/adapters src/core >/dev/null; then
    fail "live HTTP client call in adapters/core (fixture adapter only)"
  fi
fi
if [[ -f src/core/compare.ts ]] || [[ -f src/core/search.ts ]] || [[ -f src/core/categories.ts ]]; then
  fail "compare/search/categories are PR 4; do not land them here"
fi
if [[ -d src/mcp ]]; then
  fail "MCP is PR 5; do not land it here"
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
  # Fixture adapter only — never hit live G2 or Capterra.
  export SAASREVIEWS_FIXTURE_ONLY=1
  test_log="$(mktemp)"
  trap 'rm -f "$test_log"' EXIT
  set +e
  npx tsx --test --test-reporter spec 'tests/**/*.test.ts' | tee "$test_log"
  test_status=${PIPESTATUS[0]}
  set -e
  [[ $test_status -eq 0 ]] || fail "unit tests failed"
  grep -Eq 'tests[[:space:]]+[1-9][0-9]*' "$test_log" \
    || fail "test runner reported 0 tests"
fi

echo "OK: buildable and testable"
