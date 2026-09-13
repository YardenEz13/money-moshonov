// Ported verbatim from the original single-file app — same money/date rules.
export const MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

export const dm = iso => +iso.slice(8) + "." + +iso.slice(5, 7);        // 2026-09-12 → 12.9
export const mname = m => MONTHS[+m.slice(5, 7) - 1] + " " + m.slice(0, 4);
export const lastDay = m => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();

export function shiftMonth(m, n) {
  let y = +m.slice(0, 4), i = +m.slice(5, 7) - 1 + n;
  y += Math.floor(i / 12); i = ((i % 12) + 12) % 12;
  return y + "-" + String(i + 1).padStart(2, "0");
}

// ₪ leading, grouped, two decimals only when there are agorot
export const ils = a =>
  "₪" + (a / 100).toLocaleString("he-IL", {
    minimumFractionDigits: a % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  });

export const CATS = ["אוכל בחוץ","סופר","תחבורה","דיור","בריאות","ביגוד","בידור","אחר"];

// a budget you haven't touched is still information, so budgeted categories show at ₪0 too.
// spend desc; among equals, budgeted first.
export const catNames = (per, budget) =>
  [...new Set([...Object.keys(budget), ...Object.keys(per)])]
    .sort((a, b) => (per[b] || 0) - (per[a] || 0) || (budget[b] ? 1 : 0) - (budget[a] ? 1 : 0));

// The ledger's day boundary is Israel's, not the server's or the phone's.
export const todayIso = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

// The memory tab promises card numbers, passwords and ID numbers are never stored.
// db.js enforces it server-side instead of trusting the model to comply.
// ponytail: heuristic (8+ digits anywhere, or a few keywords); a real PII classifier if facts get richer.
const SENSITIVE = /סיסמ|ת״ז|ת"ז|תעודת זהות|כרטיס אשראי|password|cvv/i;
export const isSensitive = s => SENSITIVE.test(s) || s.replace(/\D/g, "").length >= 8;
