import { CATS } from "./format.js";

// Model moves fast — override with GEMINI_MODEL rather than editing code.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
// 3.8-flash sheds load with 503s under demand; the Shortcut has no retry button, so we retry here
const FALLBACK = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";
const RETRYABLE = new Set([429, 500, 503]);
// ponytail: fixed schedule, no jitter; exponential backoff if call volume ever grows
const ATTEMPTS = [[MODEL, 0], [MODEL, 700], [FALLBACK, 0], [FALLBACK, 1500]];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ENDPOINT = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

const SCHEMA = {
  type: "object",
  properties: {
    transcript: { type: "string" },
    facts: { type: "array", items: { type: "string" } },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["expense", "income", "task", "journal"] },
          amount: { type: "integer" },              // agorot, never a float
          merchant: { type: "string" },
          category: { type: "string", enum: CATS },
          note: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          confAmount: { type: "number" },
          confMerchant: { type: "number" },
          confCategory: { type: "number" },
        },
        required: ["type"],
      },
    },
  },
  required: ["items"],
};

function instructions(today, memories) {
  return [
    "אתה רושם בפנקס הוצאות בעברית. המר את מה שנאמר לרשומות מובנות.",
    "כללים:",
    "- סכומים ב*אגורות* כמספר שלם: ₪32.50 → 3250. בלי נקודה עשרונית.",
    "- משפט אחד יכול להכיל כמה רשומות. פצל אותן.",
    "- בלי סכום ויש כוונת מטלה (צריך/תזכיר/להזמין/תור) → type=task.",
    "- בלי סכום ובלי מטלה, ויש תוכן של ממש → type=journal.",
    "- רעש, היסוס או מילות מילוי בלבד (\"אממ\", \"רגע\", \"בדיקה\") → items ריק. אל תמציא רישום.",
    "- קיבלתי/משכורת/החזר → income. אחרת expense.",
    `- קטגוריה מתוך: ${CATS.join(", ")}. אם לא ברור: "אחר" עם confCategory נמוך.`,
    "- merchant: שם העסק, ואם אין עסק — מהות ההוצאה (\"דלק\", \"מונית\"). לעולם לא ריק כשיש סכום.",
    "- אמצעי תשלום (\"בכרטיס\", \"במזומן\") ומספרים שלו אינם עסק, אינם הערה ואינם נשמרים.",
    "דוגמאות:",
    "\"קפה ומאפה בארומה 32.50\" → expense, merchant ארומה, note קפה ומאפה, אוכל בחוץ, 3250",
    "\"דלק 300 בכרטיס\" → expense, merchant דלק, תחבורה, 30000",
    "\"קיבלתי משכורת 9200\" → income, merchant משכורת, אחר, 920000",
    "\"צריך להזמין תור לרופא\" → task, title להזמין תור לרופא",
    `- תאריך היום: ${today}. "אתמול" וכו' יחסית אליו.`,
    "- confAmount/confMerchant/confCategory: ביטחון 0–1. תחת 0.8 מסומן למשתמש לבדיקה. אל תנפח.",
    "- note: פירוט קצר שנאמר מעבר לעסק (\"קפה ומאפה\", \"נעליים\"). אם אין, השאר ריק.",
    "- facts: עובדות יציבות על המשתמש שעולות מהדברים (מקום מגורים, הרגל קבוע, תזונה). לא עסקאות ולא אירועים חד-פעמיים.",
    "  משפט קצר בגוף שלישי. בדרך כלל מערך ריק. לעולם לא מספרי כרטיס, תעודת זהות, סיסמאות או טלפונים.",
    memories.length ? `מה שידוע על המשתמש: ${memories.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

async function call(parts, today, memories) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: instructions(today, memories) }] },
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
  });

  let res;
  for (const [model, wait] of ATTEMPTS) {
    if (wait) await sleep(wait);
    res = await fetch(ENDPOINT(model), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body,
    });
    if (res.ok || !RETRYABLE.has(res.status)) break;
  }

  // the message lands on a phone screen via the Shortcut — keep it human, not a JSON dump
  if (!res.ok) {
    if (RETRYABLE.has(res.status)) throw new Error("Gemini עמוס כרגע. נסה שוב בעוד רגע.");
    const detail = await res.json().then(j => j?.error?.message).catch(() => "");
    throw new Error(`Gemini ${res.status}${detail ? ": " + detail.slice(0, 120) : ""}`);
  }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ?? "";
  let out;
  try { out = JSON.parse(text); }
  catch { throw new Error("gemini returned non-JSON despite responseSchema"); }

  // normalise into the shape the confirm sheet already speaks
  const items = (out.items || []).map(it => ({
    type: it.type,
    amount: Number.isFinite(it.amount) ? it.amount : null,
    merchant: it.merchant || "",
    category: it.category || "",
    note: it.note || "",
    title: it.title || "",
    body: it.body || "",
    date: today,
    conf: { amount: it.confAmount ?? 0.9, merchant: it.confMerchant ?? 0.6, category: it.confCategory ?? 0.4 },
  }));
  const facts = Array.isArray(out.facts) ? out.facts.filter(f => typeof f === "string") : [];
  return { items, facts, transcript: out.transcript || "" };
}

export const parseText = (text, today, memories = []) =>
  call([{ text }], today, memories);

// one call does transcription and extraction together — no separate STT hop
export const parseAudio = (base64, mimeType, today, memories = []) =>
  call(
    [{ inline_data: { mime_type: mimeType, data: base64 } },
     { text: "תמלל את ההקלטה לשדה transcript, וחלץ ממנה את הרשומות." }],
    today, memories
  );
