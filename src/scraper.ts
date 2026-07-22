import { parse } from 'node-html-parser';
import { zipSync, strToU8 } from 'fflate';

const BASE = 'https://www.dilema.ro';
const USER_AGENT = 'Mozilla/5.0 (compatible; dilema-rss/1.0)';

// Single source of truth for sections. Order here = display order in the
// EPUB cover, TOC and section grouping. Slug = first URL path segment
// (e.g. /tema-saptaminii/...). Articles in slugs not listed here still
// appear in the EPUB but bucketed at the end (sectionOrder fallback = 99).
interface Section { slug: string; label: string; }
const SECTIONS: Section[] = [
  { slug: 'tema-saptaminii',         label: 'Tema săptămânii' },
  { slug: 'editoriale-si-opinii',    label: 'Editoriale și opinii' },
  { slug: 'la-fata-timpului',        label: 'La fața timpului' },
  { slug: 'la-fata-locului',         label: 'La fața locului' },
  { slug: 'pe-ce-lume-traim',        label: 'Pe ce lume trăim' },
  { slug: 'la-singular-si-la-plural', label: 'La singular și la plural' },
  { slug: 'societate',               label: 'Societate' },
  { slug: 'din-polul-plus',          label: 'Din polul plus' },
  { slug: 'caleidoscopie',           label: 'Caleidoscopie' },
  { slug: 'carte',                   label: 'Carte' },
  { slug: 'film',                    label: 'Film' },
  { slug: 'muzica',                  label: 'Muzică' },
  { slug: 'arte-vizuale',            label: 'Arte vizuale' },
  { slug: 'arte-performative',       label: 'Arte performative' },
  { slug: 'la-zi-in-cultura',        label: 'La zi în cultură' },
  { slug: 'tilc-show',               label: 'Tîlc Show' },
];

// Recurring column tags that aren't main sections but whose articles we want
// to discover via /tag/{slug}. These tags are reverse-chronological and
// reliably surface the most recent article for each column.
const EXTRA_TAGS = [
  'bazar', 'contraintuitia', 'cuvinte-nepotrivite',
  'dilematograf', 'la-drept-vorbind', 'la-rascruce-de-ginduri',
  'libertatea-de-impresie', 'nici-asa-nici-altminteri', 'pe-de-alta-carte',
  'portrete-din-mers', 'prezentul-discontinuu', 'prof-viata-mea',
  'regimul-artelor-si-munitiilor', 'vamaiotii', 'viata-de-capital',
  'virsta-medie', 'audio-si-n-am-cuvinte', 'axa-dus-intors',
];

// Derived lookups
const SECTION_LABELS: Record<string, string> = Object.fromEntries(
  SECTIONS.map(s => [s.slug, s.label]),
);
const SECTION_ORDER_INDEX: Record<string, number> = Object.fromEntries(
  SECTIONS.map((s, i) => [s.slug, i]),
);

const MONTHS: Record<string, number> = {
  ianuarie: 0, februarie: 1, martie: 2, aprilie: 3,
  mai: 4, iunie: 5, iulie: 6, august: 7,
  septembrie: 8, octombrie: 9, noiembrie: 10, decembrie: 11,
};

const MONTH_NAMES = [
  'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
  'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie',
];

const FETCH_TIMEOUT_MS = 30_000;

