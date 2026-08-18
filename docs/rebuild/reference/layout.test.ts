import { describe, expect, test } from 'bun:test';
import { resolveLayout, type ArticleRef, type LayoutSlot, type SectionSpec } from './layout';

const SECTIONS: SectionSpec[] = [
  { id: 'tema-saptaminii', label: 'Tema săptămânii' },
  { id: 'carte', label: 'Carte' },
];

const DILEMA_LAYOUT: LayoutSlot[] = [
  { kind: 'cover' },
  { kind: 'toc' },
  { kind: 'art', ref: 'barburisme' },
  { kind: 'section', id: 'tema-saptaminii' },
  { kind: 'section', id: 'carte' },
];

const art = (...refs: string[]) => new Set(refs);

function sectionIds(items: ReturnType<typeof resolveLayout>): string[] {
  return items.filter(i => i.kind === 'section').map(i => (i as { id: string }).id);
}

describe('nothing vanishes', () => {
  // The named regression the design requires: a new column on the site
  // (a slug the adapter never declared) must still appear in the book.
  test('article in an undeclared section is present, bucketed at the end', () => {
    const articles: ArticleRef[] = [
      { section: 'tema-saptaminii', title: 'A' },
      { section: 'noua-rubrica', title: 'B' },
    ];
    const items = resolveLayout(DILEMA_LAYOUT, SECTIONS, articles, art('barburisme'));
    expect(sectionIds(items)).toEqual(['tema-saptaminii', 'noua-rubrica']);
    const rest = items.at(-1)!;
    expect(rest).toMatchObject({ kind: 'section', id: 'noua-rubrica', label: 'noua-rubrica' });
  });

  test('declared section left out of the layout also lands in rest', () => {
    const layoutWithoutCarte = DILEMA_LAYOUT.filter(
      s => !(s.kind === 'section' && s.id === 'carte'),
    );
    const articles: ArticleRef[] = [{ section: 'carte', title: 'C' }];
    const items = resolveLayout(layoutWithoutCarte, SECTIONS, articles, art());
    // Bucketed, but with its declared label — the adapter still knows this section.
    expect(items.at(-1)).toMatchObject({ kind: 'section', id: 'carte', label: 'Carte' });
  });

  test('an explicit rest slot controls where the bucket goes', () => {
    const layout: LayoutSlot[] = [
      { kind: 'toc' },
      { kind: 'rest' },
      { kind: 'section', id: 'carte' },
    ];
    const articles: ArticleRef[] = [
      { section: 'carte', title: 'C' },
      { section: 'necunoscut', title: 'N' },
    ];
    expect(sectionIds(resolveLayout(layout, SECTIONS, articles, art())))
      .toEqual(['necunoscut', 'carte']);
  });
});

describe('slots that have nothing to show are dropped', () => {
  test('declared section with no articles this week is omitted', () => {
    const articles: ArticleRef[] = [{ section: 'carte', title: 'C' }];
    expect(sectionIds(resolveLayout(DILEMA_LAYOUT, SECTIONS, articles, art())))
      .toEqual(['carte']);
  });

  test('art slot is omitted when the art was not fetched', () => {
    const items = resolveLayout(DILEMA_LAYOUT, SECTIONS, [], art());
    expect(items.some(i => i.kind === 'art')).toBe(false);
  });
});

describe('determinism', () => {
  test('same input resolves to deep-equal output, rest sorted by slug, titles by ro collation', () => {
    const articles: ArticleRef[] = [
      { section: 'zebra', title: 'șarpe' },
      { section: 'alfa', title: 'x' },
      { section: 'zebra', title: 'salam' },
    ];
    const run = () => resolveLayout([{ kind: 'toc' }], SECTIONS, articles, art());
    expect(run()).toEqual(run());
    expect(sectionIds(run())).toEqual(['alfa', 'zebra']);
    const zebra = run().at(-1) as { articles: ArticleRef[] };
    expect(zebra.articles.map(a => a.title)).toEqual(['salam', 'șarpe']);
  });
});

describe('invalid layouts fail loudly', () => {
  test('slot referencing an undeclared section throws', () => {
    expect(() => resolveLayout([{ kind: 'section', id: 'typo' }], SECTIONS, [], art()))
      .toThrow('undeclared section');
  });

  test('duplicate section slot throws', () => {
    const layout: LayoutSlot[] = [
      { kind: 'section', id: 'carte' },
      { kind: 'section', id: 'carte' },
    ];
    expect(() => resolveLayout(layout, SECTIONS, [], art())).toThrow('twice');
  });

  test('two rest slots throw', () => {
    expect(() => resolveLayout([{ kind: 'rest' }, { kind: 'rest' }], SECTIONS, [], art()))
      .toThrow('more than one rest');
  });
});
