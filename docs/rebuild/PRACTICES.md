# Practices — how the rewrite gets built (2026 edition)

The rewrite is a learning vehicle and a hiring signal as much as a tool. This file
pins the practices, researched Aug 2026, that the repo must visibly demonstrate.
Each section says *what to do* and *what it signals*.

## 1. Spec-driven development (SDD)

The 2026 default for AI-native engineering: a version-controlled spec — not the
code — is the source of truth. Four phases with checkpoints: **specify → plan →
tasks → implement**, and a good spec covers outcomes, scope boundaries,
constraints, prior decisions, task breakdown, and verification criteria.
GitHub's Spec Kit is the reference tooling if I want scaffolding.

Applied here:
- Every feature starts as `docs/specs/NNN-name.md` written *before* code, in
  dialogue with the AI, and merges in the same PR as (or before) the implementation.
- `docs/adr/` records the decisions specs depend on (engine/instance split,
  flat-text truth, no-server verdict) — short, numbered, immutable.
- Signal: a recruiter opening any PR sees requirement → plan → tests → code,
  in that order, in history.

## 2. TDD, adapted for AI agents

The 2026 concern: when AI writes both code and after-the-fact tests, the tests
confirm what the AI wrote, not what the feature requires — and agents skip the
Red phase unless forced. The countermeasure is writing (and committing) the
failing test first, so "correct" is defined before implementation exists.

Applied here:
- Red-green-refactor with the test committed before or alongside implementation;
  commit messages show it (`test: pin issue-anchor lag guard (red)` → `feat: …`).
- Test pyramid that matches how the prototype actually failed:
  - **fixture tests** — recorded HTML snippets drive discovery/extraction (markup
    drift, the #1 real-world failure, becomes a fixture update with a diff);
  - **golden-file tests** — byte-stable EPUB/RSS/OPDS output per synthetic issue;
  - **contract tests** — one suite every source adapter must pass;
  - **gates in CI** — epubcheck, XML validation, coverage threshold;
  - **regression rule** — every prototype postmortem (stale anchor, missed-week
    catalog walk, deleted-issue mark) lands as a named test before its logic is ported.
- CLAUDE.md/AGENTS.md instructs agents to follow this loop; hooks can enforce it.

## 3. AI-assisted development — used openly, with a policy

2026 reality check: 30–45% of AI-generated snippets carry CWE-class
vulnerabilities in studies; review is the new bottleneck; AI is weakest at
architectural context and strongest at well-specified, verifiable units. The
professional posture is neither "no AI" nor "vibes" — it's **documented
division of labor with verification**.

Applied here:
- `AGENTS.md` (+ `CLAUDE.md`) in-repo: project map, invariants agents must not
  break, the TDD loop, commands, and no-go zones. This file is itself a signal —
  it shows I can *operate* AI tooling, not just consume it.
- Division of labor, stated in the README:
  - **Human owns:** specs, architecture/ADRs, security-sensitive review
    (workflows, anything touching tokens), final review of every diff.
  - **AI executes:** implementation against a spec + failing tests, refactors,
    fixture generation, docs drafts.
  - **Where AI falls short (and the design compensates):** whole-system
    architectural coherence (→ ADRs + specs give it context), silent security
    regressions (→ hardened CI reviews the robot too), plausible-but-wrong
    output (→ golden files and contract tests, not trust).
- Honest AI-usage note in the README. In 2026 hiding it reads worse than
  managing it well.

## 4. CI/CD & supply-chain security

The hot topic of 2026 CI/CD, post tj-actions/changed-files, Nx and the npm
worm — GitHub's own 2026 Actions security roadmap (dependency locking, egress
controls, policy enforcement, read-only caches for untrusted triggers) is a
direct response. A repo that demonstrates this hygiene is current in a way most
portfolios aren't.

Applied here:
- **Pin every action to a full commit SHA** (Dependabot/Renovate keeps them
  fresh); no mutable tags.
- **Least privilege:** default `GITHUB_TOKEN` permissions read-only, escalated
  per-job; Pages deploys through the OIDC `actions/deploy-pages` flow, no PATs.
- **Locked, frozen installs** (`bun install --frozen-lockfile`); Dependabot for
  npm deps; CodeQL on the TS code; **zizmor** (or actionlint) linting the
  workflows themselves.
