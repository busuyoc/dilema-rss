// Search frontend for the Dilema archive. Queries dilema.db directly from the
// browser: sql.js-httpvfs runs SQLite in a Web Worker on a virtual filesystem
// that reads the database over HTTP range requests, so a search touches only
// the b-tree pages it needs — a few hundred KB, never the whole file. This is
// what lets a "backend" full-text search run on a static GitHub Pages site.
import { createDbWorker } from 'sql.js-httpvfs';

// Sentinels for match highlighting: snippet() output must be HTML-escaped
// (article text is untrusted), so real <mark> tags can only be added after
// escaping. \x01/\x02 can't occur in the text and survive the escape.
const MARK_OPEN = '\x01';
const MARK_CLOSE = '\x02';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const input = $<HTMLInputElement>('#q');
const results = $('#results');
const status = $('#status');
const meterFill = $('#meter-fill');
const meterLabel = $('#meter-label');

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderSnippet(s: string): string {
  return escapeHtml(s)
    .replaceAll(MARK_OPEN, '<mark>')
    .replaceAll(MARK_CLOSE, '</mark>');
}

// User input → FTS5 query. Quoting every token sidesteps FTS5 operator syntax
// errors on stray punctuation; the trailing * makes the last word a prefix so
// results appear while a word is still being typed. Input with its own double
// quotes is passed through untouched for phrase/NEAR/OR power users.
function toFtsQuery(raw: string): string {
  if (raw.includes('"')) return raw;
  const tokens = raw.split(/\s+/).filter(Boolean).map(t => `"${t.replace(/"/g, '')}"`);
  if (tokens.length === 0) return '';
  tokens[tokens.length - 1] += '*';
  return tokens.join(' ');
}

function formatKB(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

interface Row {
  issue: string;
  section: string;
  author: string;
  title: string;
  url: string | null;
  snip: string;
}

async function main() {
  status.textContent = 'se deschide arhiva…';

  const dbUrl = new URL('dilema.db', document.baseURI).toString();
  const worker = await createDbWorker(
    [{
      from: 'inline',
      config: { serverMode: 'full', url: dbUrl, requestChunkSize: 4096 },
    }],
    new URL('search/sqlite.worker.js', document.baseURI).toString(),
    new URL('search/sql-wasm.wasm', document.baseURI).toString(),
  );

  const dbSize = await fetch(dbUrl, { method: 'HEAD' })
    .then(r => Number(r.headers.get('content-length')) || 0)
    .catch(() => 0);

  async function updateMeter() {
    try {
      const read = Number(await worker.worker.bytesRead);
      if (dbSize > 0) {
        meterFill.style.width = `${Math.min(100, (read / dbSize) * 100)}%`;
        meterLabel.textContent = `${formatKB(read)} citiți din ${formatKB(dbSize)}`;
      }
    } catch { /* bytesRead is best-effort */ }
  }

  // Cheap archive stats: max(id) and min/max(issue) resolve through indexes
  // (a few pages). COUNT(*) would walk the whole table b-tree — which over
  // httpvfs means downloading most of the database. Avoid.
  const [meta] = await worker.db.query(
    `SELECT max(id) AS n, min(issue) AS lo, max(issue) AS hi FROM articles`,
  ) as { n: number; lo: string; hi: string }[];
  status.textContent = `${meta.n} de articole, ${meta.lo} – ${meta.hi}`;
  await updateMeter();

  let generation = 0;
  async function search(raw: string) {
    const gen = ++generation;
    const q = toFtsQuery(raw.trim());
    if (!q) {
      results.innerHTML = '';
      status.textContent = `${meta.n} de articole, ${meta.lo} – ${meta.hi}`;
      return;
    }

    const t0 = performance.now();
    let rows: Row[];
    try {
      rows = await worker.db.query(`
        SELECT a.issue, a.section, a.author, a.title, a.url,
               snippet(articles_fts, 3, '${MARK_OPEN}', '${MARK_CLOSE}', ' … ', 18) AS snip
        FROM articles_fts
        JOIN articles a ON a.id = articles_fts.rowid
        WHERE articles_fts MATCH ?
        ORDER BY bm25(articles_fts)
        LIMIT 30`, [q]) as Row[];
    } catch {
      if (gen === generation) status.textContent = 'interogare invalidă — încearcă alte cuvinte';
      return;
    }
    if (gen !== generation) return; // a newer keystroke superseded this query
    const ms = Math.round(performance.now() - t0);

    status.textContent = rows.length === 0
      ? 'niciun rezultat'
      : `${rows.length}${rows.length === 30 ? '+' : ''} rezultate în ${ms} ms`;

    results.innerHTML = rows.map(r => {
      const title = r.url
        ? `<a href="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a>`
        : escapeHtml(r.title);
      return `<article>
        <p class="eyebrow"><span class="issue">${escapeHtml(r.issue)}</span> · ${escapeHtml(r.section)}</p>
        <h2>${title}</h2>
        <p class="byline">${escapeHtml(r.author)}</p>
        <p class="snippet">${renderSnippet(r.snip)}</p>
      </article>`;
    }).join('');
    await updateMeter();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => search(input.value), 250);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      clearTimeout(timer);
      search(input.value);
    }
  });
  for (const chip of document.querySelectorAll<HTMLButtonElement>('.chip')) {
    chip.addEventListener('click', () => {
      input.value = chip.dataset.q ?? '';
      input.focus();
      search(input.value);
    });
  }

  input.disabled = false;
  input.focus();
}

main().catch(e => {
  status.textContent = `arhiva nu s-a putut deschide: ${e instanceof Error ? e.message : e}`;
});
