#!/usr/bin/env bash
# Opt-in live G2 + Capterra smoke. Not called from scripts/test.sh or CI.
# Starts a local process with SAASREVIEWS_LIVE_DIRECTORIES=1 and
# SAASREVIEWS_FIXTURE_ONLY unset, then walks a real G2 product + reviews,
# a Capterra product, and compare. Never invents stars. Missing overall stays null.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

if [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
  fail "live-smoke is opt-in and must not run in CI"
fi

if [[ "${SAASREVIEWS_FIXTURE_ONLY:-}" == "1" ]]; then
  fail "SAASREVIEWS_FIXTURE_ONLY=1 is set; unset it so live adapters can fetch G2/Capterra"
fi

if [[ ! -d node_modules ]]; then
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
fi

command -v curl >/dev/null || fail "curl is required"
command -v node >/dev/null || fail "node is required"

G2_URL="${SAASREVIEWS_LIVE_SMOKE_G2_URL:-https://www.g2.com/products/notion/reviews}"
CAPTERRA_URL="${SAASREVIEWS_LIVE_SMOKE_CAPTERRA_URL:-https://www.capterra.com/p/186596/Notion/}"
COMPARE_A="${SAASREVIEWS_LIVE_SMOKE_COMPARE_A:-g2:notion}"
COMPARE_B="${SAASREVIEWS_LIVE_SMOKE_COMPARE_B:-capterra:notion}"
KEY="${SAASREVIEWS_LIVE_SMOKE_KEY:-sr_test_live_smoke}"
[[ "$KEY" == sr_live_* || "$KEY" == sr_test_* ]] || fail "bootstrap key must start with sr_live_ or sr_test_"

if [[ -n "${SAASREVIEWS_LIVE_SMOKE_PORT:-}" ]]; then
  PORT="$SAASREVIEWS_LIVE_SMOKE_PORT"
else
  PORT="$(node --input-type=module -e '
    import net from "node:net";
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") process.exit(1);
      process.stdout.write(String(addr.port));
      server.close();
    });
  ')"
fi

workdir="$(mktemp -d "${TMPDIR:-/tmp}/saasreviews-live-smoke.XXXXXX")"
db="$workdir/saasreviews.sqlite"
log="$workdir/server.log"
pid=""

cleanup() {
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -rf "$workdir"
}
trap cleanup EXIT

json_print() {
  SAASREVIEWS_JSON_FILE="$1" SAASREVIEWS_JSON_PATH="$2" node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const file = process.env.SAASREVIEWS_JSON_FILE;
    const path = process.env.SAASREVIEWS_JSON_PATH;
    if (!file || !path) process.exit(2);
    const obj = JSON.parse(readFileSync(file, "utf8"));
    let cur = obj;
    for (const key of path.split(".")) {
      if (cur === null || cur === undefined || typeof cur !== "object") process.exit(2);
      cur = cur[key];
    }
    if (cur === undefined) process.exit(2);
    if (cur === null) process.stdout.write("null");
    else if (typeof cur === "object") process.stdout.write(JSON.stringify(cur));
    else process.stdout.write(String(cur));
  '
}

json_type() {
  SAASREVIEWS_JSON_FILE="$1" SAASREVIEWS_JSON_PATH="$2" node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const file = process.env.SAASREVIEWS_JSON_FILE;
    const path = process.env.SAASREVIEWS_JSON_PATH;
    if (!file || !path) process.exit(2);
    const obj = JSON.parse(readFileSync(file, "utf8"));
    let cur = obj;
    for (const key of path.split(".")) {
      if (cur === null || cur === undefined || typeof cur !== "object") {
        process.stdout.write("missing");
        process.exit(0);
      }
      cur = cur[key];
    }
    if (cur === undefined) process.stdout.write("missing");
    else if (cur === null) process.stdout.write("null");
    else if (Array.isArray(cur)) process.stdout.write("array");
    else process.stdout.write(typeof cur);
  '
}

