import { parse } from 'node-html-parser';

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

function isRecent(date: Date, days = 8): boolean {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  return date >= cutoff;
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

  // Remove images, keep formatted text
  contentDiv.querySelectorAll('img').forEach(el => el.remove());
  const paras = contentDiv.querySelectorAll('p, h2, h3, blockquote')
    .map(el => el.outerHTML)
    .join('\n');

  const section = new URL(url).pathname.split('/')[1] ?? '';

  return { url, title, subtitle, author, date, section, html: paras };
}

const SECTION_LABELS: Record<string, string> = {
  'la-fata-timpului': 'La față timpului',
  'la-fata-locului': 'La fața locului',
  'la-singular-si-la-plural': 'La singular și la plural',
  'din-polul-plus': 'Din polul plus',
  'pe-ce-lume-traim': 'Pe ce lume trăim',
  'editoriale-si-opinii': 'Editoriale și opinii',
  'tema-saptaminii': 'Tema săptămânii',
  'carte': 'Carte',
  'film': 'Film',
  'muzica': 'Muzică',
  'arte-vizuale': 'Arte vizuale',
  'arte-performative': 'Arte performative',
  'caleidoscopie': 'Caleidoscopie',
  'societate': 'Societate',
};

const SECTION_ORDER = [
  'tema-saptaminii', 'editoriale-si-opinii', 'la-fata-timpului',
  'la-fata-locului', 'pe-ce-lume-traim', 'la-singular-si-la-plural',
  'societate', 'din-polul-plus', 'caleidoscopie',
  'carte', 'film', 'muzica', 'arte-vizuale', 'arte-performative',
];

function sectionOrder(section: string): number {
  const i = SECTION_ORDER.indexOf(section);
  return i === -1 ? 99 : i;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function generateRSS(articles: Article[], buildDate: Date): string {
  const sorted = [...articles].sort((a, b) => {
    const so = sectionOrder(a.section) - sectionOrder(b.section);
    return so !== 0 ? so : a.title.localeCompare(b.title, 'ro');
  });

  const items = sorted.map(a => {
    const sectionLabel = SECTION_LABELS[a.section] ?? a.section;
    return `
  <item>
    <title><![CDATA[${a.title}]]></title>
    <link>${a.url}</link>
    <guid isPermaLink="true">${a.url}</guid>
    <pubDate>${a.date.toUTCString()}</pubDate>
    <author>${escapeXml(a.author)}</author>
    <category>${escapeXml(sectionLabel)}</category>
    <description><![CDATA[${a.subtitle}]]></description>
    <content:encoded><![CDATA[<p><strong>${escapeXml(sectionLabel)}</strong> · <em>${escapeXml(a.author)}</em></p>
<p><em>${a.subtitle}</em></p>
${a.html}]]></content:encoded>
  </item>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Dilema Veche – numărul curent</title>
    <link>${BASE}</link>
    <description>Articolele săptămânii, pentru citit pe e-reader</description>
    <language>ro</language>
    <lastBuildDate>${buildDate.toUTCString()}</lastBuildDate>
    ${process.env.FEED_URL ? `<atom:link href="${process.env.FEED_URL}" rel="self" type="application/rss+xml"/>` : ''}
${items}
  </channel>
</rss>`;
}

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
    } catch {
      // skip failed fetches silently
    }
    await Bun.sleep(150);
  }
  process.stdout.write('\n');

  console.log(`This week: ${articles.length} articles`);
  articles.forEach(a => console.log(`  ${a.section}: ${a.title} (${a.author})`));

  const rss = generateRSS(articles, new Date());
  await Bun.write('feed.xml', rss);
  console.log('Written feed.xml');
}

main().catch(e => { console.error(e); process.exit(1); });