- **Provenance:** `actions/attest-build-provenance` on released artifacts and an
  SBOM — lightweight SLSA-style attestation, the level appropriate for a small
  project (attestation early, heavier levels only if distribution grows).
- Branch protection: PRs only on main, required checks, linear history.

## 5. Right-sized DevOps

2026 framing: observability as intentional telemetry, SLOs and error budgets as
the management tool. At weekly-cron scale that translates to:
- structured, greppable run logs (one JSON summary line per stage);
- synthetic monitoring of everything *published* (healthcheck → auto-filed issue);
- a stated freshness SLO with the mechanisms that defend it (retry cron, deploy
  verification, catalog walk on the device);
- `RUNBOOK.md`: symptom → diagnosis → action, seeded from the prototype's real
  incidents.

## 6. Toolchain (the 2026 low-overhead stack)

- **Bun** — runtime + package manager + test runner + workspaces; TS runs
  natively, no transpile step, no config sprawl.
- **Biome** — lint + format in one binary (the ESLint+Prettier replacement).
- **TypeScript strict**, project references across workspace packages.
- The 2026 pendulum is consolidation: few tools, few config files — and that
  minimalism is itself the point being demonstrated.

## 7. The repo as a hiring exhibit

What 2026 recruiters actually do: ~90 seconds on the profile, looking at 2–4
pinned repos for a clean README, real functionality, a live demo, and
professional git habits (meaningful history over activity volume).

Applied here:
- README leads with what/why, an architecture diagram, a screenshot of search +
  the EPUB on-device, and a "how it's built" section linking specs, ADRs, CI.
- Public landing page at the site root; the running instance is key-gated
  (capability URL) and shared privately with people who should see it live.
- Conventional Commits; even solo, feature work goes through PRs with real
  descriptions — the review trail is the point.
- Milestones/tags per roadmap phase so history reads as a narrative.
- The prototype's habit of commit messages that explain *why* (see its
  `fix(scraper): only attach homepage cover art on the issue's build day`)
  is exactly the habit to keep.

## Sources

- [GitHub Actions 2026 security roadmap (GitHub Blog)](https://github.blog/news-insights/product-news/whats-coming-to-our-github-actions-2026-security-roadmap/)
- [Disrupting supply chain attacks on npm and GitHub Actions (GitHub Blog)](https://github.blog/security/supply-chain-security/disrupting-supply-chain-attacks-on-npm-and-github-actions/)
- [GitHub Actions supply-chain hardening checklist (Corgea)](https://corgea.com/learn/github-actions-security-checklist)
- [Spec-Driven Development best practices (Allegro Tech)](https://blog.allegro.tech/2026/06/spec-driven-development-best-practices.html)
- [Spec-Driven Development: AI-native engineering (Microsoft)](https://developer.microsoft.com/blog/spec-driven-development-ai-native-engineering/)
- [SDD in 2026: tooling and team usage (DEV Community)](https://dev.to/krlz/spec-driven-development-in-2026-what-it-is-the-tooling-and-how-teams-actually-use-it-2fk2)
- [Guide AI agents through TDD (Elite AI-Assisted Coding)](https://elite-ai-assisted-coding.dev/p/guide-ai-agents-through-test-driven-development)
- [TDD with AI agents — 2026 practices (QASkills)](https://qaskills.sh/blog/tdd-ai-agents-best-practices)
- [AI code quality crisis — engineering leader guide](https://www.ofashandfire.com/blog/ai-generated-code-quality-crisis)
- [SLSA framework guide 2026 (Practical DevSecOps)](https://www.practical-devsecops.com/slsa-framework-guide-software-supply-chain-security/)
- [Software & DevOps trends shaping 2026 (DZone)](https://dzone.com/articles/software-devops-trends-shaping-2026)
- [The 2026 low-overhead TS stack: Bun + Turborepo + Biome](https://www.untergletscher.com/en/blog/modern-monorepo-bun-turborepo-biome-2026-guide)
- [TypeScript setup 2026: Bun + Biome + tests](https://bishrulhaq.com/posts/typescript-project-setup-in-2026-bun-biome-and-vitest-a-complete-stack)
- [GitHub profile checklist 2026 — what recruiters look at (Instahyre)](https://resources.instahyre.com/blog/github-profile-checklist/)
- [What tech recruiters look for in a GitHub profile](https://readmedesign.com/blog/what-recruiters-look-for)
