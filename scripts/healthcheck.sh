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
MAX_ITEM_AGE_DAYS="${MAX_ITEM_AGE_DAYS:-9}"

fail() { echo "UNHEALTHY: $1" >&2; exit "${2:-1}"; }

feed=$(curl -fsS "$BASE_URL/feed.xml") \
  || fail "feed.xml unreachable at $BASE_URL/feed.xml" 2
curl -fsSI "$BASE_URL/dilema-latest.epub" >/dev/null \
  || fail "dilema-latest.epub unreachable at $BASE_URL/dilema-latest.epub" 2

# GNU date (Linux/CI) vs BSD date (macOS) parse RFC-1123 differently.
to_epoch() {
  date -d "$1" +%s 2>/dev/null || date -j -f "%a, %d %b %Y %T %Z" "$1" +%s
}

age_in_days() { echo $(( ($(date +%s) - $(to_epoch "$1")) / 86400 )); }

last_build=$(sed -n 's|.*<lastBuildDate>\(.*\)</lastBuildDate>.*|\1|p' <<<"$feed")
[ -n "$last_build" ] || fail "feed.xml served but has no <lastBuildDate>"

build_age=$(age_in_days "$last_build")
echo "feed.xml lastBuildDate: $last_build (${build_age}d old, max ${MAX_AGE_DAYS}d)"

[ "$build_age" -le "$MAX_AGE_DAYS" ] \
  || fail "feed is ${build_age} days old — scraper or Pages deploy is broken"

# lastBuildDate only says the scraper ran; it is stamped fresh even when the
# scrape re-published a stale issue. From 2026-06-04 to 2026-07-02 the dossier
# anchor was stuck and W22 shipped six times under new week numbers, with a
# fresh lastBuildDate every Thursday. The newest <pubDate> is what actually
# ages when that happens, so check the content, not just the build.
#
# This is a backstop, not the primary guard: the scraper itself now fails when
# the issue date lags the expected Thursday, which catches the first bad week
# outright. By the time it reaches here a stale issue is already a week old, so
# the threshold stays loose enough not to cry wolf over a legitimately thin week.
newest_item=$(sed -n 's|.*<pubDate>\(.*\)</pubDate>.*|\1|p' <<<"$feed" \
  | while read -r d; do echo "$(to_epoch "$d") $d"; done | sort -rn | head -1 | cut -d' ' -f2-)
[ -n "$newest_item" ] || fail "feed.xml served but has no <pubDate> items"

item_age=$(age_in_days "$newest_item")
echo "newest item pubDate:   $newest_item (${item_age}d old, max ${MAX_ITEM_AGE_DAYS}d)"

[ "$item_age" -le "$MAX_ITEM_AGE_DAYS" ] \
  || fail "newest article is ${item_age} days old — the feed is fresh but the issue is stale"

echo "HEALTHY"
