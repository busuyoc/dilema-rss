#!/usr/bin/env bash
# Fill missing article URLs from feed.xml git history.
#
# EPUB-backfilled archive rows have no URLs (EPUBs don't contain them), but
# each week's feed.xml did — and git remembers every version. Walk all commits
# that touched feed.xml, oldest first, and replay each version through
# `dilema-archive feedurls`, which matches rows by (issue, title) and only
# ever fills NULLs.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [ ! -x tools/archive/dilema-archive ]; then
  echo "building dilema-archive…" >&2
  go build -C tools/archive -o dilema-archive .
fi

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

for sha in $(git log --reverse --format=%H -- feed.xml); do
  git show "$sha:feed.xml" > "$tmp" 2>/dev/null || continue
  tools/archive/dilema-archive feedurls "$tmp"
done

tools/archive/dilema-archive stats | sed -n '1,4p'
