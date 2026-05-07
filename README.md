# Dilema RSS

Scraper săptămânal pentru articolele din **Dilema Veche**. Generează un feed RSS și un EPUB (cu coperta oficială și sumar pe secțiuni), livrate prin GitHub Pages. Plugin KOReader le sincronizează automat pe device — joi după-amiază ai noul număr deja descărcat.

## Cum funcționează

Joi ~13:00 RO, GitHub Actions rulează:
- Scrape `dilema.ro` → ~27 articole din săptămâna curentă
- Generează `feed.xml` (RSS 2.0) + `dilema-latest.epub`
- Publică pe GitHub Pages

Pe device, după un fetch în QuickRSS, plugin-ul descarcă silent noul EPUB.

## Instalare

Ai nevoie de KOReader + [QuickRSS](https://github.com/qewer33/quickrss.koplugin).

**1. Adaugă feed-ul în QuickRSS:**
```
https://busuyoc.github.io/dilema-rss/feed.xml
```

**2. Instalează plugin-ul** — copiază `dilema.koplugin/` din repo în `applications/koreader/plugins/` pe device.

**3. Patch QuickRSS** (până la merge upstream): în `quickrss.koplugin/modules/ui/feed_view.lua`, adaugă la imports:
```lua
local Event = require("ui/event")
```
și după `Cache.saveArticles(articles)` în `_fetch()`:
```lua
UIManager:broadcastEvent(Event:new("RSSFetchComplete"))
```

**4. Restart KOReader.**

## Folosire

Deschide QuickRSS → fetch. Articolele apar în reader-ul de feed-uri pentru citit rapid. În paralel, EPUB-ul ajunge în `/mnt/ext1/books/dilema-latest.epub` (sau echivalentul pe device-ul tău) — îl deschizi pentru experiență full: copertă, cuprins navigabil pe secțiuni, format curat.

Săptămâna următoare, fetch din nou. Dacă nu e nimic nou, plugin-ul nu descarcă (verifică `Last-Modified`). Zero traffic, zero baterie irosită.

---

## Detalii tehnice

### Stack

- **Bun + TypeScript**, fără build step
- **fflate** (zip), **node-html-parser** (DOM)
- **GitHub Pages** (hosting) + **GitHub Actions** (cron)
- **Lua** plugin pentru KOReader

### Sync flow

```
QuickRSS fetch
   └─ Cache.saveArticles
       └─ broadcastEvent("RSSFetchComplete")
           └─ Dilema:onRSSFetchComplete
               ├─ HEAD /dilema-latest.epub
               ├─ compară Last-Modified cu .lastmod local
               ├─ verifică dacă fișierul țintă există
               └─ GET → write atomic (tmp + rename) → update .lastmod
```

Toate stările sunt logate în `crash.log` (`Dilema: ...`).

### EPUB cover

Manifest-ul declară coperta în două moduri în paralel:
- EPUB 2: `<meta name="cover" content="cover-image"/>`
- EPUB 3: `<item properties="cover-image"/>`

Pentru compat cu PocketBook OS native + KOReader/crengine. Library thumbnail în KOReader e cache-uit în `bookinfo_cache.sqlite3` — extras la prima open.

### Fork pentru altă revistă

```bash
bun install
bun run scrape   # test local
```

În `src/scraper.ts` modifici:
- `BASE` (URL revista) și `SECTIONS` (taxonomie)
- selectoarele CSS din `fetchArticle`
- regex-ul de cover din `fetchCoverImage`

Cron-ul e în `.github/workflows/scrape.yml`.

## License

MIT.
