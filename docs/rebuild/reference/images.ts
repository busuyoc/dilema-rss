// Reference implementation for DESIGN.md's per-article images and the scoped
// determinism claim: render is pure over (jsonl + fetched bytes). This module
// is the only place the network appears — the renderer never calls fetch, it
// receives resolved bytes. Tests and `bun run preview` inject a stub fetcher
// with recorded bytes and stay byte-stable; the live deploy injects a real one.

export type Block =
  | { kind: 'p' | 'h2' | 'h3' | 'blockquote'; text: string }
  | { kind: 'image'; src: string; alt?: string };

export interface FetchedImage {
  bytes: Uint8Array;
  mime: string; // identified from the bytes by the fetcher (the prototype's
                // sniffImage lesson: dilema.ro serves images with empty
                // Content-Type and serves HTML with 200 for missing weeks)
}

// Resolve null for "not there / not an image". Throwing is also tolerated —
// resolveImages treats a rejection the same as null, so a flaky fetcher can't
// crash a build over one picture.
export type ImageFetcher = (url: string) => Promise<FetchedImage | null>;

export interface ResolvedArticle {
  blocks: Block[];                    // image blocks whose fetch failed are GONE
  images: Map<string, FetchedImage>;  // src → bytes, for the surviving blocks
}

/**
 * Fetch every image an article references and drop the ones that fail.
 *
 * The silent-drop rule is deliberate product behavior (see DESIGN.md and
 * SESSION-2026-08-18-DECISIONS.md #3): a dead image leaves no broken-image
 * glyph and no alt-text placeholder — the text flows as if the block never
 * existed. Every deploy rebuilds every back issue, so sources removing old
 * images is expected background decay, not an error condition.
 *
 * Each distinct URL is fetched once, even when referenced by several blocks.
 */
export async function resolveImages(
  blocks: Block[],
  fetcher: ImageFetcher,
): Promise<ResolvedArticle> {
  const urls = [...new Set(blocks.filter(b => b.kind === 'image').map(b => b.src))];

  const images = new Map<string, FetchedImage>();
  for (const url of urls) {
    const fetched = await fetcher(url).catch(() => null);
    if (fetched) images.set(url, fetched);
  }

  return {
    blocks: blocks.filter(b => b.kind !== 'image' || images.has(b.src)),
    images,
  };
}

// The one style rule per-article images need (DESIGN.md): reflow to the text
// column whatever the native size — no per-source tuning.
export const IMAGE_CSS = 'img { max-width: 100%; height: auto; }';
