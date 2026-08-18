# Reference implementations for the rebuild

Runnable TypeScript pinning the two contract rules the 2026-08-18 review added
to `DESIGN.md`, so the kiosk repo adopts working, tested semantics instead of
re-deriving them from prose. This is **spec material, not prototype code** — it
imports nothing from the old scraper and ships with its tests.

Run from the repo root:

```bash
bun test docs/rebuild/reference
```

## `layout.ts` — "nothing vanishes"

`resolveLayout()` turns an adapter's `LayoutSlot[]` declaration into the
concrete book structure. It settles the open question from DESIGN.md in favor
of **both** options: the vocabulary has an explicit `{ kind: "rest" }` slot for
placing the undeclared-section bucket, *and* the engine appends the bucket at
the end when no `rest` slot is declared — so omitting it can move the bucket,
never delete articles. Empty sections and unfetched art drop silently; invalid
layouts (typo'd section id, duplicates) throw at resolve time.

## `images.ts` — pure render over (jsonl + fetched bytes)

`resolveImages()` is the injectable fetch layer: the renderer never touches the
network, it receives resolved bytes. A failed or throwing fetch silently drops
that image block — no glyph, no alt-text stand-in — per decision #3. The tests
include the required dead-URL regression case and the reproducibility check
with a stubbed fetcher.

## Adopting into kiosk

- `LayoutSlot`/`SectionSpec` belong in `packages/core` (the contract);
  `resolveLayout` in the EPUB renderer's input stage (`packages/epub`).
- `ImageFetcher`/`resolveImages` sit in `packages/core`; real fetcher (timeouts,
  UA, byte-sniffing à la the prototype's `sniffImage`) and the recorded-bytes
  stub for tests/preview are separate implementations of the same type.
- Bring the tests along — they are the named regression tests DESIGN.md
  requires, not illustrations.
