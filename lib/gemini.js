import { CATS } from "./format.js";

// Model moves fast — override with GEMINI_MODEL rather than editing code.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const ENDPOINT = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

const SCHEMA = {
  type: "object",
  properties: {
    transcript: { type: "string" },
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
    "- בלי סכום ובלי מטלה → type=journal.",
    "- קיבלתי/משכורת/החזר → income. אחרת expense.",
    `- קטגוריה מתוך: ${CATS.join(", ")}. אם לא ברור, השאר ריק.`,
    `- תאריך היום: ${today}. "אתמול" וכו' יחסית אליו.`,
    "- confAmount/confMerchant/confCategory: ביטחון 0–1. תחת 0.8 מסומן למשתמש לבדיקה. אל תנפח.",
    memories.length ? `מה שידוע על המשתמש: ${memories.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

async function call(parts, today, memories) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");

  const res = await fetch(ENDPOINT(MODEL), {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instructions(today, memories) }] },
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
    }),
  });

  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
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
  return { items, transcript: out.transcript || "" };
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
