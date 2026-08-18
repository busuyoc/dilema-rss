# Audit — state of this repo (2026-08-17)

This repo is the working prototype. It will be rewritten from scratch in a new repo
(see `DESIGN.md`); this document freezes what we learned here — what works, what's
broken, and which structural mistakes the rewrite must not repeat.

## What works (keep the ideas)

- **The weekly pipeline is solid and battle-tested.** Scrape → EPUB → Pages →
  device has survived real failures and each one left a guard behind:
  - stale-anchor guard in the scraper (W22 shipped six times before it existed)
  - `Verify Pages deploy` step (green workflow ≠ published site, 2026-08-06)
  - Friday healthcheck against the *live* URLs, checking content age not just build age
  - retry cron at 16:00 with a git-log guard against double runs
  - epubcheck as a CI gate (a malformed book fails in CI, not on the device on Thursday)
- **The KOReader plugin's state model is right.** Dated filenames (never a fixed
  path — KOReader keys covers/progress on path), a forward-only high-water mark
  (distinguishes "never had it" from "read it and deleted it"), oldest-first fetch
  with stop-on-failure, atomic tmp+rename writes, and every interactive run ends
  in a message. These invariants were each earned by a real bug; carry them over verbatim.
- **Issue-week addressing everywhere.** Cover art, EPUB name, and jsonl are keyed
  by the *issue's* week (dossier-anchored), not the build date — backfills and
  midweek reruns stay correct.
- **Browser FTS over HTTP range requests** (sql.js-httpvfs) is a genuinely good
  trick: "backend" search on a static site, downloading only the b-tree pages a
  query touches.

## What's broken or unfinished

1. **The archive/search half is not wired into CI.** `scrape.yml` never runs
   `dilema-archive ingest` and never commits `articles.jsonl`/`dilema.db`. The
   published search page serves a database frozen at 2026-07-22 (~W30) while the
   EPUBs are at W33, and it drifts one week further behind every Thursday.
   Updating it is an undone manual chore.
2. **Unfinished untracked work.** `tools/archive/feed.go` and
   `scripts/backfill-urls.sh` are uncommitted, and `feedurls` was never added to
   `main.go`'s command switch — the backfill script dies on its first invocation
   (unknown command → usage() → exit 2 → `set -e`). `dilema-2026-W28.epub` is
   untracked, so W28 is absent from the published OPDS catalog.
3. **Committed build output with a manual build step.** `search/app.js` is a
   checked-in bundle; editing `src/search/main.ts` without `bun run build:search`
   silently ships the old bundle.
4. **Repo-growth time bomb.** A ~350 KB EPUB committed weekly, forever. Fixing #1
   naively adds a freshly-VACUUMed 4.3 MB SQLite file weekly — VACUUM rewrites the
   file so it never delta-compresses: ~250 MB of git history per year. The design
   conflates "git repository" with "publishing bucket".
5. **`articles.jsonl` is a handoff, not an archive.** The scraper overwrites it
   with only the current issue; the SQLite db is the only accumulator, and it's
   binary, unreviewable, and not reproducible from committed inputs.
6. **Two languages for one small system.** The Go archive tool exists only because
   SQLite was needed; Bun has `bun:sqlite` built in. The Go/TS seam created the
   `articles.jsonl` data contract and the drift in #1.
7. **Hardcoded plugin config.** `BASE_URL` and `BOOKS_DIR` (`/mnt/ext1/books/` is
   PocketBook-specific) are constants in `main.lua`. Not forkable, not testable.
8. **Tests cover only pure helpers.** 164 lines over date parsing / regex / XML
   escaping. Nothing exercises discovery, article extraction, EPUB structure, or
   the plugin — the parts that actually broke in production.

## Structural lessons for the rewrite

- **Committed truth must be flat text; binaries must be derived.** Per-issue
  jsonl in git; EPUBs, db, feed built in CI and deployed as a Pages artifact.
  Nothing binary in history. This dissolves #1, #3, #4, #5 and most of the
  backfill machinery (#2 exists only because URLs were once thrown away).
- **If it isn't in CI, it doesn't exist.** Every derived artifact and every
  invariant (freshness, EPUB validity, catalog completeness) needs an automated
  producer and an automated checker.
- **One language, one toolchain.**
- **Config over constants** in anything meant to be forked.
- **Monitoring watches everything published.** The healthcheck covers feed +
  latest EPUB but not the catalog, the dated EPUB, or archive freshness — the
  archive went stale for a month precisely because nothing watched it.
