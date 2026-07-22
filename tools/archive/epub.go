package main

import (
	"archive/zip"
	"encoding/xml"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"strings"
)

// The scraper writes one article per OEBPS/a<N>.xhtml; cover.xhtml, toc.xhtml
// and barburisme.xhtml are layout pages with no article content.
var articlePageRe = regexp.MustCompile(`^OEBPS/a\d+\.xhtml$`)

var issueRe = regexp.MustCompile(`dilema-(\d{4}-W\d{2})\.epub$`)

// Reverse of SECTION_LABELS in src/scraper.ts: the EPUB carries display
// labels, articles.jsonl carries URL slugs — map back so both sources land on
// the same section value. Labels missing here are already slugs (the scraper
// falls back to the raw slug for sections outside its SECTIONS list).
var sectionSlugs = map[string]string{
	"Tema săptămânii":         "tema-saptaminii",
	"Editoriale și opinii":    "editoriale-si-opinii",
	"La fața timpului":        "la-fata-timpului",
	"La fața locului":         "la-fata-locului",
	"Pe ce lume trăim":        "pe-ce-lume-traim",
	"La singular și la plural": "la-singular-si-la-plural",
	"Societate":               "societate",
	"Din polul plus":          "din-polul-plus",
	"Caleidoscopie":           "caleidoscopie",
	"Carte":                   "carte",
	"Film":                    "film",
	"Muzică":                  "muzica",
	"Arte vizuale":            "arte-vizuale",
	"Arte performative":       "arte-performative",
	"La zi în cultură":        "la-zi-in-cultura",
	"Tîlc Show":               "tilc-show",
}

// Month names as printed by the scraper's formatRomanianDate (all ASCII).
var roMonths = map[string]string{
	"ianuarie": "01", "februarie": "02", "martie": "03", "aprilie": "04",
	"mai": "05", "iunie": "06", "iulie": "07", "august": "08",
	"septembrie": "09", "octombrie": "10", "noiembrie": "11", "decembrie": "12",
}

var roDateRe = regexp.MustCompile(`(\d{1,2})\s+(\p{L}+)\s+(\d{4})`)

func parseRoDate(s string) string {
	m := roDateRe.FindStringSubmatch(s)
	if m == nil {
		return ""
	}
	month, ok := roMonths[strings.ToLower(m[2])]
	if !ok {
		return ""
	}
	return fmt.Sprintf("%s-%s-%02s", m[3], month, m[1])
}

func parseEpub(path string) ([]Article, error) {
	m := issueRe.FindStringSubmatch(filepath.Base(path))
	if m == nil {
		return nil, fmt.Errorf("filename does not match dilema-YYYY-Www.epub (use the dated files, not dilema-latest.epub)")
	}
	issue := m[1]

	zr, err := zip.OpenReader(path)
	if err != nil {
		return nil, err
	}
	defer zr.Close()

	var articles []Article
	for _, f := range zr.File {
		if !articlePageRe.MatchString(f.Name) {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f.Name, err)
		}
		a, err := parseArticleXHTML(rc)
		rc.Close()
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f.Name, err)
		}
		a.Issue = issue
		a.source = "epub"
		articles = append(articles, a)
	}
	return articles, nil
}

// parseArticleXHTML walks the token stream of a scraper-generated article page:
//
//	<div class="article">
//	  <p class="section-label">…</p>
//	  <h1>…</h1>
//	  <p class="subtitle">…</p>          (optional)
//	  <p class="meta">Author — 16 iulie 2026</p>
//	  <div class="content"> <p>…</p> <h2>…</h2> <blockquote>…</blockquote> … </div>
//	</div>
//
// The generator escapes all text, so pages are strict XML with no nested
// markup inside blocks — each block's text arrives as direct character data.
func parseArticleXHTML(r io.Reader) (Article, error) {
	type frame struct{ name, class string }
	var (
		a       Article
		stack   []frame
		title   strings.Builder
		section strings.Builder
		sub     strings.Builder
		meta    strings.Builder
		cur     strings.Builder
		paras   []string
	)

	inContent := func() bool {
		for _, f := range stack {
			if f.name == "div" && f.class == "content" {
				return true
			}
		}
		return false
	}
	// Which text bucket the current stack position writes into.
	target := func() *strings.Builder {
		if len(stack) == 0 {
			return nil
		}
		top := stack[len(stack)-1]
		if inContent() {
			switch top.name {
			case "p", "h2", "h3", "blockquote":
				return &cur
			}
			return nil
		}
		switch {
		case top.name == "h1":
			return &title
		case top.name == "p" && top.class == "section-label":
			return &section
		case top.name == "p" && top.class == "subtitle":
			return &sub
		case top.name == "p" && top.class == "meta":
			return &meta
		}
		return nil
	}

	dec := xml.NewDecoder(r)
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return a, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			var class string
			for _, at := range t.Attr {
				if at.Name.Local == "class" {
					class = at.Value
				}
			}
			stack = append(stack, frame{t.Name.Local, class})
		case xml.CharData:
			if b := target(); b != nil {
				b.Write(t)
			}
		case xml.EndElement:
			if target() == &cur {
				if s := strings.TrimSpace(cur.String()); s != "" {
					paras = append(paras, s)
				}
				cur.Reset()
			}
			stack = stack[:len(stack)-1]
		}
	}

	a.Title = strings.TrimSpace(title.String())
	if a.Title == "" {
		return a, fmt.Errorf("no <h1> title found")
	}
	a.Subtitle = strings.TrimSpace(sub.String())
	a.Body = strings.Join(paras, "\n\n")

	label := strings.TrimSpace(section.String())
	if slug, ok := sectionSlugs[label]; ok {
		a.Section = slug
	} else {
		a.Section = label
	}

	// meta line: "Author — 16 iulie 2026"
	if author, date, ok := strings.Cut(meta.String(), "—"); ok {
		a.Author = strings.TrimSpace(author)
		a.Date = parseRoDate(date)
	} else {
		a.Author = strings.TrimSpace(meta.String())
	}
	return a, nil
}
