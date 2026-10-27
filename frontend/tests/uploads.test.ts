// Uploads and exports: what the upload dialog suggests from a file, and the CSV formula guard.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildCsvFromArrays, neutralize } from '../src/lib/csv.ts';
import { detectEncoding, looksCyrillic, sniffNumbers, sniffText } from '../src/federation/sniff.ts';

/** Windows-1251 bytes of a text (Cyrillic letters, ASCII and the non-breaking space only). */
function cp1251(text: string): Uint8Array {
  return new Uint8Array([...text].map((ch) => {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) return c;
    if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
    if (c === 0x401) return 0xa8;
    if (c === 0x451) return 0xb8;
    if (c === 0xa0) return 0xa0;
    throw new Error(`no cp1251 byte for ${ch}`);
  }));
}

describe('upload suggestions', () => {
  test('a Russian Excel export: Windows-1251, ";" and a decimal comma', () => {
    const bytes = cp1251('customer_id;Регион;target\n1;Север;100,5\n2;Юг;1 200\n');
    assert.deepEqual(sniffText(bytes, true), { encoding: 'windows-1251', delimiter: 'semicolon', numberFormat: 'comma' });
  });

  test('UTF-8, UTF-16 and Western European files', () => {
    const utf8 = new TextEncoder().encode('Имя;Сумма\nИван;10,5\n');
    assert.equal(detectEncoding(utf8, true), 'utf-8');
    assert.equal(detectEncoding(utf8.slice(0, 6), false), 'utf-8'); // a sample cut inside a letter
    assert.equal(detectEncoding(new Uint8Array([0xff, 0xfe, 0x61, 0]), true), 'utf-16');
    const cafe = new Uint8Array([...new TextEncoder().encode('name\ncaf'), 0xe9, ...new TextEncoder().encode(' cr'), 0xe8, 0x6d, 0x65]);
    assert.equal(detectEncoding(cafe, true), 'windows-1252');
    assert.equal(looksCyrillic('Север Юг'), true);
    assert.equal(looksCyrillic('cafй crиme'), false);
  });

  test('decimal comma only for ";" files without decimal points', () => {
    assert.equal(sniffNumbers('a;b\nx;1,5\ny;31.01.2026\n', ';'), 'comma'); // dates are not decimal points
    assert.equal(sniffNumbers('a;b\nx;1,5\ny;2.5\n', ';'), 'point');
    assert.equal(sniffNumbers('a,b\n"1,5",2\n', ','), 'point');
    assert.equal(sniffText(new TextEncoder().encode('a,b\n1.5,2\n'), true).numberFormat, 'point');
  });
});

describe('CSV formula guard (OWASP)', () => {
  test('cells that a spreadsheet would run get an apostrophe', () => {
    for (const v of ["-2+3+cmd|' /C calc'!A0", '=1+1', '+7 (999) 123-45-67', '@SUM(A1)', '\tx', '\rx', '-']) {
      assert.equal(neutralize(v), `'${v}`, v);
    }
  });

  test('plain numbers and ordinary text stay as they are', () => {
    for (const v of ['-12.5', '+3', '-0,5', '1e5', '-1.2E-3', 'a-b', 'Север']) assert.equal(neutralize(v), v, v);
    assert.equal(buildCsvFromArrays(['a'], [["-2+3+cmd|' /C calc'!A0"], [-12.5]], ';'), "a\r\n'-2+3+cmd|' /C calc'!A0\r\n-12.5\r\n");
  });
});
