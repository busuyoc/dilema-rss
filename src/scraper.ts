import { parse } from 'node-html-parser';
import { zipSync, strToU8 } from 'fflate';

const BASE = 'https://www.dilema.ro';

const TAGS = [
  'tema-saptaminii', 'editoriale-si-opinii',
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
  imageUrl: string | null;
  xhtml: string; // clean XHTML for EPUB — plain text paragraphs, guaranteed valid
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
  return { url, title, subtitle, author, date, section, imageUrl, xhtml };
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
    <link>${a.url}</link>
    <guid isPermaLink="true">${a.url}</guid>
    <pubDate>${a.date.toUTCString()}</pubDate>
    <author>${escapeXml(a.author)}</author>
    <description>${escapeXml(`${a.author} — ${a.subtitle}`)}</description>
  </item>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Dilema Veche</title>
    <link>${BASE}</link>
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
  try {
    const html = await fetchHtml(BASE);
    const m = html.match(/(?:src|data-src)="([^"]*\/coperta\/[^"]+\.(?:jpg|jpeg|png|webp))"/i);
    if (!m) return null;

    let url = m[1];
    if (url.startsWith('/')) url = BASE + url;
    else if (!url.startsWith('http')) url = BASE + '/' + url;

    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; dilema-rss/1.0)' },
    });
    if (!r.ok) return null;

    const data = new Uint8Array(await r.arrayBuffer());
    const rawExt = (url.match(/\.(jpg|jpeg|png|webp)$/i)?.[1] ?? 'jpg').toLowerCase();
    const ext = (rawExt === 'jpeg' ? 'jpg' : rawExt) as 'jpg' | 'png' | 'webp';
    const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp';
    return { data, ext, mime };
  } catch {
    return null;
  }
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

function generateEPUB(articles: Article[], buildDate: Date, cover: CoverImage | null): Uint8Array {
  const week = getISOWeek(buildDate).toString().padStart(2, '0');
  const uid = `dilema-${buildDate.getFullYear()}-W${week}`;
  const dateLabel = formatRomanianDate(buildDate);
  const isoDate = buildDate.toISOString().slice(0, 10);

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
    '<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>',
  ];
  const spine: string[] = ['<itemref idref="cover-page"/>', '<itemref idref="nav"/>'];

  // Cover image. Use id="cover" (canonical EPUB 2 convention) AND properties="cover-image"
  // (EPUB 3) so every reader, including KOReader/crengine, picks it up.
  let coverImageRef = '';
  let coverMetaCompat = '';
  if (cover) {
    const coverFile = `cover.${cover.ext}`;
    files[`OEBPS/${coverFile}`] = [cover.data, { level: 0 }]; // already compressed
    manifest.push(`<item id="cover" href="${coverFile}" media-type="${cover.mime}" properties="cover-image"/>`);
    coverImageRef = coverFile;
    coverMetaCompat = '<meta name="cover" content="cover"/>';
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

  // Nested TOC: sections → articles
  const navItems = Array.from(sectionGroups.entries()).map(([section, indices]) => {
    const label = SECTION_LABELS[section] ?? section;
    const subItems = indices.map(idx =>
      `        <li><a href="a${idx}.xhtml">${escapeXml(sorted[idx].title)}</a></li>`
    ).join('\n');
    return `    <li>\n      <span>${escapeXml(label)}</span>\n      <ol>\n${subItems}\n      </ol>\n    </li>`;
  }).join('\n');

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
    ${coverMetaCompat}
  </metadata>
  <manifest>
    ${manifest.join('\n    ')}
  </manifest>
  <spine>
    ${spine.join('\n    ')}
  </spine>
  <guide>
    <reference type="cover" title="Coperta" href="cover.xhtml"/>
  </guide>
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

  process.stdout.write('Fetching magazine cover... ');
  const cover = await fetchCoverImage();
  console.log(cover ? `${cover.ext} ${(cover.data.length / 1024).toFixed(0)} KB` : 'not available (using text fallback)');

  const epub = generateEPUB(articles, now, cover);
  await Bun.write(epubName, epub);
  await Bun.write('dilema-latest.epub', epub);
  console.log(`Written ${epubName} + dilema-latest.epub (${(epub.length / 1024).toFixed(0)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