json_len() {
  SAASREVIEWS_JSON_FILE="$1" SAASREVIEWS_JSON_PATH="$2" node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const file = process.env.SAASREVIEWS_JSON_FILE;
    const path = process.env.SAASREVIEWS_JSON_PATH;
    if (!file || !path) process.exit(2);
    const obj = JSON.parse(readFileSync(file, "utf8"));
    let cur = obj;
    for (const key of path.split(".")) {
      if (cur === null || cur === undefined || typeof cur !== "object") process.exit(2);
      cur = cur[key];
    }
    if (!Array.isArray(cur)) process.exit(2);
    process.stdout.write(String(cur.length));
  '
}

encode_query() {
  SAASREVIEWS_Q="$1" node --input-type=module -e '
    process.stdout.write(encodeURIComponent(process.env.SAASREVIEWS_Q ?? ""));
  '
}

request() {
  local out="$1" method="$2" path="$3"
  local url="http://127.0.0.1:${PORT}${path}"
  local http
  http="$(
    curl -sS -X "$method" \
      -H "Authorization: Bearer ${KEY}" \
      -H "Accept: application/json" \
      -o "$out" -w "%{http_code}" \
      --connect-timeout 10 \
      --max-time 90 \
      "$url"
  )" || fail "curl failed for ${method} ${path}"
  printf "%s" "$http"
}

assert_no_invented_stars() {
  local file="$1"
  SAASREVIEWS_JSON_FILE="$file" node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const file = process.env.SAASREVIEWS_JSON_FILE;
    if (!file) process.exit(2);
    const body = JSON.parse(readFileSync(file, "utf8"));

    const fixtureNeedles = [
      "Recorded Echo Dot fixture",
      "Public review: search is good enough",
      "Replaced our wiki",
      "Wiki the whole company lives in",
      "Ghostwriter Labs",
      "Ghostnote Labs",
      "g2_notion_live_r1",
      "capterra_notion_live_r1",
      "2026-01-15T12:00:00.000Z",
    ];
    const raw = JSON.stringify(body);
    for (const needle of fixtureNeedles) {
      if (raw.includes(needle)) process.exit(6);
    }

    function checkScores(scores) {
      if (scores == null || typeof scores !== "object") return;
      const overall = scores.overall;
      const reviewCount = scores.reviewCount;
      if (overall === undefined) process.exit(3);
      if (overall !== null && typeof overall !== "number") process.exit(3);
      if (overall === 0 && (reviewCount === null || reviewCount === 0)) process.exit(4);
      if (typeof scores.max !== "number" || !(scores.max > 0)) process.exit(5);
    }

    function checkReviews(reviews) {
      if (!Array.isArray(reviews)) return;
      for (const review of reviews) {
        if (review == null || typeof review !== "object") process.exit(7);
        if (typeof review.body !== "string" || review.body.trim() === "") process.exit(8);
        if (/sign in to (view|read)/i.test(review.body)) process.exit(9);
        if (review.stars === 0) process.exit(10);
        if (review.stars !== null && typeof review.stars !== "number") process.exit(10);
      }
    }

    if (body?.data?.scores) checkScores(body.data.scores);
    if (body?.data?.a?.scores) checkScores(body.data.a.scores);
    if (body?.data?.b?.scores) checkScores(body.data.b.scores);
    if (body?.data?.reviews) checkReviews(body.data.reviews);
  '
}

note() {
  echo "$*"
}

echo "== live-smoke (G2 + Capterra) =="
echo "live_directories=1 fixture_only=unset g2=${G2_URL} capterra=${CAPTERRA_URL} compare=${COMPARE_A} vs ${COMPARE_B} port=${PORT}"

unset SAASREVIEWS_FIXTURE_ONLY
export SAASREVIEWS_LIVE_DIRECTORIES=1
export PORT
export SAASREVIEWS_DATABASE="$db"
export SAASREVIEWS_BOOTSTRAP_KEY="$KEY"
export NODE_ENV="${NODE_ENV:-development}"

if [[ "${SAASREVIEWS_LIVE_DIRECTORIES}" != "1" ]]; then
  fail "SAASREVIEWS_LIVE_DIRECTORIES must be 1"
