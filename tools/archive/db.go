package main

import (
	"database/sql"

	_ "modernc.org/sqlite" // pure-Go driver: single static binary, no cgo
)

// External-content FTS5 table kept in sync by triggers, so plain INSERT/UPDATE
// statements are all the Go side ever issues. unicode61 with remove_diacritics 2
// makes "saptamana" match "săptămâna" — searches work without Romanian keyboard
// layouts.
const schema = `
CREATE TABLE IF NOT EXISTS articles (
  id          INTEGER PRIMARY KEY,
  url         TEXT,
  title       TEXT NOT NULL,
  subtitle    TEXT NOT NULL DEFAULT '',
  author      TEXT NOT NULL DEFAULT '',
  section     TEXT NOT NULL DEFAULT '',
  pub_date    TEXT,
  issue       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL,
  ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(issue, title)
);
CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);

CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  title, subtitle, author, body,
  content='articles', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title, subtitle, author, body)
  VALUES (new.id, new.title, new.subtitle, new.author, new.body);
END;
CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, subtitle, author, body)
  VALUES ('delete', old.id, old.title, old.subtitle, old.author, old.body);
END;
CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, subtitle, author, body)
  VALUES ('delete', old.id, old.title, old.subtitle, old.author, old.body);
  INSERT INTO articles_fts(rowid, title, subtitle, author, body)
  VALUES (new.id, new.title, new.subtitle, new.author, new.body);
END;
`

func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

// upsert inserts an article or merges it into the existing (issue, title) row.
// Merge policy: jsonl is authoritative (fresher, has URLs) and overwrites;
// an epub row only fills fields the existing row is missing. Returns whether
// a new row was created.
func upsert(tx *sql.Tx, a Article) (bool, error) {
	var existing int
	err := tx.QueryRow(
		`SELECT COUNT(*) FROM articles WHERE issue = ? AND title = ?`,
		a.Issue, a.Title,
	).Scan(&existing)
	if err != nil {
		return false, err
	}

	url := sql.NullString{String: a.URL, Valid: a.URL != ""}
	date := sql.NullString{String: a.Date, Valid: a.Date != ""}

	_, err = tx.Exec(`
		INSERT INTO articles (url, title, subtitle, author, section, pub_date, issue, body, source)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(issue, title) DO UPDATE SET
		  url      = COALESCE(excluded.url, url),
		  subtitle = CASE WHEN excluded.source = 'jsonl' OR subtitle = '' THEN excluded.subtitle ELSE subtitle END,
		  author   = CASE WHEN excluded.source = 'jsonl' OR author   = '' THEN excluded.author   ELSE author   END,
		  section  = CASE WHEN excluded.source = 'jsonl' OR section  = '' THEN excluded.section  ELSE section  END,
		  body     = CASE WHEN excluded.source = 'jsonl' OR body     = '' THEN excluded.body     ELSE body     END,
		  pub_date = CASE WHEN excluded.source = 'jsonl' THEN excluded.pub_date ELSE COALESCE(pub_date, excluded.pub_date) END,
		  source   = CASE WHEN excluded.source = 'jsonl' THEN 'jsonl' ELSE source END`,
		url, a.Title, a.Subtitle, a.Author, a.Section, date, a.Issue, a.Body, a.source,
	)
	return existing == 0, err
}
