// Pure helpers for statement import. They run in the browser, so the organizing that must be
// consistent across a whole year (recurring charges, duplicates, month totals) is done by code,
// not by a model that only ever sees one chunk.

// Hebrew CSVs saved from Excel are often Windows-1255, which reads as gibberish as UTF-8.
export function decodeText(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1255").decode(bytes);
  }
}

// Non-empty lines, cut into chunks small enough for one model call inside a 60s function.
export function chunkLines(text, size = 80) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < lines.length; i += size) chunks.push({ start: i, end: Math.min(i + size, lines.length) });
  return { lines, chunks };
}

// Lines carry their index so the model can say which line each row came from —
// that index, not the model's retelling, is what the fingerprint is built from.
export const numbered = (lines, start, end) =>
  lines.slice(start, end).map((l, i) => `${start + i}| ${l}`).join("\n");

// Same statement line imported twice → same fingerprint → the DB's unique index drops the repeat.
// Identical lines within one file (two equal coffees) are told apart by occurrence number.
export function fingerprints(rows, lines = []) {
  const seen = {};
  return rows.map((r) => {
    const base = Number.isInteger(r.line) && lines[r.line] != null
      ? "L:" + lines[r.line]
      : `M:${r.date}|${r.amount}|${r.raw || r.merchant}`;
    seen[base] = (seen[base] || 0) + 1;
    return base + "#" + seen[base];
  });
}

// A merchant seen in 3+ different months at a steady amount (within 20% of its median) is a
// recurring charge: rent, subscriptions, insurance.
export function markRecurring(rows) {
  const byMerchant = {};
  rows.forEach((r, i) => {
    if (r.kind === "out" && r.merchant) (byMerchant[r.merchant] ||= []).push(i);
  });
  const recurring = new Set();
  for (const idx of Object.values(byMerchant)) {
    const amounts = idx.map((i) => rows[i].amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const steady = idx.filter((i) => Math.abs(rows[i].amount - median) <= median * 0.2);
    if (new Set(steady.map((i) => rows[i].date.slice(0, 7))).size >= 3) steady.forEach((i) => recurring.add(i));
  }
  return rows.map((r, i) => (recurring.has(i) ? { ...r, recurring: true } : r));
}

const shiftDay = (iso, n) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// An expense already logged by voice also shows up on the statement. Same amount within a day
// either side gets flagged and left out unless the user ticks it back in.
export function flagDuplicates(rows, existing) {
  const have = new Set();
  for (const t of existing) {
    if (t.src === "import") continue; // earlier imports are deduped exactly, by fingerprint
    for (const off of [-1, 0, 1]) have.add(shiftDay(t.d, off) + "|" + t.a);
  }
  return rows.map((r) => (r.kind !== "skip" && have.has(r.date + "|" + r.amount) ? { ...r, dup: true } : r));
}

export function byMonth(rows) {
  const months = {};
  for (const r of rows) {
    if (r.kind === "skip" || r.dup) continue;
    const m = (months[r.date.slice(0, 7)] ||= { month: r.date.slice(0, 7), in: 0, out: 0, count: 0, cats: {} });
    m.count++;
    if (r.kind === "in") m.in += r.amount;
    else {
      m.out += r.amount;
      m.cats[r.category] = (m.cats[r.category] || 0) + r.amount;
    }
  }
  return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
}