async function fetchHtml(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

function parseRomanianDate(text: string, fallbackYear?: number): Date | null {
  // Full date: "07 Mai 2026"
  const mFull = text.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
  if (mFull) {
    const month = MONTHS[mFull[2].toLowerCase()];
    if (month === undefined) return null;
    return new Date(Number(mFull[3]), month, Number(mFull[1]));
  }
  // Year-less: "07 Mai" — only when caller provides a fallback (tag-page entries).
  if (fallbackYear !== undefined) {
    const mShort = text.match(/(\d{1,2})\s+(\w+)/i);
    if (mShort) {
      const month = MONTHS[mShort[2].toLowerCase()];
      if (month !== undefined) return new Date(fallbackYear, month, Number(mShort[1]));
    }
  }
  return null;
}

function formatRomanianDate(date: Date): string {
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function getISOWeek(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86_400_000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

// Most recent Thursday at 00:00 local — fallback for issue_date when no
// /tema-saptaminii/ articles have tag-page dates yet (e.g. scraping before the
// dossier publishes).
function getMostRecentThursday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  // 0=Sun,1=Mon,...,4=Thu,5=Fri,6=Sat → days since last Thursday
  const daysBack = (d.getDay() + 3) % 7;
  d.setDate(d.getDate() - daysBack);
  return d;
}

function isoDate(d: Date): string {
  // Local-time YYYY-MM-DD. Avoids the toISOString shift (e.g. EEST midnight
  // displays as previous day's 21:00 UTC) which made issue_date logs read
  // a day earlier than reality.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function sectionOrder(section: string): number {
  return SECTION_ORDER_INDEX[section] ?? 99;
}

const ARTICLE_RE = /href="(\/(?!autor\/|tag\/|abonament|formular|situatiunea)[a-z][a-z0-9_-]*\/[a-z0-9_-]{5,})"/g;

// Pair an article URL with its publication date as displayed inline on listing
// pages (homepage, section archives, tag pages). The `<span class="post-date">`
// (without the `.updated` modifier class) carries `post_date` — reliable for
// filtering, unlike the `.updated` post_modified date that's stuck in W18 for
// pre-prepared articles. The HTML format is:
//   `<span class="post-date"><i class="fa fa-clock-o"></i>Joi, 07 Mai</span>`
// The 5000-char cap between href and post-date protects against pairing across
// cards. The 200-char cap between span-open and date text allows the inline
// `<i>` icon while still scoping to the same span.
const TAG_ENTRY_RE = /href="(\/(?!autor\/|tag\/|abonament|formular|situatiunea)[a-z][a-z0-9_-]*\/[a-z0-9_-]{5,})"[\s\S]{0,5000}?<span\s+class="post-date"\s*>[\s\S]{0,200}?(\d{1,2}\s+\w+(?:\s+\d{4})?)/g;

function extractTagEntries(html: string): Map<string, Date> {
  const entries = new Map<string, Date>();
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  for (const m of html.matchAll(TAG_ENTRY_RE)) {
    const path = m[1];
    if (entries.has(path)) continue; // first match per URL wins (top of card)

    const date = parseRomanianDate(m[2], today.getFullYear());
    if (!date) continue;
    // Year correction: tentative date in the future means the article is from last year.
    if (date > today) date.setFullYear(date.getFullYear() - 1);

    entries.set(path, date);
  }

  return entries;
}

interface DiscoveryMeta {
  date: Date | null;
}

async function discoverUrls(): Promise<Map<string, DiscoveryMeta>> {
  const urls = new Map<string, DiscoveryMeta>();

  const addUrl = (path: string, date: Date | null) => {
    const url = BASE + path;
    const existing = urls.get(url);
    if (!existing) {
      urls.set(url, { date });
    } else if (!existing.date && date) {
      existing.date = date; // upgrade null → date when a listing provides it
    }
  };

  // Two-pronged extraction per page:
  //  - ARTICLE_RE catches every article URL (including ones the listing parses
  //    with structures the date-pair regex can't reach)
  //  - extractTagEntries pairs URL with its inline publication date when present
  // Same URL discovered both ways → URL kept once, date populated from the second.
  const addAll = (html: string) => {
    for (const m of html.matchAll(ARTICLE_RE)) addUrl(m[1], null);
    for (const [path, date] of extractTagEntries(html)) addUrl(path, date);
  };

  process.stdout.write('Discovering: homepage');
  addAll(await fetchHtml(BASE));

  // SECTIONS: section archive (alphabetical, has dates) AND tag page (some are
  // empty for section-named tags but harmless — addAll deduplicates).
  for (const s of SECTIONS) {
    process.stdout.write(` ${s.slug}`);
    try {
      addAll(await fetchHtml(`${BASE}/${s.slug}`));
      addAll(await fetchHtml(`${BASE}/tag/${s.slug}`));
    } catch (e) {
      console.warn(`\n  section fetch failed for ${s.slug}: ${e instanceof Error ? e.message : e}`);
    }
    await Bun.sleep(150);
  }

  // EXTRA_TAGS: column tag pages (reverse-chronological, dates inline)
  for (const tag of EXTRA_TAGS) {
    process.stdout.write(` ${tag}`);
    try {
      addAll(await fetchHtml(`${BASE}/tag/${tag}`));
    } catch (e) {
      console.warn(`\n  tag fetch failed for ${tag}: ${e instanceof Error ? e.message : e}`);
    }
    await Bun.sleep(150);
  }

  process.stdout.write('\n');
  return urls;
}

interface Article {
  url: string;
  title: string;
  subtitle: string;
  author: string;
  date: Date;
  section: string;
  imageUrl: string | null;
  xhtml: string; // clean XHTML for EPUB — plain text paragraphs, guaranteed valid
}

type FetchResult =
  | { status: 'ok'; article: Article }
  | { status: 'no-title' | 'no-date' | 'no-content' }; // window filter applied in main()

async function fetchArticle(url: string): Promise<FetchResult> {
  const raw = await fetchHtml(url);
  const root = parse(raw);

  const title = root.querySelector('h1.single_post_title_main')?.text?.trim();
  if (!title) return { status: 'no-title' };

  // span.post-date.updated holds the article's last-modified date with year.
  // Used only when no tag-page publication date is available for this URL.
  const dateText = root.querySelector('span.post-date')?.text?.replace(/[^\w\s,]/g, '').trim() ?? '';
  const date = parseRomanianDate(dateText);
  if (!date) return { status: 'no-date' };

  const subtitle = root.querySelector('p.post_subtitle_text')?.text?.trim() ?? '';

  const authorEl = root.querySelector('.post-author a') ?? root.querySelector('a[href^="/autor/"]');
  const author = authorEl?.text?.trim() ?? 'Dilema Veche';

  const contentDiv = root.querySelector('div.post_content');
  if (!contentDiv) return { status: 'no-content' };

  // Extract featured image (first img with absolute src)
  let imageUrl: string | null = null;
  const firstImg = contentDiv.querySelector('img');
  if (firstImg) {
    const src = firstImg.getAttribute('src') ?? '';
    imageUrl = src.startsWith('/') ? BASE + src : src.startsWith('http') ? src : null;
  }

  // Build clean XHTML: plain text per block, no raw HTML from the site.
  // This avoids HTML entities, unclosed void elements, and other XHTML issues.
  const xhtml = contentDiv.querySelectorAll('p, h2, h3, blockquote')
    .map(el => {
      const text = el.text.trim();
      if (!text) return '';
      const tag = el.tagName.toLowerCase() === 'blockquote' ? 'blockquote' :
                  el.tagName.toLowerCase().startsWith('h') ? el.tagName.toLowerCase() : 'p';
      return `<${tag}>${escapeXml(text)}</${tag}>`;
    })
    .filter(s => s.length > 0)
    .join('\n');

  const section = new URL(url).pathname.split('/')[1] ?? '';
  return { status: 'ok', article: { url, title, subtitle, author, date, section, imageUrl, xhtml } };
}

// ── RSS ──────────────────────────────────────────────────────────────────────

function generateRSS(articles: Article[], buildDate: Date): string {
  const sorted = [...articles].sort((a, b) => {
    const so = sectionOrder(a.section) - sectionOrder(b.section);
    return so !== 0 ? so : a.title.localeCompare(b.title, 'ro');
  });

  const items = sorted.map(a => {
    const label = SECTION_LABELS[a.section] ?? a.section;
    return `
  <item>
    <title>${escapeXml(`${label} · ${a.title}`)}</title>
    <link>${escapeXml(a.url)}</link>
    <guid isPermaLink="true">${escapeXml(a.url)}</guid>
    <pubDate>${a.date.toUTCString()}</pubDate>
    <author>${escapeXml(a.author)}</author>
    <description>${escapeXml(`${a.author} — ${a.subtitle}`)}</description>
  </item>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Dilema Veche</title>
    <link>${escapeXml(BASE)}</link>
    <description>Articolele saptamanii</description>
    <language>ro</language>
    <lastBuildDate>${buildDate.toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;
}

// ── EPUB ─────────────────────────────────────────────────────────────────────

const EPUB_CSS = `
body { font-family: Georgia, serif; line-height: 1.7; margin: 1.5em 1em; text-align: left; }
h1 { font-size: 1.3em; margin-top: 0.5em; margin-bottom: 0.3em; line-height: 1.25; text-align: left; font-weight: bold; }
h2 { font-size: 1.2em; margin-top: 2em; text-align: left; }
h3 { font-size: 1em; margin-top: 1.5em; }
.subtitle { font-style: italic; font-size: 1.05em; margin: 0.3em 0 0.5em; color: #444; }
.meta { font-size: 0.85em; color: #666; margin-bottom: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.8em; }
.section-label { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 0.3em; }
.article-img img, .content img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
blockquote { border-left: 3px solid #ccc; padding-left: 1em; margin-left: 0; font-style: italic; }
.cover { text-align: center; padding: 4em 1em; }
.cover h1 { font-size: 2.2em; }
.cover-date { font-size: 1.3em; margin-top: 0.5em; }
.cover-meta { font-size: 0.9em; color: #666; }
.cover-image { margin: 0; padding: 0; text-align: center; }
.cover-image img { max-width: 100%; max-height: 100vh; height: auto; display: block; margin: 0 auto; }
`.trim();

interface CoverImage {
  data: Uint8Array;
  ext: 'jpg' | 'png' | 'webp';
  mime: string;
}

async function fetchCoverImage(): Promise<CoverImage | null> {
  let html: string;
  try {
    html = await fetchHtml(BASE);
  } catch (e) {
    console.warn(`cover: homepage fetch failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }

  const m = html.match(/(?:src|data-src)="([^"]*\/coperta\/[^"]+\.(?:jpg|jpeg|png|webp))"/i);
  if (!m) {
    console.warn('cover: no /coperta/ image URL on homepage');
    return null;
  }

  let url = m[1];
  if (url.startsWith('/')) url = BASE + url;
  else if (!url.startsWith('http')) url = BASE + '/' + url;

  let r: Response;
  try {
    r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    console.warn(`cover: fetch ${url} failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
  if (!r.ok) {
    console.warn(`cover: ${r.status} for ${url}`);
    return null;
  }

  const data = new Uint8Array(await r.arrayBuffer());
  const rawExt = (url.match(/\.(jpg|jpeg|png|webp)$/i)?.[1] ?? 'jpg').toLowerCase();
  const ext = (rawExt === 'jpeg' ? 'jpg' : rawExt) as 'jpg' | 'png' | 'webp';
  const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp';
  return { data, ext, mime };
}

// Same shape as CoverImage. Barburisme = weekly political caricature gallery; the
// image filename embeds the ISO week, e.g. /images/barburisme/19-2026.webp.
async function fetchBarburismeImage(): Promise<CoverImage | null> {
  let html: string;
  try {
    html = await fetchHtml(BASE);
  } catch (e) {
    console.warn(`barburisme: homepage fetch failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }

  // Homepage uses relative URLs like `images/barburisme/19-2026.webp` (no leading
  // slash). `[^"]*?` is lazy and may be empty to accept that form too.
  const m = html.match(/(?:src|data-src)="([^"]*?images\/barburisme\/[^"]+\.(?:jpg|jpeg|png|webp))"/i);
  if (!m) {
    console.warn('barburisme: no images/barburisme/ image URL on homepage');
    return null;
  }

  let url = m[1];
  if (url.startsWith('/')) url = BASE + url;
  else if (!url.startsWith('http')) url = BASE + '/' + url;

  let r: Response;
  try {
    r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    console.warn(`barburisme: fetch ${url} failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
  if (!r.ok) {
    console.warn(`barburisme: ${r.status} for ${url}`);
    return null;
  }

  const data = new Uint8Array(await r.arrayBuffer());
  const rawExt = (url.match(/\.(jpg|jpeg|png|webp)$/i)?.[1] ?? 'jpg').toLowerCase();
  const ext = (rawExt === 'jpeg' ? 'jpg' : rawExt) as 'jpg' | 'png' | 'webp';
  const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp';
  return { data, ext, mime };
}

function xhtmlPage(title: string, body: string): Uint8Array {
  return strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ro">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>`);
}

function generateEPUB(articles: Article[], buildDate: Date, cover: CoverImage | null, barburisme: CoverImage | null): Uint8Array {
  const week = getISOWeek(buildDate).toString().padStart(2, '0');
  // UID is week-stable so re-runs in the same week update the same book
  // (Calibre / Apple Books dedup by uid). Title carries the full build date
  // so users can still tell two builds apart visually.
  const uid = `dilema-${buildDate.getFullYear()}-W${week}`;
  const dateLabel = formatRomanianDate(buildDate);
  const dcDate = buildDate.toISOString().slice(0, 10);

  // Sort: section order first, then title within section
  const sorted = [...articles].sort((a, b) => {
    const so = sectionOrder(a.section) - sectionOrder(b.section);
    return so !== 0 ? so : a.title.localeCompare(b.title, 'ro');
  });

  // Build section groups preserving sorted order
  const sectionGroups = new Map<string, number[]>(); // section → global indices
  sorted.forEach((a, idx) => {
    if (!sectionGroups.has(a.section)) sectionGroups.set(a.section, []);
    sectionGroups.get(a.section)!.push(idx);
  });

  const files: Record<string, [Uint8Array, { level: number }]> = {};
  const manifest: string[] = [
    '<item id="style" href="style.css" media-type="text/css"/>',
    '<item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="titlepage" href="cover.xhtml" media-type="application/xhtml+xml"/>',
  ];
  const spine: string[] = ['<itemref idref="titlepage"/>', '<itemref idref="nav"/>'];

  // Cover image. PocketBook OS picks up id="cover-image" + properties="cover-image";
  // KOReader/crengine reads <meta name="cover"> (EPUB 2 fallback). Provide both.
  let coverImageRef = '';
  let coverMetaCompat = '';
  if (cover) {
    const coverFile = `cover.${cover.ext}`;
    files[`OEBPS/${coverFile}`] = [cover.data, { level: 0 }]; // already compressed
    manifest.push(`<item id="cover-image" href="${coverFile}" media-type="${cover.mime}" properties="cover-image"/>`);
    coverImageRef = coverFile;
    coverMetaCompat = '<meta name="cover" content="cover-image"/>';
  }

  // cover.xhtml: just the image stretched (or text fallback if image missing)
  const coverBody = coverImageRef
    ? `<div class="cover-image"><img src="${coverImageRef}" alt="Coperta Dilema Veche"/></div>`
    : `<div class="cover">
  <p class="section-label">revistă săptămânală</p>
  <h1>Dilema Veche</h1>
  <p class="cover-date">${escapeXml(dateLabel)}</p>
  <p class="cover-meta">${sorted.length} articole · ${sectionGroups.size} secțiuni</p>
</div>`;
  files['OEBPS/cover.xhtml'] = [xhtmlPage('Dilema Veche', coverBody), { level: 6 }];

  // Barburisme caricature: same image-as-page treatment as cover. Inserted into
  // spine right after the navigation TOC, so it shows up early in the reading order.
  // TOC entry is prepended to the section list below.
  let hasBarburisme = false;
  if (barburisme) {
    const file = `barburisme.${barburisme.ext}`;
    files[`OEBPS/${file}`] = [barburisme.data, { level: 0 }];
    files['OEBPS/barburisme.xhtml'] = [xhtmlPage('Barburisme',
      `<div class="cover-image"><img src="${file}" alt="Barburisme — caricatura săptămânii"/></div>`
    ), { level: 6 }];
    manifest.push(`<item id="barburisme-img" href="${file}" media-type="${barburisme.mime}"/>`);
    manifest.push('<item id="barburisme" href="barburisme.xhtml" media-type="application/xhtml+xml"/>');
    spine.push('<itemref idref="barburisme"/>');
    hasBarburisme = true;
  }

  // One XHTML per article
  sorted.forEach((a, idx) => {
    const id = `a${idx}`;
    const label = SECTION_LABELS[a.section] ?? a.section;
    const imgHtml = a.imageUrl
      ? `<p class="article-img"><img src="${escapeXml(a.imageUrl)}" alt=""/></p>`
      : '';
    const subtitleHtml = a.subtitle
      ? `<p class="subtitle">${escapeXml(a.subtitle)}</p>`
      : '';
    const body = `<div class="article">
  <p class="section-label">${escapeXml(label)}</p>
  <h1>${escapeXml(a.title)}</h1>
  ${subtitleHtml}
  <p class="meta">${escapeXml(a.author)} — ${escapeXml(formatRomanianDate(a.date))}</p>
  ${imgHtml}
  <div class="content">
${a.xhtml}
  </div>
</div>`;
    files[`OEBPS/${id}.xhtml`] = [xhtmlPage(a.title, body), { level: 6 }];
    manifest.push(`<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
  });

  // Nested TOC: sections → articles. If Barburisme is present, prepend it as a
  // top-level leaf entry so it gets its own line in the reader's TOC view.
  const sectionNavItems = Array.from(sectionGroups.entries()).map(([section, indices]) => {
    const label = SECTION_LABELS[section] ?? section;
    const subItems = indices.map(idx =>
      `        <li><a href="a${idx}.xhtml">${escapeXml(sorted[idx].title)}</a></li>`
    ).join('\n');
    return `    <li>\n      <span>${escapeXml(label)}</span>\n      <ol>\n${subItems}\n      </ol>\n    </li>`;
  });
  if (hasBarburisme) {
    sectionNavItems.unshift('    <li><a href="barburisme.xhtml">Barburisme</a></li>');
  }
  const navItems = sectionNavItems.join('\n');

  files['OEBPS/toc.xhtml'] = [xhtmlPage('Cuprins', `
<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc">
  <h1>Cuprins</h1>
  <ol>
${navItems}
  </ol>
</nav>`), { level: 6 }];

  // CSS
  files['OEBPS/style.css'] = [strToU8(EPUB_CSS), { level: 6 }];

  // content.opf
  files['OEBPS/content.opf'] = [strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${uid}</dc:identifier>
    <dc:title>Dilema Veche – ${escapeXml(dateLabel)}</dc:title>
    <dc:language>ro</dc:language>
    <dc:date>${dcDate}</dc:date>
    <dc:creator>dilema.ro</dc:creator>
    <meta property="dcterms:modified">${buildDate.toISOString().replace(/\.\d+Z$/, 'Z')}</meta>${coverMetaCompat ? '\n    ' + coverMetaCompat : ''}
  </metadata>
  <manifest>
    ${manifest.join('\n    ')}
  </manifest>
  <spine>
    ${spine.join('\n    ')}
  </spine>
</package>`), { level: 6 }];

  // META-INF
  files['META-INF/container.xml'] = [strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`), { level: 6 }];

  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    ...files,
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const urls = await discoverUrls();
  console.log(`Discovered ${urls.size} candidate URLs`);

  // Compute issue_date: max publication date among /tema-saptaminii/* URLs that have
  // tag-page-derived dates. This anchors "this issue" to the dossier's release date.
  // Fallback to most-recent-Thursday if no dossier dates yet (e.g. scraping before the
  // Thursday morning publication).
  const dossierDates = [...urls.entries()]
    .filter(([u, m]) => u.includes('/tema-saptaminii/') && m.date)
    .map(([_, m]) => m.date!);
  const issueDate = dossierDates.length
    ? new Date(Math.max(...dossierDates.map(d => d.getTime())))
    : getMostRecentThursday();
  const windowStart = new Date(issueDate); windowStart.setDate(windowStart.getDate() - 6);
  const windowEnd   = new Date(issueDate); windowEnd.setDate(windowEnd.getDate() + 1);
  console.log(`Issue date: ${isoDate(issueDate)}, window ${isoDate(windowStart)} → ${isoDate(windowEnd)}`);

  const inWindow = (d: Date) => d >= windowStart && d <= windowEnd;

  // Phase A: cheap pre-filter on tag-page dates. URLs whose tag-page date is outside
  // the window are dropped without fetching the article body. Saves ~1000 fetches.
  const toFetch: string[] = [];
  let preFiltered = 0;
  for (const [url, meta] of urls) {
    if (meta.date && !inWindow(meta.date)) {
      preFiltered++;
      continue;
    }
    toFetch.push(url);
  }

  // Phase B: fetch surviving URLs, parse article date, apply window filter.
  const articles: Article[] = [];
  let oldCount = 0;
  const unexpected: { url: string; reason: string }[] = [];
  let i = 0;
  for (const url of toFetch) {
    process.stdout.write(`\r[${++i}/${toFetch.length}] ${url.slice(BASE.length)}${' '.repeat(40)}`);
    try {
      const r = await fetchArticle(url);
      if (r.status === 'ok') {
        if (inWindow(r.article.date)) articles.push(r.article);
        else oldCount++;
      } else {
        unexpected.push({ url, reason: r.status });
      }
    } catch (e) {
      unexpected.push({ url, reason: e instanceof Error ? e.message : String(e) });
    }
    await Bun.sleep(150);
  }
  process.stdout.write('\n');

  console.log(`Filtered: ${articles.length} in window, ${preFiltered + oldCount} outside (${preFiltered} via tag-page date, ${oldCount} via article body)`);
  if (unexpected.length > 0) {
    console.warn(`Unexpected skips (${unexpected.length}):`);
    unexpected.forEach(s => console.warn(`  ${s.url.slice(BASE.length)} — ${s.reason}`));
  }

  console.log(`This week: ${articles.length} articles`);
  articles
    .sort((a, b) => sectionOrder(a.section) - sectionOrder(b.section))
    .forEach(a => console.log(`  [${a.section}] ${a.title} — ${a.author}`));

  const now = new Date();
  const week = getISOWeek(now).toString().padStart(2, '0');
  const epubName = `dilema-${now.getFullYear()}-W${week}.epub`;

  await Bun.write('feed.xml', generateRSS(articles, now));
  console.log('Written feed.xml');

  process.stdout.write('Fetching magazine cover... ');
  const cover = await fetchCoverImage();
  console.log(cover ? `${cover.ext} ${(cover.data.length / 1024).toFixed(0)} KB` : 'not available (using text fallback)');

  process.stdout.write('Fetching Barburisme caricature... ');
  const barburisme = await fetchBarburismeImage();
  console.log(barburisme ? `${barburisme.ext} ${(barburisme.data.length / 1024).toFixed(0)} KB` : 'not available');

  const epub = generateEPUB(articles, now, cover, barburisme);
  await Bun.write(epubName, epub);
  await Bun.write('dilema-latest.epub', epub);
  console.log(`Written ${epubName} + dilema-latest.epub (${(epub.length / 1024).toFixed(0)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
