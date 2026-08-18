package main

import (
	"database/sql"
	"encoding/xml"
	"fmt"
	"os"
	"strings"
	"time"
)

// EPUBs carry no source URLs, so backfilled rows land with url = NULL. The
// weekly feed.xml *does* carry them — and every past week's feed survives in
// git history. feedurls replays one feed.xml into the archive, filling URLs
// on rows matched by (issue, title). See scripts/backfill-urls.sh for the
// git-history walk.

type rssDoc struct {
	Items []struct {
		Title   string `xml:"title"` // "Section label · Article title"
		Link    string `xml:"link"`
		PubDate string `xml:"pubDate"`
	} `xml:"channel>item"`
}

func cmdFeedURLs(db *sql.DB, path string) {
	raw, err := os.ReadFile(path)
	if err != nil {
		fatal("%v", err)
	}
	var doc rssDoc
	if err := xml.Unmarshal(raw, &doc); err != nil {
		fatal("%s: %v", path, err)
	}
	if len(doc.Items) == 0 {
		fmt.Printf("%s: no items\n", path)
		return
	}

	// The issue is the ISO week of the newest pubDate in the feed (the
	// dossier's publication Thursday anchors each feed's window).
	var latest time.Time
	for _, it := range doc.Items {
		if t, err := time.Parse(time.RFC1123, it.PubDate); err == nil && t.After(latest) {
			latest = t
		}
	}
	if latest.IsZero() {
		fatal("%s: no parseable pubDate", path)
	}
	year, week := latest.ISOWeek()
	issue := fmt.Sprintf("%d-W%02d", year, week)

	filled, matched := 0, 0
	for _, it := range doc.Items {
		// Strip the "Section label · " prefix the feed adds to titles.
		title := it.Title
		if _, after, ok := strings.Cut(it.Title, " · "); ok {
			title = after
		}
		title = strings.TrimSpace(title)
		if title == "" || it.Link == "" {
			continue
		}

		res, err := db.Exec(
			`UPDATE articles SET url = ? WHERE issue = ? AND title = ? AND url IS NULL`,
			it.Link, issue, title,
		)
		if err != nil {
			fatal("update %q: %v", title, err)
		}
		if n, _ := res.RowsAffected(); n > 0 {
			filled++
		} else {
			var already int
			db.QueryRow(`SELECT COUNT(*) FROM articles WHERE issue = ? AND title = ?`, issue, title).Scan(&already)
			if already > 0 {
				matched++
			}
		}
	}
	fmt.Printf("%s (%s): %d urls filled, %d already had one, %d items\n",
		path, issue, filled, matched, len(doc.Items))
}
