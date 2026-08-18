# Kickoff brief for the next Claude session

Paste this (or point the session at this file) when starting the rebuild.

---

## Who you're working with and what this is

I'm rebuilding my Dilema Veche RSS/EPUB pipeline from scratch as a **multi-source
weekly-press engine**, in a **new repo**. The old repo (`~/Personal/Projects/dilema-rss`)
is a working prototype, now frozen reference material — read from it, never build on it.

Two goals, equally weighted:
1. **Learning value.** The previous version was heavily AI-built and I can't defend
   it in an interview. This time I need to own every decision. Explain as we go,
   keep changes small enough for me to follow, and expect me to write parts myself.
2. **Hiring signal.** The repo — its git history, specs, tests, CI — is a portfolio
   exhibit for recruiters. Process visibility is a feature, not overhead.

## Read these before doing anything

All in the old repo, and they are binding — the thinking is already done:

- `docs/rebuild/AUDIT.md` — what the prototype taught us; invariants to port verbatim.
- `docs/rebuild/DESIGN.md` — the architecture. Source of truth for structure.
- `docs/rebuild/PRACTICES.md` — the 2026 practices this project demonstrates
  (spec-driven dev, TDD with AI, supply-chain-hardened CI, right-sized ops), with sources.
- `docs/rebuild/ROADMAP.md` — build order, phase goals, definition of done.

Skim as needed: the prototype's `src/scraper.ts`, `dilema.koplugin/main.lua`, and
`.github/workflows/` — the comments there record real production incidents.

## Decisions already made — don't relitigate

- **One public repo**, key-gated publishing via capability URL (secret path segment
  from an Actions secret; Pages can't do real auth). Public landing page at the
  root, no content links. Keyed URL is shared privately, never in the README.
- **Flat text is truth:** per-issue `issues/YYYY-Www.jsonl` committed; EPUB, feed,
  OPDS, SQLite db, search bundle are all derived in CI and deployed as Pages
  artifacts. **No binaries in git history. Ever.**
- **No server, no pipeline database.** Batch job + static hosting. SQLite exists
  only as a derived, published output format for search (`bun:sqlite`, FTS5).
- **Toolchain:** Bun (runtime/pm/test/workspaces), Biome, strict TypeScript,
  no build step for the pipeline. One language — the Go tool does not come along.
- **Source adapters:** core knows nothing about Dilema; `sources/dilema.ts` is the
  only file that does. Second source (Observator Cultural) validates the
  abstraction later — zero core changes is the acceptance criterion.
- **Content stays scraped-and-republished under the key.** I've accepted the
  tradeoff that jsonl in a public repo is technically reconstructable. If that
  ever needs revisiting, it gets an ADR — don't re-raise it unprompted.

## How we work

- **Spec first.** Every feature starts as `docs/specs/NNN-name.md`, written in
  dialogue with me, merged with or before the implementation. Big decisions get
  short ADRs in `docs/adr/`.
- **TDD, visibly.** Failing test committed first or in the same PR with red→green
  commit pairs. You don't write a test after the implementation and call it TDD.
  Every prototype postmortem becomes a named regression test before its guard is ported.
- **Conventional Commits; PRs even solo,** with real descriptions. History must
  read as a narrative. Commit messages explain *why* (the prototype is the model).
- **Small steps.** One phase at a time per ROADMAP.md; don't start N+1 with N
  unfinished; no untracked files or manual steps left behind — that was the
  prototype's disease.
- **Scope discipline.** Build what I actually use. If a task balloons or needs a
  big recovery/destructive operation, stop and ask. A spec/prototype gap is not a
  defect unless it was in decided scope.
- **Division of labor** (from PRACTICES.md §3): I own specs, architecture calls,
  and final review; you implement against specs and tests, refactor, generate
  fixtures, draft docs. Flag security-sensitive diffs (workflows, tokens,
  anything touching the key) for extra scrutiny instead of waving them through.
- **Communication:** English, human tone, complete sentences — not compressed
  bullet-spray. When you make a claim about my files, check the file first.
  Deliverables are local files in the repo; never publish hosted pages/artifacts.

## First session agenda (Phase 0 — bootstrap)

1. I create the GitHub repo (need: a name — undecided; propose options).
2. Scaffold: Bun workspaces (`packages/core`, `epub`, `feeds`, `archive`,
   `search-ui`; `sources/`; `plugin/`; `docs/specs`, `docs/adr`), Biome, strict
   TS, `AGENTS.md`/`CLAUDE.md` encoding the working agreements above.
3. Seed ADRs 001–003: single repo + capability URL; flat-text truth / derived
   binaries; no server. Short, numbered, immutable.
4. CI from the first commit: lint + typecheck + one real trivial test; every
   action pinned to a full commit SHA; default token permissions read-only;
   Dependabot for npm + actions.
5. Branch protection on main (PRs only, required checks, linear history).
6. Generate `DEPLOY_KEY` (I'll set the secret myself) — nothing publishes yet,
   but the workflow shape anticipates the keyed path.

Definition of done for the session: repo public, CI green on a PR, ADRs merged,
and I can explain every file that exists.

## Open items that need my input when they come up

- Repo/engine name: leaning **kiosk** (Romanian-flavored, not scraper/EPUB/
  Dilema-scoped, evokes a stand carrying multiple publications — fits the
  multi-source direction). Not yet locked; check GitHub/npm availability
  before committing. Fallbacks if taken: `kiosk-engine`, `press-kiosk`.
- Second-source timing (Observator Cultural — Phase 7, not before).
- Outreach message to Dilema's publisher — Phase 8, drafted with me, sent by me.

## 2026-08-18 planning session — decisions made, see `SESSION-2026-08-18-DECISIONS.md`

Prototype closeout is done (old repo frozen, archive backfilled, README points
here). A planning conversation before Phase 0 refined several DESIGN.md/
ROADMAP.md sections — read `SESSION-2026-08-18-DECISIONS.md` for the full
reasoning; the docs themselves already carry the resulting decisions:
- RSS-based `discover` is a first-class adapter shape, not a separate port.
- Source contract gains `layout: LayoutSlot[]` — full book structure declared
  per-adapter against an engine-defined vocabulary, no shared hardcoded template.
- Per-article images: URL in jsonl, bytes fetched/embedded at render time,
  failed fetch silently drops the block (no broken-image glyph, no alt text
  stand-in), responsive CSS handles arbitrary aspect ratios.
- A local `bun run preview <issue>.jsonl` command is required early — this is
  the fix for the prototype's slow tune-and-redeploy loop on layout/order.
- Scope for the Oct job fair: Phases 0–3 are the real deliverable; 4–8 are
  stretch. Phase 1 core/adapter logic is hand-written by the owner, not delegated.
