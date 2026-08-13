#!/usr/bin/env bash
# Health check for the *published* feed — hits the live GitHub Pages URLs, not
# the repo. Catches the failure mode where the scraper commits happily but
# Pages stopped serving (unpublished site, broken build), which a green
# scrape workflow can't see.
#
# Exit codes: 0 = healthy, 1 = stale content, 2 = unreachable.
set -euo pipefail

BASE_URL="${BASE_URL:-https://busuyoc.github.io/dilema-rss}"
MAX_AGE_DAYS="${MAX_AGE_DAYS:-8}"

fail() { echo "UNHEALTHY: $1" >&2; exit "${2:-1}"; }

feed=$(curl -fsS "$BASE_URL/feed.xml") \
  || fail "feed.xml unreachable at $BASE_URL/feed.xml" 2
curl -fsSI "$BASE_URL/dilema-latest.epub" >/dev/null \
  || fail "dilema-latest.epub unreachable at $BASE_URL/dilema-latest.epub" 2

last_build=$(sed -n 's|.*<lastBuildDate>\(.*\)</lastBuildDate>.*|\1|p' <<<"$feed")
[ -n "$last_build" ] || fail "feed.xml served but has no <lastBuildDate>"

# GNU date (Linux/CI) vs BSD date (macOS) parse RFC-1123 differently.
if build_epoch=$(date -d "$last_build" +%s 2>/dev/null); then
  :
else
  build_epoch=$(date -j -f "%a, %d %b %Y %T %Z" "$last_build" +%s)
fi

age_days=$(( ($(date +%s) - build_epoch) / 86400 ))
echo "feed.xml lastBuildDate: $last_build (${age_days}d old, max ${MAX_AGE_DAYS}d)"

[ "$age_days" -le "$MAX_AGE_DAYS" ] \
  || fail "feed is ${age_days} days old — scraper or Pages deploy is broken"

echo "HEALTHY"
