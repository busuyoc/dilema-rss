import { describe, expect, test } from 'bun:test';
import { resolveImages, type Block, type FetchedImage, type ImageFetcher } from './images';

const png: FetchedImage = { bytes: new Uint8Array([0x89, 0x50]), mime: 'image/png' };

const ARTICLE: Block[] = [
  { kind: 'p', text: 'before' },
  { kind: 'image', src: 'https://example.ro/a.png', alt: 'o poză' },
  { kind: 'p', text: 'after' },
];

describe('silent drop on failed fetch', () => {
  // The named regression the design requires: dead image URL → clean render,
  // no artifact of the failure — no glyph, no alt text standing in.
  test('a dead URL removes the block entirely', async () => {
    const { blocks, images } = await resolveImages(ARTICLE, async () => null);
    expect(blocks).toEqual([
      { kind: 'p', text: 'before' },
      { kind: 'p', text: 'after' },
    ]);
    expect(images.size).toBe(0);
    // Nothing anywhere in the output carries a trace of the missing image.
    expect(JSON.stringify(blocks)).not.toContain('a.png');
    expect(JSON.stringify(blocks)).not.toContain('o poză');
  });

  test('a throwing fetcher is treated the same as null, not a crashed build', async () => {
    const { blocks } = await resolveImages(ARTICLE, async () => {
      throw new Error('ECONNRESET');
    });
    expect(blocks.every(b => b.kind !== 'image')).toBe(true);
  });

  test('failures are per-image: one dead URL does not drop the others', async () => {
    const twoImages: Block[] = [
      { kind: 'image', src: 'https://example.ro/dead.png' },
      { kind: 'image', src: 'https://example.ro/alive.png' },
    ];
    const fetcher: ImageFetcher = async url => (url.includes('alive') ? png : null);
    const { blocks, images } = await resolveImages(twoImages, fetcher);
    expect(blocks).toEqual([{ kind: 'image', src: 'https://example.ro/alive.png' }]);
    expect([...images.keys()]).toEqual(['https://example.ro/alive.png']);
  });
});

describe('successful fetches', () => {
  test('surviving blocks keep their place and bytes land in the map', async () => {
    const { blocks, images } = await resolveImages(ARTICLE, async () => png);
    expect(blocks).toEqual(ARTICLE);
    expect(images.get('https://example.ro/a.png')).toEqual(png);
  });

  test('a URL referenced by several blocks is fetched once', async () => {
    let calls = 0;
    const repeated: Block[] = [
      { kind: 'image', src: 'https://example.ro/a.png' },
      { kind: 'p', text: 'între' },
      { kind: 'image', src: 'https://example.ro/a.png' },
    ];
    await resolveImages(repeated, async () => (calls++, png));
    expect(calls).toBe(1);
  });
});

describe('purity over (blocks + fetched bytes)', () => {
  test('a stubbed fetcher makes resolution reproducible', async () => {
    const stub: ImageFetcher = async () => png;
    const a = await resolveImages(ARTICLE, stub);
    const b = await resolveImages(ARTICLE, stub);
    expect(a.blocks).toEqual(b.blocks);
    expect([...a.images.entries()]).toEqual([...b.images.entries()]);
  });
});
