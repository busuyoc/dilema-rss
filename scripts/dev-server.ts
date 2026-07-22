// Local static server for testing the search page. GitHub Pages supports HTTP
// range requests (which sql.js-httpvfs depends on); Bun's dev conveniences and
// python -m http.server do not, so this fills the gap. Serves the repo root.
//
//   bun run scripts/dev-server.ts   →  http://localhost:8722/
const PORT = 8722;

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    if (path.includes('..')) return new Response('bad path', { status: 400 });

    const file = Bun.file('.' + path);
    if (!(await file.exists())) return new Response('not found', { status: 404 });

    const range = req.headers.get('range');
    if (range) {
      const m = range.match(/^bytes=(\d+)-(\d*)$/);
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Math.min(Number(m[2]), file.size - 1) : file.size - 1;
        return new Response(file.slice(start, end + 1), {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${file.size}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }
    }
    return new Response(file, { headers: { 'Accept-Ranges': 'bytes' } });
  },
});

console.log(`serving . on http://localhost:${PORT}/`);
