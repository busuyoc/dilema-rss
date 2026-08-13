# Dilema RSS

Scraper săptămânal pentru articolele din **Dilema Veche**. Generează un feed RSS și un EPUB (cu coperta oficială și sumar pe secțiuni), livrate prin GitHub Pages. Plugin KOReader le sincronizează automat pe device — joi după-amiază ai noul număr deja descărcat.

## Cum funcționează

Joi ~13:00 RO, GitHub Actions rulează:
- Scrape `dilema.ro` → ~27 articole din săptămâna curentă
- Generează `feed.xml` (RSS 2.0) + `dilema-latest.epub`
- Publică pe GitHub Pages

Pe device, după un fetch în QuickRSS, plugin-ul descarcă silent noul EPUB.

## Instalare

Ai nevoie doar de KOReader. Niciun alt plugin, niciun patch.

**1. Copiază `dilema.koplugin/`** din repo în `applications/koreader/plugins/` pe device.

**2. Copiază `icons/dilema.svg`** în `applications/koreader/icons/` — directorul e căutat
înaintea setului inclus, deci nu suprascrii nimic.

**3. Restart KOReader.**

**4. Leagă acțiunea de un buton** (opțional). Plugin-ul înregistrează două acțiuni în
Dispatcher-ul standard, deci apar oriunde KOReader permite acțiuni:

- *Dilema: fetch new issue* — descarcă numărul nou și te întreabă dacă îl deschizi
- *Dilema: open latest issue* — deschide direct ultimul număr de pe device

Le poți lega la un gest (Settings → Gestures), la un profil, sau — dacă folosești un
launcher gen zenUI — la un buton propriu în navbar, cu iconul de mai sus. Nimic din
plugin nu depinde de un anumit launcher; pe KOReader simplu funcționează prin gest sau
din meniu (Tools → Dilema).

## Folosire

Apeși butonul. Plugin-ul verifică catalogul și îți spune ce s-a întîmplat:

- **număr nou** → se descarcă, apoi „Dilema 2026-W34 downloaded. Saved in /mnt/ext1/books/“
  cu opțiunea *Read now*
- **nimic nou** → „No new issue — you already have Dilema 2026-W33“, tot cu opțiunea de a-l
  deschide
- **eroare** → mesaj explicit (catalog inaccesibil, descărcare eșuată)

Nu există apăsare fără răspuns: fiecare rulare interactivă se termină ori cu cartea pe
ecran, ori cu o propoziție care spune de ce nu. Meniul (Tools → Dilema) arată și cînd a
fost ultima sincronizare și cum s-a terminat.

În fundal, plugin-ul mai încearcă o sincronizare cînd se conectează la rețea
(`NetworkConnected`, eveniment nativ KOReader), cel mult o dată la 6 ore, și tace dacă nu
e nimic nou.

Numerele stau ca fișiere obișnuite în `/mnt/ext1/books/`, deci apar în biblioteca normală.

## Arhiva completă (opțional)

Plugin-ul aduce doar numerele noi. Dacă vrei un număr vechi, repo-ul publică și un catalog
OPDS 1.2 peste toate numerele, iar KOReader are cititor OPDS inclus:

```
Settings → OPDS catalog → add
https://busuyoc.github.io/dilema-rss/catalog.xml
```

Funcționează și din Calibre sau PocketBook OS. E o alternativă, nu o dependență — nimic din
fluxul de mai sus nu trece prin OPDS.

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
               ├─ GET /catalog.xml
               ├─ ia cele mai noi MAX_ISSUES numere din catalog
               ├─ păstrează doar ce e mai nou decît marcajul local
               └─ pentru fiecare, de la vechi la nou:
                   GET → write atomic (tmp + rename) → avansează marcajul
```

Fiecare număr se salvează sub numele lui datat (`dilema-2026-W33.epub`), niciodată
peste o cale fixă: KOReader ține coperta (`bookinfo_cache`) și progresul (`.sdr`)
legate de cale, așa că refolosirea unei singure căi făcea ca fiecare număr nou să
moștenească coperta și poziția celui vechi.

Marcajul (`dilema_last_issue.txt`) reține cel mai nou număr descărcat vreodată și
avansează doar înainte. Existența fișierului pe disc nu e suficientă: nu distinge
„n-am avut niciodată numărul“ de „l-am citit și l-am șters“. Fără marcaj,
parcurgerea mai multor intrări din catalog ar redescărca numerele șterse intenționat;
cu el, o săptămînă ratată (deploy Pages eșuat, rulare sărită) ajunge pe device mai
tîrziu, dar una citită rămîne ștearsă.

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