fi
if [[ -n "${SAASREVIEWS_FIXTURE_ONLY:-}" ]]; then
  fail "SAASREVIEWS_FIXTURE_ONLY must be unset"
fi

node --import tsx src/server.ts >"$log" 2>&1 &
pid=$!

ready=0
for _ in $(seq 1 80); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "---- server log ----" >&2
    cat "$log" >&2 || true
    fail "server exited before /healthz"
  fi
  if curl -fsS --max-time 1 "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.1
done
[[ "$ready" -eq 1 ]] || fail "server did not become ready on port ${PORT}"

if ! grep -q "SAASREVIEWS_LIVE_DIRECTORIES=1" "$log"; then
  fail "server log did not record live directory mode"
fi

health="$(curl -sS -o "$workdir/health.json" -w "%{http_code}" --max-time 5 \
  "http://127.0.0.1:${PORT}/healthz")"
[[ "$health" == "200" ]] || fail "/healthz returned HTTP ${health}"

me_http="$(request "$workdir/me.json" GET /v1/me)"
[[ "$me_http" == "200" ]] || fail "/v1/me returned HTTP ${me_http}"

g2_http="$(request "$workdir/g2.json" GET "/v1/products/by-url?url=$(encode_query "$G2_URL")")"
g2_id="$(json_print "$workdir/g2.json" data.product.id 2>/dev/null || true)"
if [[ -z "$g2_id" ]]; then
  g2_id="sr_prod_g2_notion"
fi

reviews_http="$(request "$workdir/reviews.json" GET "/v1/products/${g2_id}/reviews?page=1")"
capterra_http="$(request "$workdir/capterra.json" GET "/v1/products/by-url?url=$(encode_query "$CAPTERRA_URL")")"
compare_http="$(request "$workdir/compare.json" GET "/v1/compare?a=$(encode_query "$COMPARE_A")&b=$(encode_query "$COMPARE_B")")"

verdict="PASS"
blocked_all=0

accept_blocked() {
  local file="$1" http="$2"
  local code charged
  if [[ "$http" != "503" && "$http" != "404" ]]; then
    return 1
  fi
  code="$(json_print "$file" error.code 2>/dev/null || true)"
  charged="$(json_print "$file" meta.creditsCharged 2>/dev/null || true)"
  if [[ "$http" == "503" && "$code" == "upstream_blocked" && "$charged" == "0" ]]; then
    return 0
  fi
  if [[ "$http" == "404" && "$code" == "product_not_found" && "$charged" == "0" ]]; then
    return 0
  fi
  return 1
}

# G2 product: 200 + name + honest overall, or SPEC error with 0 credits. Never invent stars.
g2_status="FAIL"
if [[ "$g2_http" == "200" ]]; then
  g2_name="$(json_print "$workdir/g2.json" data.product.name 2>/dev/null || true)"
  g2_dir="$(json_print "$workdir/g2.json" data.product.directory 2>/dev/null || true)"
  g2_overall_type="$(json_type "$workdir/g2.json" data.scores.overall)"
  if [[ -z "$g2_name" ]]; then
    note "g2-product: FAIL — empty name (would be invented if we filled it)"
    verdict="FAIL"
  elif [[ "$g2_dir" != "g2" ]]; then
    note "g2-product: FAIL — directory ${g2_dir:-<missing>}"
    verdict="FAIL"
  elif [[ "$g2_overall_type" != "number" && "$g2_overall_type" != "null" ]]; then
    note "g2-product: FAIL — overall type ${g2_overall_type} (missing overall must stay null)"
    verdict="FAIL"
  elif ! assert_no_invented_stars "$workdir/g2.json"; then
    note "g2-product: FAIL — invented stars, fixture leak, or malformed scores"
    verdict="FAIL"
  else
    g2_status="PASS"
    note "g2-product: PASS — HTTP 200 name=${g2_name} overall=$(json_print "$workdir/g2.json" data.scores.overall) id=${g2_id}"
  fi
