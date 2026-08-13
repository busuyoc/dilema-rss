import { describe, expect, test } from 'bun:test';
import {
  parseRomanianDate, getISOWeek, escapeXml, extractTagEntries,
  generateOPDS, sniffImage, issueImageUrl,
} from './scraper';

describe('parseRomanianDate', () => {
  test('full date with year', () => {
    const d = parseRomanianDate('07 Mai 2026');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(4);
    expect(d?.getDate()).toBe(7);
  });

  test('weekday prefix and mixed case, as printed on the site', () => {
    const d = parseRomanianDate('Joi, 16 Iulie 2026');
    expect(d?.getMonth()).toBe(6);
    expect(d?.getDate()).toBe(16);
  });

  test('year-less date needs a fallback year', () => {
    expect(parseRomanianDate('09 Iulie')).toBeNull();
    const d = parseRomanianDate('09 Iulie', 2026);
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(6);
    expect(d?.getDate()).toBe(9);
  });

  test('rejects unknown month and garbage', () => {
    expect(parseRomanianDate('12 Frimaire 2026')).toBeNull();
    expect(parseRomanianDate('no date here')).toBeNull();
    expect(parseRomanianDate('')).toBeNull();
  });
});

describe('getISOWeek', () => {
  test('regular Thursdays', () => {
    expect(getISOWeek(new Date(2026, 6, 16))).toBe(29); // 2026-07-16
    expect(getISOWeek(new Date(2026, 6, 9))).toBe(28);  // 2026-07-09
  });

  test('year boundaries', () => {
    expect(getISOWeek(new Date(2026, 0, 1))).toBe(1);    // Thu Jan 1 2026 → W1
    expect(getISOWeek(new Date(2025, 11, 29))).toBe(1);  // Mon Dec 29 2025 → W1 of 2026
    expect(getISOWeek(new Date(2027, 0, 1))).toBe(53);   // Fri Jan 1 2027 → W53 of 2026
  });
});

describe('escapeXml', () => {
  test('escapes the five XML metacharacters', () => {
    expect(escapeXml(`a & b < c > "d" 'e'`))
      .toBe('a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;');
  });
});

describe('extractTagEntries', () => {
  const card = (path: string, date: string) => `
    <div class="card">
      <a href="${path}"><h2>Titlu</h2></a>
      <span class="post-date"><i class="fa fa-clock-o"></i>${date}</span>
    </div>`;

  test('pairs article path with its inline date', () => {
    const entries = extractTagEntries(card('/film/un-articol-frumos', 'Joi, 07 Mai'));
    const d = entries.get('/film/un-articol-frumos');
    expect(d?.getMonth()).toBe(4);
    expect(d?.getDate()).toBe(7);
  });

  test('skips excluded path prefixes', () => {
    const html =
      card('/autor/stela-giurgeanu', 'Joi, 07 Mai') +
      card('/tag/vara-fierbinte', 'Joi, 07 Mai');
    expect(extractTagEntries(html).size).toBe(0);
  });

  test('first date wins for a repeated URL', () => {
    const html =
      card('/film/acelasi-articol', 'Joi, 07 Mai') +
      card('/film/acelasi-articol', 'Vineri, 08 Mai');
    const d = extractTagEntries(html).get('/film/acelasi-articol');
    expect(d?.getDate()).toBe(7);
  });

  test('year-less future dates are corrected to last year', () => {
    const entries = extractTagEntries(card('/film/din-decembrie', '31 Decembrie'));
    const d = entries.get('/film/din-decembrie')!;
    expect(d.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('generateOPDS', () => {
  const updated = new Date('2026-07-16T10:00:00Z');
  const xml = generateOPDS(
    [
      { file: 'dilema-2026-W29.epub', issue: '2026-W29', updated },
      { file: 'dilema-2026-W28.epub', issue: '2026-W28', updated },
    ],
    updated,
  );

  test('one acquisition entry per issue', () => {
    expect(xml.match(/<entry>/g)?.length).toBe(2);
    expect(xml).toContain('href="dilema-2026-W29.epub"');
    expect(xml).toContain('rel="http://opds-spec.org/acquisition"');
    expect(xml).toContain('type="application/epub+zip"');
  });

  test('is well-formed enough for a strict parser (balanced, escaped)', () => {
    expect(xml).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml.match(/<feed[\s>]/g)?.length).toBe(1);
    expect(xml.match(/<\/feed>/g)?.length).toBe(1);
    expect(xml).not.toContain('&&');
  });
});


describe('issueImageUrl', () => {
  test('addresses art by the issue week, zero-padded', () => {
    // 2026-07-09 is the Thursday of ISO week 28.
    expect(issueImageUrl('coperta', new Date(2026, 6, 9), 'webp'))
      .toBe('https://www.dilema.ro/images/coperta/28-2026.webp');
  });

  test('same scheme for the caricature', () => {
    expect(issueImageUrl('barburisme', new Date(2026, 7, 13), 'webp'))
      .toBe('https://www.dilema.ro/images/barburisme/33-2026.webp');
  });

  test('a late rebuild still names the issue week, not the build week', () => {
    // Backfilling W28 in August must not ask for August's cover.
    expect(issueImageUrl('coperta', new Date(2026, 6, 9), 'webp')).toContain('/28-2026.');
  });
});

describe('sniffImage', () => {
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

  test('identifies webp, jpeg and png by magic bytes', () => {
    expect(sniffImage(webp)?.ext).toBe('webp');
    expect(sniffImage(jpg)?.ext).toBe('jpg');
    expect(sniffImage(png)?.ext).toBe('png');
  });

  test('mime types match the extension', () => {
    expect(sniffImage(webp)?.mime).toBe('image/webp');
    expect(sniffImage(jpg)?.mime).toBe('image/jpeg');
    expect(sniffImage(png)?.mime).toBe('image/png');
  });

  test('rejects the homepage HTML served for an unpublished week', () => {
    // dilema.ro 302s a missing cover to `/`; the body is the homepage. This is
    // the check that keeps 120 KB of HTML from being embedded as cover.webp.
    const html = new TextEncoder().encode('<!DOCTYPE html>\n<html lang="ro">');
    expect(sniffImage(html)).toBeNull();
  });

  test('rejects empty and truncated responses', () => {
    expect(sniffImage(new Uint8Array(0))).toBeNull();
    expect(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBeNull();  // RIFF, no WEBP
  });
});
