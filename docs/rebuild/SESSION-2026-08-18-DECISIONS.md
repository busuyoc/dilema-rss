# Planning session, 2026-08-18 — decisions to carry into Phase 0

This is a handoff note from a planning conversation (talk-only, no code) held
before the new repo exists. It's an addendum to `NEXT-SESSION.md`, which
remains the primary kickoff brief — read that first. This file records *why*
a few things in `DESIGN.md`/`ROADMAP.md` changed today, so the reasoning
isn't lost even though the docs themselves are already updated.

## Context: timeline

Target is a job fair at the end of October 2026 (~2.5 months out), with 3-4
strong portfolio projects wanted by then. This engine is one of the smaller
ones — budget roughly 1-2 weeks of real work, not the full 9-phase roadmap.
**Phases 0–3 (bootstrap, core pipeline + adapter, renderers, hardened CI/CD)
are the actual deliverable.** Phases 4–8 are stretch goals, pursued only if
0–3 land solid with time to spare. Do not thin out 0–3's depth to rush toward
later phases.

## Decision 1 — RSS is a `discover` implementation, not a new port

`Source.discover(fetch): AsyncIterable<Candidate>` was already mechanism-
agnostic. Confirmed explicitly: an RSS-feed-parsing adapter and an
HTML-listing-crawl adapter both just satisfy that same signature. No new
interface needed. If a second RSS-based source shows up later, factor a
shared `rssDiscovery(feedUrl)` helper out *then* — not preemptively for one
source.

## Decision 2 — layout lives in the adapter, against an engine vocabulary

Original idea floated (and rejected) in this session: a shared template
hardcoding book structure as "cover → TOC → caricature → sections". Rejected
because it bakes in an assumed magazine-format convention before a second
source (Phase 7) exists to test it — exactly what Phase 7's "zero core
changes, or it gets an ADR" acceptance criterion is designed to catch.

Resolution: the engine defines a small vocabulary of layout primitives
(`LayoutSlot`: `cover`, `toc`, `art`, `section`); each adapter declares its
own full ordered sequence using them. See `DESIGN.md`'s source-adapter
contract section for the type. Open question flagged for Phase 7, not now:
is `art` (single ref) general enough, or will a second source need multiple
images / a different art shape? Stress-test this when Phase 7 arrives.

## Decision 3 — per-article images, added scope (not a straight port)

The prototype never fetched or embedded per-article images (only cover/
caricature art). Decided to add this, with explicit rules rather than letting
it accrete accidentally:

- jsonl stores the image **URL**, never bytes — consistent with flat-text-truth;
  bytes are fetched and embedded at render time, same as every other derived
  artifact.
- Render with `max-width: 100%; height: auto` so arbitrary source aspect
  ratios reflow to the device's text column — this was raised as a concern
  (PocketBook, 22pt font, inconsistent image sizes) and is a solved problem
  in EPUB CSS, not something to design custom logic around.
- **A failed image fetch silently drops the block.** No broken-image glyph,
  no alt-text placeholder standing in for the missing image. This needs a
  named fixture/regression test (dead image URL → clean render) before it
  ships — don't let this behavior go untested and drift.
- Known accepted risk: full rebuilds re-fetch images for every historical
  issue on every deploy, so a source removing/changing an old image degrades
  a back issue silently. Accepted as best-effort (matches the project's
  no-extra-infra stance) rather than building an out-of-git image cache.
  Revisit only if it becomes a recurring practical problem.

## Decision 4 — local preview command, required early

The prototype's worst iteration loop was tuning section order / cover
placement: commit → push → wait for CI → download the EPUB → check on a
reader or device. Fix: `bun run preview <issue>.jsonl` renders an EPUB
locally from any jsonl (including fixtures), no deploy round-trip. This
should exist early enough (Phase 1/2) that layout and ordering tuning never
again goes through a live deploy to get feedback.

## Decision 5 — division of labor, Phase 1 specifically

The owner hand-writes Phase 1 (core pipeline + Dilema adapter: discover/
extract/issue-anchor logic, the regression tests for real postmortems) rather
than delegating it — deliberate TypeScript-internals practice, not just the
TDD showcase the roadmap already frames it as. Scaffolding (Phase 0), CI
config, and renderer boilerplate (Phases 2-3) are fine for the AI worker to
draft for review — those don't carry the same learning intent.

## Repo name

Leaning **kiosk** — Romanian-flavored without being cute about it, doesn't
scope the name to scraping/EPUB/Dilema specifically, and reads naturally as
"a stand carrying several publications," which matches the multi-source
direction. Not locked — check GitHub/npm name availability first. Fallbacks:
`kiosk-engine`, `press-kiosk`.
