// node --test lib/importing.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeText, chunkLines, numbered, fingerprints, markRecurring, flagDuplicates, byMonth } from "./importing.js";

test("Windows-1255 CSV from Excel decodes as Hebrew", () => {
  const cp1255 = new Uint8Array([0xf9, 0xe5, 0xf4, 0xf8, 0xf1, 0xec]); // שופרסל
  assert.equal(decodeText(cp1255), "שופרסל");
  assert.equal(decodeText(new TextEncoder().encode("\uFEFFשופרסל")), "שופרסל"); // UTF-8 with BOM
});

test("chunks cover every non-empty line exactly once", () => {
  const { lines, chunks } = chunkLines("a\n\nb\r\nc\nd\ne", 2);
  assert.deepEqual(lines, ["a", "b", "c", "d", "e"]);
  assert.deepEqual(chunks, [{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 5 }]);
  assert.equal(numbered(lines, 2, 4), "2| c\n3| d");
});

test("fingerprints: stable across re-imports, distinct for identical lines", () => {
  const lines = ["01/03 ארומה 32", "01/03 ארומה 32", "02/03 מונית 45"];
  const rows = [{ line: 0 }, { line: 1 }, { line: 2 }];
  const fp = fingerprints(rows, lines);
  assert.notEqual(fp[0], fp[1]);                                // two equal coffees stay two rows
  assert.deepEqual(fingerprints(rows, lines), fp);              // same file again → same keys
  assert.match(fingerprints([{ date: "2026-03-01", amount: 3200, merchant: "ארומה" }])[0], /^M:/); // PDF rows
});

test("recurring needs 3 months at a steady amount", () => {
  const r = (date, merchant, amount) => ({ date, merchant, amount, kind: "out" });
  const out = markRecurring([
    r("2026-01-05", "נטפליקס", 4990), r("2026-02-05", "נטפליקס", 4990), r("2026-03-05", "נטפליקס", 5490),
    r("2026-01-10", "שופרסל", 30000), r("2026-01-20", "שופרסל", 28000),                  // one month only
    r("2026-01-01", "זארה", 20000), r("2026-02-01", "זארה", 900), r("2026-03-01", "זארה", 60000), // not steady
  ]);
  assert.deepEqual(out.map((x) => !!x.recurring), [true, true, true, false, false, false, false, false]);

  const weekly = [];
  for (const m of ["01", "02", "03"]) for (const d of ["03", "10", "17", "24"]) weekly.push(r(`2026-${m}-${d}`, "שופרסל", 30000));
  assert.ok(markRecurring(weekly).every((x) => !x.recurring)); // steady and every month, but weekly
});

test("a statement row matching an entry logged by voice is flagged", () => {
  const existing = [{ d: "2026-03-01", a: 3250, src: "capture" }, { d: "2026-03-09", a: 4800, src: "import" }];
  const rows = [
    { date: "2026-03-02", amount: 3250, kind: "out" },  // card posts a day later
    { date: "2026-03-09", amount: 4800, kind: "out" },  // earlier imports dedupe by fingerprint, not here
    { date: "2026-03-05", amount: 3250, kind: "out" },
  ];
  assert.deepEqual(flagDuplicates(rows, existing).map((x) => !!x.dup), [true, false, false]);
});

test("month totals skip excluded and duplicate rows", () => {
  const months = byMonth([
    { date: "2026-01-03", amount: 920000, kind: "in", category: "אחר" },
    { date: "2026-01-04", amount: 30000, kind: "out", category: "סופר" },
    { date: "2026-01-05", amount: 150000, kind: "skip", category: "אחר" },   // card settlement
    { date: "2026-01-06", amount: 3250, kind: "out", category: "אוכל בחוץ", dup: true },
    { date: "2026-02-01", amount: 4800, kind: "out", category: "תחבורה" },
  ]);
  assert.deepEqual(months.map((m) => [m.month, m.in, m.out, m.count]), [["2026-01", 920000, 30000, 2], ["2026-02", 0, 4800, 1]]);
  assert.deepEqual(months[0].cats, { "סופר": 30000 });
});