elif accept_blocked "$workdir/g2.json" "$g2_http"; then
  g2_status="PASS-ERROR"
  blocked_all=$((blocked_all + 1))
  note "g2-product: PASS-ERROR — HTTP ${g2_http} $(json_print "$workdir/g2.json" error.code), 0 credits (real G2 page blocked or unparseable; stars not invented)"
else
  note "g2-product: FAIL — unexpected HTTP ${g2_http} body=$(head -c 240 "$workdir/g2.json" 2>/dev/null || true)"
  verdict="FAIL"
fi

# G2 reviews: 200 with public bodies, or honest blocked. Never invent a row or star 0.
reviews_status="FAIL"
if [[ "$reviews_http" == "200" ]]; then
  n="$(json_len "$workdir/reviews.json" data.reviews 2>/dev/null || true)"
  if [[ -z "$n" ]]; then
    note "g2-reviews: FAIL — data.reviews is not an array"
    verdict="FAIL"
  elif ! assert_no_invented_stars "$workdir/reviews.json"; then
    note "g2-reviews: FAIL — invented stars, login-wall body, or fixture leak"
    verdict="FAIL"
  else
    reviews_status="PASS"
    note "g2-reviews: PASS — HTTP 200 reviews=${n} (empty is honest; none invented)"
  fi
elif accept_blocked "$workdir/reviews.json" "$reviews_http"; then
  reviews_status="PASS-ERROR"
  blocked_all=$((blocked_all + 1))
  note "g2-reviews: PASS-ERROR — HTTP ${reviews_http} $(json_print "$workdir/reviews.json" error.code), 0 credits (no review invented)"
else
  note "g2-reviews: FAIL — unexpected HTTP ${reviews_http}"
  verdict="FAIL"
fi

# Capterra product: same schema. Missing overall stays null.
capterra_status="FAIL"
if [[ "$capterra_http" == "200" ]]; then
  cap_name="$(json_print "$workdir/capterra.json" data.product.name 2>/dev/null || true)"
  cap_dir="$(json_print "$workdir/capterra.json" data.product.directory 2>/dev/null || true)"
  cap_overall_type="$(json_type "$workdir/capterra.json" data.scores.overall)"
  cap_max="$(json_print "$workdir/capterra.json" data.scores.max 2>/dev/null || true)"
  if [[ -z "$cap_name" ]]; then
    note "capterra-product: FAIL — empty name"
    verdict="FAIL"
  elif [[ "$cap_dir" != "capterra" ]]; then
    note "capterra-product: FAIL — directory ${cap_dir:-<missing>}"
    verdict="FAIL"
  elif [[ "$cap_overall_type" != "number" && "$cap_overall_type" != "null" ]]; then
    note "capterra-product: FAIL — overall type ${cap_overall_type} (missing overall must stay null)"
    verdict="FAIL"
  elif [[ -z "$cap_max" ]]; then
    note "capterra-product: FAIL — missing scores.max"
    verdict="FAIL"
  elif ! assert_no_invented_stars "$workdir/capterra.json"; then
    note "capterra-product: FAIL — invented stars, fixture leak, or malformed scores"
    verdict="FAIL"
  else
    capterra_status="PASS"
    note "capterra-product: PASS — HTTP 200 name=${cap_name} overall=$(json_print "$workdir/capterra.json" data.scores.overall) max=${cap_max}"
  fi
elif accept_blocked "$workdir/capterra.json" "$capterra_http"; then
  capterra_status="PASS-ERROR"
  blocked_all=$((blocked_all + 1))
  note "capterra-product: PASS-ERROR — HTTP ${capterra_http} $(json_print "$workdir/capterra.json" error.code), 0 credits (real Capterra page blocked or unparseable; stars not invented)"
else
  note "capterra-product: FAIL — unexpected HTTP ${capterra_http}"
  verdict="FAIL"
fi

