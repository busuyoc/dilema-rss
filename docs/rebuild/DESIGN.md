# Design — the ground-up rewrite

Goal: rebuild the prototype as a **multi-source weekly-press engine** in a new repo,
built the way a professional 2026 project is built — and have the repo itself be the
portfolio piece: the git history, CI, tests and docs are the exhibit, not just the
running program. `AUDIT.md` lists what the prototype taught us; `PRACTICES.md` lists
the 2026 practices this design commits to; `ROADMAP.md` sequences the build.

## The one big decision: one public repo, key-gated publishing

One repo. The code, tests, CI and docs are fully public — that's the portfolio.
The *published artifacts* (feed, EPUBs, catalog, search db) are gated by a key,
so people can read the code but can't casually use my instance as their feed.

(A two-repo public-engine / private-instance split was considered and rejected:
this is a tool barely anyone knows about, and the split doubles the repo overhead
to defend against an audience that doesn't exist.)

**Mechanism — capability URL, because static hosting can't do real auth.**
GitHub Pages serves files; there is no server to check a password. The honest
static-site equivalent of a key is an unguessable path segment:

- CI reads `DEPLOY_KEY` (a repo Actions secret, masked in logs, never in git)
  and deploys every content artifact under `/_/<DEPLOY_KEY>/…`
  (`/_/<key>/feed.xml`, `/_/<key>/dilema-2026-W33.epub`, `/_/<key>/archive.db`).
- The site root is a public landing page: what the project is, architecture,
  link to the repo — no content links. Pages has no directory listing, so the
  keyed path is unreachable without the key.
- The KOReader plugin and any feed reader take the key as part of their
  configured base URL. Rotation = change the secret, redeploy, update the device.
- Search: the page shell can stay public, but it asks for the key once (stored
  in localStorage) and fetches the db from the keyed path.

**What the key does and doesn't protect — stated plainly in the README,**
because claiming more would be amateur: it's access control against link-sharing
and crawlers, not cryptography. And since the per-issue jsonl archive is
committed to a public repo, the *content* is technically reconstructable by
anyone determined; the key gates the convenient, subscribable artifacts, which
matches the actual threat model (nobody should be able to point a feed reader at
my instance, but hiding the code would defeat the project's purpose). If the
content-in-git part ever becomes a problem (e.g. before showing the repo to
Dilema's publisher), the escape hatch is moving `issues/` out of git — that
decision gets its own ADR when and if it's needed, not now.

## Architecture

Bun workspaces monorepo, TypeScript everywhere, no build step for the pipeline
(Bun runs TS natively). One runtime = package manager = test runner; Biome for
lint + format (one binary, replaces ESLint + Prettier — the 2026 consolidation
stack, see PRACTICES.md).

```
repo/
  packages/
    core/        pipeline: discover → extract → filter-to-issue → render → publish
    epub/        EPUB 3 writer (cover, sections, nested TOC, epubcheck-clean)
    feeds/       RSS 2.0 (full-text content:encoded) + OPDS 1.2 renderers
    archive/     per-issue jsonl store + derived SQLite (bun:sqlite, FTS5)
    search-ui/   static FTS frontend (sql.js-httpvfs over range requests)
  sources/
    dilema.ts    the Dilema adapter — the only file that knows about dilema.ro
  issues/
    2026-W33.jsonl   committed per-issue archive: the source of truth
  plugin/
    press.koplugin/   KOReader plugin, base URL (incl. key) / books dir as settings
  docs/
    specs/       one spec per feature (spec-driven development, see PRACTICES.md)
    adr/         architecture decision records
    RUNBOOK.md   operational: what breaks, how it shows up, what to do
```

### The source-adapter contract

The core never knows about Dilema. A source is a module implementing:

```ts
interface Source {
  id: string;                       // "dilema"
  discover(fetch): AsyncIterable<Candidate>;   // listing pages → {url, hintDate?}
  extract(html, url): Extracted;               // → title, author, section, date, blocks
  issueAnchor(candidates): Date;               // what week "this issue" is
  issueArt?(issue, fetch): Promise<Image[]>;   // cover, caricature…
  sections: SectionSpec[];                     // ordering + labels
}
```

Everything the prototype hardcoded (SECTIONS, EXTRA_TAGS, the regexes, the
dossier-anchor rule, cover URL scheme) becomes one adapter file. A second adapter
(any weekly with listing pages) is a roadmap milestone precisely because it
proves the interface isn't a lie.

### Data model: flat text is truth, binaries are derived

- `issues/YYYY-Www.jsonl` — one line per article `{url, title, subtitle, author,
  section, date, issue, blocks}`. Committed, append-only
  across weeks, diffable, reviewable in a PR. **This is the archive.**
- EPUB, `feed.xml`, `catalog.xml`, `archive.db`, and the search bundle are all
  **built in CI from the jsonl set** and deployed via the `actions/deploy-pages`
  artifact flow. No binary ever enters git history; the db can be VACUUMed
  freely because it isn't versioned; a renderer fix retroactively improves every
  back issue on the next deploy.
- Rendering is deterministic: same jsonl in, byte-comparable artifacts out
  (fixed timestamps from issue metadata, stable ordering). Determinism is what
  makes golden-file tests and build provenance meaningful.

### Renderers

- **EPUB:** carry over the earned invariants — dual cover declaration
  (EPUB 2 meta + EPUB 3 properties), issue-week UID, issue-week-addressed art,
  sections in taxonomy order, nested TOC. Validated by epubcheck in CI.
- **RSS:** full article text in `content:encoded`, not just author+subtitle —
  the feed becomes readable in any client. This doubles as the working prototype
  of the "real RSS endpoint" to offer Dilema's publisher.
- **OPDS:** catalog over all issues + per-entry cover thumbnails (KOReader
  renders them in its OPDS browser).

### Archive & search

`bun:sqlite` builds `archive.db` (FTS5, `remove_diacritics`) from the jsonl set
on every deploy — always complete, never drifts, no Go toolchain, no ingest
choreography, no URL backfill (URLs are never thrown away). Search frontend is
the range-request trick from the prototype, bundled in CI, results linking both
to the source URL and to the issue EPUB.

### Device plugin

Same state machine as the prototype (dated filenames, forward-only mark,
oldest-first stop-on-failure, atomic writes, always-answer UX), but base URL,
books directory, and filename pattern are LuaSettings-backed configuration with
a settings UI — one plugin serves any engine instance. Pure state-machine logic
(mark advancement, pending-issue selection, catalog parsing) is extracted into
functions testable with plain `busted`/lua outside KOReader.

### Operations

- **Scheduled scrape:** scrape → jsonl commit → build → epubcheck + link/XML
  validation → deploy under the keyed path → verify the deploy actually serves
  the new issue (poll the live keyed URL for the new issue id, not just the
  Pages build status).
- **Synthetic monitoring:** next-day healthcheck against live URLs — feed
  freshness *and content* age, catalog completeness (every issue jsonl has a
  live EPUB), archive freshness (`max(issue)` == current week), search bundle
  loads. Failure files a deduplicated GitHub issue.
- **A stated SLO,** because a pipeline without a target isn't operated:
  *"the new issue is on the device by Thursday 18:00 RO for ≥ 95% of weeks"* —
  with the retry cron, deploy verification and healthcheck as the mechanisms,
  and a `RUNBOOK.md` mapping each alarm to a diagnosis and action.

## Explicit non-goals

- No server, no database-as-backend. The system is a batch job + static hosting;
  a DB in the pipeline's control path adds state, ops burden and failure modes
  for zero benefit at one-run-per-week scale. SQLite appears only as a derived,
  published *output format* for search. (This was proposed and rejected; the
  prototype's drifted `dilema.db` is the evidence for the rejection.)
- No advertised public content surface: the landing page describes the project
  but links no artifacts; everything consumable sits behind the key.
- No deep site backfill: discovery reads first-page listings only, accepted limit.
- No Kubernetes/Terraform cosplay. DevOps signal comes from doing the *right-sized*
  ops (CI/CD hardening, provenance, monitoring, SLO, runbook) impeccably, not from
  dragging enterprise infrastructure into a static-site cron job.
