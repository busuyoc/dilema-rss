// Reference implementation for DESIGN.md's layout contract: the adapter
// declares the book's ordered structure as LayoutSlot[]; the engine resolves
// that declaration against the articles actually scraped this week.
//
// The rule this file exists to pin: NOTHING VANISHES. An article whose section
// is not declared (a new column on the site) or declared but left out of the
// layout still renders, bucketed into a "rest" group. The prototype enforced
// this with a sectionOrder fallback of 99; here it's structural.

export interface SectionSpec {
  id: string;    // URL slug, e.g. "tema-saptaminii"
  label: string; // display label, e.g. "Tema săptămânii"
}

export type LayoutSlot =
  | { kind: 'cover' }
  | { kind: 'toc' }
  | { kind: 'art'; ref: string }       // keyed by issueArt() id, e.g. "barburisme"
  | { kind: 'section'; id: string }    // references SectionSpec.id
  | { kind: 'rest' };                  // where undeclared/unslotted sections land

export interface ArticleRef {
  section: string; // slug as extracted; may be one the adapter never declared
  title: string;
}

export type BookItem =
  | { kind: 'cover' }
  | { kind: 'toc' }
  | { kind: 'art'; ref: string }
  | { kind: 'section'; id: string; label: string; articles: ArticleRef[] };

const collator = new Intl.Collator('ro');

/**
 * Resolve an adapter's declared layout into the concrete book structure.
 *
 * - A `section` slot emits only when it has articles this week.
 * - An `art` slot emits only when that art was actually fetched (`availableArt`);
 *   a missing caricature is a normal week, not an error.
 * - Articles not claimed by any emitted `section` slot are grouped by slug and
 *   placed at the `rest` slot — or appended at the end when the layout declares
 *   no `rest` slot. Omitting `rest` can move the bucket, never remove it.
 * - Output is deterministic: rest sections sort by slug, articles by title (ro).
 */
export function resolveLayout(
  layout: LayoutSlot[],
  sections: SectionSpec[],
  articles: ArticleRef[],
  availableArt: ReadonlySet<string>,
): BookItem[] {
  const declared = new Map(sections.map(s => [s.id, s.label]));

  const restSlots = layout.filter(s => s.kind === 'rest').length;
  if (restSlots > 1) throw new Error('layout declares more than one rest slot');
  const seenSectionIds = new Set<string>();
  for (const slot of layout) {
    if (slot.kind !== 'section') continue;
    if (!declared.has(slot.id)) throw new Error(`layout references undeclared section "${slot.id}"`);
    if (seenSectionIds.has(slot.id)) throw new Error(`layout references section "${slot.id}" twice`);
    seenSectionIds.add(slot.id);
  }

  const bySection = new Map<string, ArticleRef[]>();
  for (const a of articles) {
    let group = bySection.get(a.section);
    if (!group) bySection.set(a.section, group = []);
    group.push(a);
  }
  for (const group of bySection.values()) {
    group.sort((a, b) => collator.compare(a.title, b.title));
  }

  const restSections = (): BookItem[] =>
    [...bySection.keys()]
      .filter(slug => !seenSectionIds.has(slug))
      .sort(collator.compare)
      .map(slug => ({
        kind: 'section' as const,
        id: slug,
        label: declared.get(slug) ?? slug, // undeclared slug: the slug is the label
        articles: bySection.get(slug)!,
      }));

  const items: BookItem[] = [];
  let restPlaced = false;
  for (const slot of layout) {
    switch (slot.kind) {
      case 'cover':
      case 'toc':
        items.push(slot);
        break;
      case 'art':
        if (availableArt.has(slot.ref)) items.push(slot);
        break;
      case 'section': {
        const group = bySection.get(slot.id);
        if (group) items.push({ kind: 'section', id: slot.id, label: declared.get(slot.id)!, articles: group });
        break;
      }
      case 'rest':
        items.push(...restSections());
        restPlaced = true;
        break;
    }
  }
  if (!restPlaced) items.push(...restSections());
  return items;
}
