# Roadmap — build order, and what each phase teaches / signals

Each phase is a milestone (tag + GitHub milestone) delivered through PRs, each PR
carrying its spec, its tests-first commits, and a real description. The history
should read as a story: *specified → tested → built → hardened → operated →
generalized*. Don't start phase N+1 with phase N's checklist unfinished — a
half-wired feature was exactly the prototype's disease (AUDIT.md #1–#3).

## Phase 0 — Bootstrap: the repo is professional before it is useful
Repo skeleton: Bun workspaces, Biome, strict TS, `AGENTS.md`/`CLAUDE.md`,
`docs/specs/` + `docs/adr/` seeded with the already-made decisions
(single repo + key-gated publishing, flat-text truth, no-server), CI running lint + typecheck +
an intentionally-trivial first test, branch protection, Conventional Commits,
actions pinned to SHAs from the first commit, Dependabot on day one.
- *Learning:* project bootstrap, workflow hardening before there's anything to steal.
- *Signal:* the very first commits show process, not scaffolding dumped in bulk.

## Phase 1 — Core pipeline + Dilema adapter (the TDD showcase)
Write the source-adapter contract test suite first; then the core pipeline
(discover → extract → issue-anchor → filter) driven by recorded HTML fixtures;
then the Dilema adapter until the suite is green. Port every prototype postmortem
as a named regression test *before* porting its guard (stale-anchor refusal,
tag-page date pairing, year-correction, window filter).
- *Learning:* TDD against messy real-world HTML; designing a contract others must satisfy.
- *Signal:* red→green commit pairs; fixtures that make markup drift a reviewable diff.

## Phase 2 — Renderers: EPUB, full-text RSS, OPDS
Golden-file tests from synthetic issues; deterministic output; epubcheck in CI;
`content:encoded` full text in RSS; OPDS with cover thumbnails.
- *Learning:* binary format internals (EPUB/OPF/NCX), determinism as a testing strategy.
- *Signal:* "I can implement a spec (EPUB 3, RSS 2.0, OPDS 1.2) and prove conformance."

## Phase 3 — CI/CD & publishing (the DevOps/security showcase)
Artifact-based Pages deploy (OIDC, no committed binaries) with content under the
secret keyed path (`DEPLOY_KEY` repo secret, public landing page at the root),
the scheduled scrape-and-publish workflow, deploy verification against the live
keyed URL, CodeQL + zizmor, SBOM + build-provenance attestation on tagged
releases, release workflow with generated changelog.
- *Learning:* 2026 supply-chain practice end to end on a real pipeline.
- *Signal:* the currently hottest hiring topic (PRACTICES.md §4), demonstrated not listed.

## Phase 4 — Archive & search
`bun:sqlite` builds the FTS db from the jsonl set at deploy time; search UI
bundled in CI; results link to source URL and issue EPUB; archive freshness is
part of the deploy's own verification.
- *Learning:* SQLite/FTS5 internals, the range-request trick, derived-data pipelines.
- *Signal:* the demo-able "wow" feature — full-text search on a static site.

## Phase 5 — Device plugin
Port the Lua plugin with its earned invariants; extract the sync state machine
into pure functions with their own tests; base URL / books dir / pattern become
settings with a minimal UI.
- *Learning:* testing around an embedded host you can't run in CI; config vs constants.
- *Signal:* breadth — TS, Lua, e-ink constraints, offline-first thinking.

## Phase 6 — Operations
Healthcheck v2 (content age, catalog completeness, archive freshness, search
bundle) filing deduplicated issues; structured run-summary logs; stated SLO;
`RUNBOOK.md` seeded from the prototype's real incidents.
- *Learning:* operating software, not just shipping it — SLOs at hobby scale.
- *Signal:* "I think about week two, not just the merge."

## Phase 7 — Second source (proof of the abstraction)
Add another weekly publication as a pure adapter + fixtures. Zero core changes is
the acceptance criterion; any core change it forces gets its own ADR explaining
what the abstraction got wrong.
- *Learning:* the honest test of an interface; refactoring under a contract.
- *Signal:* "engine" is demonstrated, not claimed.

## Phase 8 — The exhibit
README with diagram, screenshots (search page, EPUB on device), public landing
page at the site root, "how it's built" section linking specs/ADRs/CI runs,
AI-usage note, pinned on the profile. For recruiters who should see it running,
share the keyed URL privately (in an application email, not in the README). Then — separately, privately — the outreach message
to Dilema's publisher, leading with the tool, closing with the RSS/site offer.

## Definition of done, per phase
- Spec merged; tests first; CI green including gates; docs updated
  (README/RUNBOOK/ADR as applicable); milestone closed with a short retro note
  in the PR or tag message. No untracked files, no manual steps left behind.

## Prototype closeout (this repo, before the rewrite starts)
Two-minute fixes so the frozen reference isn't broken mid-gesture: wire
`feedurls` into `tools/archive/main.go`, commit `feed.go`,
`backfill-urls.sh`, and `dilema-2026-W28.epub`. Then add a README pointer to the
new repo and freeze.
