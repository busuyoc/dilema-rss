import { describe, expect, test } from 'bun:test';
import {
  parseRomanianDate, getISOWeek, escapeXml, extractTagEntries,
  generateOPDS,
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
