import { parse } from 'node-html-parser';
import { zipSync, strToU8 } from 'fflate';

const BASE = 'https://www.dilema.ro';

const TAGS = [
  'la-fata-timpului', 'la-fata-locului', 'la-singular-si-la-plural',
  'din-polul-plus', 'bazar', 'contraintuitia', 'cuvinte-nepotrivite',
  'dilematograf', 'la-rascruce-de-ginduri', 'libertatea-de-impresie',
  'nici-asa-nici-altminteri', 'pe-de-alta-carte', 'portrete-din-mers',
  'prezentul-discontinuu', 'prof-viata-mea', 'regimul-artelor-si-munitiilor',
  'vamaiotii', 'viata-de-capital', 'virsta-medie', 'audio-si-n-am-cuvinte',
  'axa-dus-intors',
];

const MONTHS: Record<string, number> = {
  ianuarie: 0, februarie: 1, martie: 2, aprilie: 3,
  mai: 4, iunie: 5, iulie: 6, august: 7,
  septembrie: 8, octombrie: 9, noiembrie: 10, decembrie: 11,
};

const MONTH_NAMES = [
  'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
  'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie',
];

const SECTION_LABELS: Record<string, string> = {
  'tema-saptaminii': 'Tema săptămânii',
  'editoriale-si-opinii': 'Editoriale și opinii',
  'la-fata-timpului': 'La față timpului',
  'la-fata-locului': 'La fața locului',
  'pe-ce-lume-traim': 'Pe ce lume trăim',
  'la-singular-si-la-plural': 'La singular și la plural',
  'societate': 'Societate',
  'din-polul-plus': 'Din polul plus',
  'caleidoscopie': 'Caleidoscopie',
  'carte': 'Carte',
  'film': 'Film',
  'muzica': 'Muzică',
  'arte-vizuale': 'Arte vizuale',
  'arte-performative': 'Arte performative',
};

const SECTION_ORDER = Object.keys(SECTION_LABELS);

async function fetchHtml(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; dilema-rss/1.0)' },
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

function parseRomanianDate(text: string): Date | null {
  const m = text.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) return null;
  return new Date(Number(m[3]), month, Number(m[1]));
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