# Compare: both cards + optional delta, or honest blocked. Do not invent a delta from null.
compare_status="FAIL"
if [[ "$compare_http" == "200" ]]; then
  a_name="$(json_print "$workdir/compare.json" data.a.product.name 2>/dev/null || true)"
  b_name="$(json_print "$workdir/compare.json" data.b.product.name 2>/dev/null || true)"
  delta_type="$(json_type "$workdir/compare.json" data.scoreDelta)"
  a_overall_type="$(json_type "$workdir/compare.json" data.a.scores.overall)"
  b_overall_type="$(json_type "$workdir/compare.json" data.b.scores.overall)"
  warning="$(json_print "$workdir/compare.json" data.warning 2>/dev/null || true)"
  if [[ -z "$a_name" || -z "$b_name" ]]; then
    note "compare: FAIL — missing card name"
    verdict="FAIL"
  elif [[ "$a_overall_type" != "number" && "$a_overall_type" != "null" ]]; then
    note "compare: FAIL — a.overall type ${a_overall_type}"
    verdict="FAIL"
  elif [[ "$b_overall_type" != "number" && "$b_overall_type" != "null" ]]; then
    note "compare: FAIL — b.overall type ${b_overall_type}"
    verdict="FAIL"
  elif [[ "$a_overall_type" == "null" || "$b_overall_type" == "null" ]] && [[ "$delta_type" != "null" ]]; then
    note "compare: FAIL — invented scoreDelta from a null overall"
    verdict="FAIL"
  elif [[ "$warning" != "null" && "$warning" != "unmatched" ]]; then
    note "compare: FAIL — unexpected warning ${warning}"
    verdict="FAIL"
  elif ! assert_no_invented_stars "$workdir/compare.json"; then
    note "compare: FAIL — invented stars or fixture leak"
    verdict="FAIL"
  else
    compare_status="PASS"
    note "compare: PASS — HTTP 200 a=${a_name} b=${b_name} delta=$(json_print "$workdir/compare.json" data.scoreDelta) warning=${warning}"
  fi
elif accept_blocked "$workdir/compare.json" "$compare_http"; then
  compare_status="PASS-ERROR"
  blocked_all=$((blocked_all + 1))
  note "compare: PASS-ERROR — HTTP ${compare_http} $(json_print "$workdir/compare.json" error.code), 0 credits (directory blocked; no fake merge or stars)"
else
  note "compare: FAIL — unexpected HTTP ${compare_http}"
  verdict="FAIL"
fi

echo "== summary =="
echo "g2-product=${g2_status} g2-reviews=${reviews_status} capterra-product=${capterra_status} compare=${compare_status} verdict=${verdict}"

if [[ "$verdict" != "PASS" ]]; then
  echo "---- g2 body ----" >&2
  cat "$workdir/g2.json" >&2 || true
  echo "---- reviews body ----" >&2
  cat "$workdir/reviews.json" >&2 || true
  echo "---- capterra body ----" >&2
  cat "$workdir/capterra.json" >&2 || true
  echo "---- compare body ----" >&2
  cat "$workdir/compare.json" >&2 || true
  fail "live-smoke verdict=${verdict}"
fi

# G2 product + reviews must be live SPEC data. A Capterra-only bot wall is a
# documented SPEC error (not invented stars) when G2 already PASSed.
if [[ "$g2_status" != "PASS" || "$reviews_status" != "PASS" ]]; then
  fail "live-smoke needs live G2 product + reviews PASS (not only PASS-ERROR bot wall)"
fi
if [[ "$capterra_status" != "PASS" && "$capterra_status" != "PASS-ERROR" ]]; then
  fail "live-smoke Capterra product was neither PASS nor documented SPEC error"
fi
if [[ "$compare_status" != "PASS" && "$compare_status" != "PASS-ERROR" ]]; then
  fail "live-smoke compare was neither PASS nor documented SPEC error"
fi
if [[ "$capterra_status" == "PASS-ERROR" ]]; then
  note "capterra documented: public .com and regional HTML still Cloudflare-walled from this host; overall not invented"
fi

echo "OK: live flags on; every required flow walked against real G2/Capterra public pages"