function isRecent(date: Date, days = 8): boolean {
  return date >= new Date(Date.now() - days * 86_400_000);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function sectionOrder(section: string): number {
  const i = SECTION_ORDER.indexOf(section);
  return i === -1 ? 99 : i;
}

// Make void elements self-closing for XHTML
function toXhtml(html: string): string {
  return html
    .replace(/<(br|hr)(\s[^>]*)?>/gi, '<$1$2/>')
    .replace(/<img([^>]*)(?<!\/)>/gi, '<img$1/>');
}

const ARTICLE_RE = /href="(\/(?!autor\/|tag\/|abonament|formular|tilc-show|situatiunea)[a-z][a-z0-9-]*\/[a-z0-9-]{5,})"/g;

async function discoverUrls(): Promise<Set<string>> {
  const urls = new Set<string>();
  const addFromHtml = (html: string) => {
    for (const m of html.matchAll(ARTICLE_RE)) urls.add(BASE + m[1]);
  };

  process.stdout.write('Discovering: homepage');
  addFromHtml(await fetchHtml(BASE));

  for (const tag of TAGS) {
    process.stdout.write(` ${tag}`);
    addFromHtml(await fetchHtml(`${BASE}/tag/${tag}`));
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
  html: string;
}

async function fetchArticle(url: string): Promise<Article | null> {
  const raw = await fetchHtml(url);
  const root = parse(raw);

  const title = root.querySelector('h1.single_post_title_main')?.text?.trim();
  if (!title) return null;

  const dateText = root.querySelector('span.post-date')?.text?.replace(/[^\w\s,]/g, '').trim() ?? '';
  const date = parseRomanianDate(dateText);
  if (!date || !isRecent(date)) return null;

  const subtitle = root.querySelector('p.post_subtitle_text')?.text?.trim() ?? '';

  const authorEl = root.querySelector('.post-author a') ?? root.querySelector('a[href^="/autor/"]');
  const author = authorEl?.text?.trim() ?? 'Dilema Veche';

  const contentDiv = root.querySelector('div.post_content');
  if (!contentDiv) return null;

  // Make image src absolute (keep images)
  contentDiv.querySelectorAll('img').forEach(el => {
    const src = el.getAttribute('src') ?? '';
    if (src.startsWith('/')) el.setAttribute('src', BASE + src);
    else if (!src.startsWith('http')) el.remove();
  });

  const html = contentDiv.querySelectorAll('p, h2, h3, blockquote')
    .map(el => el.outerHTML)
    .join('\n');

  const section = new URL(url).pathname.split('/')[1] ?? '';
  return { url, title, subtitle, author, date, section, html };
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
    <title><![CDATA[${label} · ${a.title}]]></title>
    <link>${a.url}</link>
    <guid isPermaLink="true">${a.url}</guid>
    <pubDate>${a.date.toUTCString()}</pubDate>
    <author>${escapeXml(a.author)}</author>
    <description><![CDATA[${a.author} — ${a.subtitle}]]></description>
  </item>`;
  }).join('');

  const feedUrl = process.env.FEED_URL ?? '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Dilema Veche – numărul curent</title>
    <link>${BASE}</link>
    <description>Articolele săptămânii, pentru citit pe e-reader</description>
    <language>ro</language>
    <lastBuildDate>${buildDate.toUTCString()}</lastBuildDate>
    ${feedUrl ? `<atom:link href="${feedUrl}" rel="self" type="application/rss+xml"/>` : ''}
${items}
  </channel>
</rss>`;
}

// ── EPUB ─────────────────────────────────────────────────────────────────────

const EPUB_CSS = `
body { font-family: Georgia, serif; line-height: 1.7; margin: 1.5em 1em; }
h1 { font-size: 1.5em; border-bottom: 1px solid #ccc; padding-bottom: 0.3em; }
h2 { font-size: 1.2em; margin-top: 2.5em; margin-bottom: 0.2em; }
h3 { font-size: 1em; margin-top: 1.5em; }
.subtitle { font-style: italic; font-size: 1.05em; margin: 0.3em 0 0.5em; }
.meta { font-size: 0.85em; color: #666; margin-bottom: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.8em; }
.section-label { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.05em; color: #888; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
blockquote { border-left: 3px solid #ccc; padding-left: 1em; margin-left: 0; font-style: italic; }
hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
.cover { text-align: center; padding: 3em 1em; }
.cover h1 { border: none; font-size: 2em; }
`.trim();

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

function generateEPUB(articles: Article[], buildDate: Date): Uint8Array {
  const week = getISOWeek(buildDate).toString().padStart(2, '0');
  const uid = `dilema-${buildDate.getFullYear()}-W${week}`;
  const dateLabel = formatRomanianDate(buildDate);
  const isoDate = buildDate.toISOString().slice(0, 10);

  // Group by section, preserving SECTION_ORDER
  const grouped = new Map<string, Article[]>();
  const orderedSections: string[] = [];
  for (const a of [...articles].sort((a, b) => sectionOrder(a.section) - sectionOrder(b.section))) {
    if (!grouped.has(a.section)) {
      grouped.set(a.section, []);
      orderedSections.push(a.section);
    }
    grouped.get(a.section)!.push(a);
  }

  const files: Record<string, [Uint8Array, { level: number }]> = {};
  const manifest: string[] = [
    '<item id="style" href="style.css" media-type="text/css"/>',
    '<item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>',
  ];
  const spine: string[] = ['<itemref idref="cover"/>', '<itemref idref="nav"/>'];

  // Cover
  files['OEBPS/cover.xhtml'] = [xhtmlPage('Dilema Veche', `
<div class="cover">
  <p class="section-label">revistă săptămânală</p>
  <h1>Dilema Veche</h1>
  <p style="font-size:1.3em">${escapeXml(dateLabel)}</p>
  <p style="font-size:0.9em; color:#666">${articles.length} articole · ${orderedSections.length} secțiuni</p>
</div>`), { level: 6 }];

  // Section pages
  orderedSections.forEach((section, i) => {
    const sectionArticles = grouped.get(section)!;
    const label = SECTION_LABELS[section] ?? section;
    const id = `s${i}`;

    const body = sectionArticles.map(a => `
<h2>${escapeXml(a.title)}</h2>
<p class="subtitle">${escapeXml(a.subtitle)}</p>
<p class="meta">${escapeXml(a.author)}</p>
${toXhtml(a.html)}
<hr/>`).join('\n');

    files[`OEBPS/${id}.xhtml`] = [xhtmlPage(label, `<h1>${escapeXml(label)}</h1>\n${body}`), { level: 6 }];
    manifest.push(`<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
  });

  // Nav / ToC
  const navItems = orderedSections.map((section, i) => {
    const label = SECTION_LABELS[section] ?? section;
    const arts = grouped.get(section)!;
    return `<li><a href="s${i}.xhtml">${escapeXml(label)}</a> <span style="font-size:0.85em;color:#888">(${arts.length})</span></li>`;
  }).join('\n      ');

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
    <dc:date>${isoDate}</dc:date>
    <dc:creator>dilema.ro</dc:creator>
    <meta property="dcterms:modified">${buildDate.toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
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
    // mimetype must be first and uncompressed
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    ...files,
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const urls = await discoverUrls();
  console.log(`Discovered ${urls.size} candidate URLs`);

  const articles: Article[] = [];
  let i = 0;
  for (const url of urls) {
    process.stdout.write(`\r[${++i}/${urls.size}] ${url.slice(BASE.length)}${' '.repeat(20)}`);
    try {
      const article = await fetchArticle(url);
      if (article) articles.push(article);
    } catch { /* skip */ }
    await Bun.sleep(150);
  }
  process.stdout.write('\n');

  console.log(`This week: ${articles.length} articles`);
  articles
    .sort((a, b) => sectionOrder(a.section) - sectionOrder(b.section))
    .forEach(a => console.log(`  [${a.section}] ${a.title} — ${a.author}`));

  const now = new Date();
  const week = getISOWeek(now).toString().padStart(2, '0');
  const epubName = `dilema-${now.getFullYear()}-W${week}.epub`;

  await Bun.write('feed.xml', generateRSS(articles, now));
  console.log('Written feed.xml');

  const epub = generateEPUB(articles, now);
  await Bun.write(epubName, epub);
  await Bun.write('dilema-latest.epub', epub);
  console.log(`Written ${epubName} + dilema-latest.epub (${(epub.length / 1024).toFixed(0)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
