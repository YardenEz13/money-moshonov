import { CATS } from "./format.js";

// Two tiers. Everyday capture runs on the lite pool; when it judges the input beyond a simple
// entry it says so (escalate) and the server reruns it on the heavy pool. Statement import is
// heavy by definition and goes straight there — asking lite first would only add a call.
//
// Each pool is load-balanced: quotas are counted per model, so rotating calls across every
// flash model multiplies how much we can send before anything answers 429.
// Override with comma-separated env lists instead of editing code — model names move fast.
const list = (env, fallback) => (env ? env.split(",").map(m => m.trim()).filter(Boolean) : fallback);
export const HEAVY_POOL = list(process.env.GEMINI_HEAVY_MODELS,
  ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash-preview"]);
export const LITE_POOL = list(process.env.GEMINI_LITE_MODELS, ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);

// An escalation only makes sense on a heavy model, so it never overflows into lite.
const TIERS = {
  lite: [LITE_POOL, HEAVY_POOL],
  heavy: [HEAVY_POOL, LITE_POOL],
  escalate: [HEAVY_POOL],
};

// Models that just refused are benched until this timestamp, so the next call goes elsewhere.
// ponytail: per warm serverless instance, lost on cold start; move to the DB if that proves too forgetful.
const benchedUntil = new Map();
const cursor = { lite: 0, heavy: 0, escalate: 0 };
export const bench = (model, ms) => benchedUntil.set(model, Math.max(benchedUntil.get(model) || 0, Date.now() + ms));

// Next call starts one model further along each pool; benched models go to the back, and if
// every model is benched the one that frees up soonest is still tried rather than failing outright.
export function candidates(tier) {
  const turn = cursor[tier]++;
  const order = [...new Set(TIERS[tier].flatMap((pool, i) =>
    i === 0 ? pool.map((_, k) => pool[(k + turn) % pool.length]) : pool))];
  const now = Date.now();
  const free = order.filter(m => (benchedUntil.get(m) || 0) <= now);
  return free.length ? free : [...order].sort((a, b) => benchedUntil.get(a) - benchedUntil.get(b)).slice(0, 1);
}

// Google's 429 body may carry RetryInfo {retryDelay: "37s"}; use it when it's there.
function retryDelayMs(errJson) {
  const d = (errJson?.error?.details || []).find(x => x.retryDelay)?.retryDelay;
  const s = d && parseFloat(d);
  return Number.isFinite(s) ? Math.min(s * 1000, 10 * 60_000) : 60_000;
}

const RETRYABLE = new Set([429, 500, 503]);
// Routes get 60s. Gemini gets at most 45 of them, so a stalled call ends as an error we can
// log and show, instead of Vercel killing the function mid-flight with nothing recorded.
const BUDGET_MS = 45_000;
const ATTEMPT_MS = 25_000;

// iPhone Safari's MediaRecorder labels its AAC recordings audio/mp4, and Shortcuts' Record
// Audio sends audio/x-m4a. Gemini's supported list has audio/m4a but not either of those.
const AUDIO_MIME = { "audio/mp4": "audio/m4a", "audio/x-m4a": "audio/m4a", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav" };
export const geminiMime = m => {
  const base = String(m || "").split(";")[0].trim().toLowerCase();
  return AUDIO_MIME[base] || base;
};
const ENDPOINT = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

const fail = (message, extra) => Object.assign(new Error(message), extra);

async function generate({ system, parts, schema, tier, budgetMs = BUDGET_MS, maxOutputTokens }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    // No temperature override: Google says Gemini 3 models should stay at the default 1.0, and
    // lower values loop. At 0 the lite model repeated items and hung 25s on a currency sum.
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
    },
  });

  const t0 = Date.now();
  const tries = [];
  let res, model, lastError;
  // every model is tried at most once per call: another model beats retrying one that just refused
  for (const m of candidates(tier)) {
    const left = budgetMs - (Date.now() - t0);
    if (left < 3000) break;
    model = m;
    const t = Date.now();
    try {
      res = await fetch(ENDPOINT(m), {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body,
        signal: AbortSignal.timeout(Math.min(ATTEMPT_MS, left)),
      });
      tries.push({ model: m, status: res.status, ms: Date.now() - t });
      if (res.ok) break;
      const errJson = await res.json().catch(() => null);
      lastError = errJson?.error?.message || "";
      if (res.status === 429) bench(m, retryDelayMs(errJson));
      else if (res.status === 404 || /not found|not supported/i.test(lastError)) bench(m, 60 * 60_000); // wrong/retired id
      else if (RETRYABLE.has(res.status)) bench(m, 15_000);
      else break; // a 400 about our request would fail on every model — stop and report it
    } catch (e) {
      res = undefined;
      bench(m, 30_000);
      tries.push({ model: m, status: e.name === "TimeoutError" ? "timeout" : "network", ms: Date.now() - t });
    }
  }

  // the message can land on a phone screen via the Shortcut — keep it human, not a JSON dump
  if (!res) throw fail("Gemini לא ענה בזמן. נסה שוב.", { tries });
  if (!res.ok) {
    if (RETRYABLE.has(res.status)) throw fail("כל מודלי Gemini עמוסים כרגע. נסה שוב בעוד דקה.", { tries });
    throw fail(`Gemini ${res.status}${lastError ? ": " + lastError.slice(0, 120) : ""}`, { tries });
  }

  const json = await res.json();
  const cand = json?.candidates?.[0];
  // output cut off mid-JSON: the caller can split the input and try again
  if (cand?.finishReason === "MAX_TOKENS") throw fail("החלק גדול מדי לעיבוד בבת אחת", { tries, tooBig: true });
  const text = cand?.content?.parts?.map(p => p.text).join("") ?? "";
  try {
    return { out: JSON.parse(text), meta: { model, tries, ms: Date.now() - t0 } };
  } catch {
    throw fail("gemini returned non-JSON despite responseSchema", { tries });
  }
}

/* ---------- everyday capture ---------- */

const CAPTURE_MAX_TOKENS = 8192;

const CAPTURE_SCHEMA = {
  type: "object",
  properties: {
    transcript: { type: "string" },
    facts: { type: "array", items: { type: "string" } },
    escalate: { type: "boolean" },
    escalateReason: { type: "string" },
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

function captureInstructions(today, memories) {
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
    "- escalate: true רק כשהקלט חורג מרישום יומיומי פשוט — יותר מ-8 תנועות, דף חשבון או טבלה שהודבקו,",
    "  בקשה לנתח/לסכם/לארגן, או חשבון מורכב (פיצול בין אנשים, החזר חלקי, מטבע זר, תשלומים).",
    "  escalateReason: משפט קצר למה. גם כשמסמנים, מלא items כמיטב יכולתך. ברירת מחדל false.",
    memories.length ? `מה שידוע על המשתמש: ${memories.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

// normalise into the shape the confirm sheet already speaks
function shapeCapture({ out, meta }, today, extra = {}) {
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
  return { items, facts, transcript: out.transcript || "", meta: { ...meta, ...extra } };
}

async function capture(parts, today, memories) {
  const system = captureInstructions(today, memories);
  // a spoken entry never needs thousands of tokens: the cap turns a runaway into a quick failure
  const lite = await generate({ system, parts, schema: CAPTURE_SCHEMA, tier: "lite", maxOutputTokens: CAPTURE_MAX_TOKENS });
  if (!lite.out.escalate) return shapeCapture(lite, today);

  // lite judged this beyond it: rerun on heavy, but keep lite's answer if heavy can't deliver
  const reason = lite.out.escalateReason || "escalated";
  try {
    const heavy = await generate({
      system, parts, schema: CAPTURE_SCHEMA, tier: "escalate", maxOutputTokens: CAPTURE_MAX_TOKENS,
      budgetMs: BUDGET_MS - lite.meta.ms,
    });
    return shapeCapture(heavy, today, { escalated: reason, liteTries: lite.meta.tries });
  } catch (e) {
    return shapeCapture(lite, today, { escalated: reason, heavyFailed: e.message, heavyTries: e.tries });
  }
}

export const parseText = (text, today, memories = []) =>
  capture([{ text }], today, memories);

// one call does transcription and extraction together — no separate STT hop
export const parseAudio = (base64, mimeType, today, memories = []) =>
  capture(
    [{ inline_data: { mime_type: geminiMime(mimeType), data: base64 } },
     { text: "תמלל את ההקלטה לשדה transcript, וחלץ ממנה את הרשומות." }],
    today, memories
  );

/* ---------- statement import ---------- */

const IMPORT_SCHEMA = {
  type: "object",
  properties: {
    docInfo: { type: "string" },
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "integer" },
          date: { type: "string" },
          merchant: { type: "string" },
          raw: { type: "string" },
          amount: { type: "integer" },
          kind: { type: "string", enum: ["out", "in", "skip"] },
          category: { type: "string", enum: CATS },
          skipReason: { type: "string" },
        },
        required: ["date", "amount", "kind"],
      },
    },
  },
  required: ["rows"],
};

function importInstructions({ cardsToo, knownMerchants }) {
  return [
    "אתה מארגן דפי חשבון בנק ופירוטי כרטיסי אשראי ישראליים לפנקס הוצאות.",
    "- כל תנועה אמיתית → שורה אחת. כותרות, סיכומים, יתרות ושורות ריקות → לא מחזירים בכלל.",
    "- line: המספר שמופיע לפני | בשורת הקלט שממנה התנועה. חובה כשהקלט ממוספר.",
    "- date: YYYY-MM-DD. בישראל תאריך נכתב יום/חודש/שנה. בכרטיס אשראי: תאריך העסקה, לא תאריך החיוב.",
    "  כשבשורה מופיעים רק יום וחודש, השנה נלקחת מתקופת המסמך (כולל מעבר דצמבר→ינואר).",
    "- מסמך PDF: קרא את כל הטבלאות בעמוד, כולל שורות שממשיכות מעמוד קודם. אל תסכם ואל תדלג.",
    "- docInfo: משפט קצר — סוג המסמך (דף בנק / פירוט כרטיס אשראי), הבנק או החברה, תקופת הדף והשנה.",
    "- amount: באגורות, מספר שלם, תמיד חיובי. kind: out לחיוב, in לזיכוי או הכנסה.",
    "- עסקה בתשלומים (\"תשלום 3 מתוך 12\"): הסכום של התשלום הזה בלבד.",
    "- merchant: שם קריא ועקבי, בעברית כשהעסק מוכר (\"SHUFERSAL DEAL 123\" → שופרסל). אותו עסק = אותו שם תמיד.",
    "- raw: תיאור התנועה כפי שמופיע במקור.",
    `- category מתוך: ${CATS.join(", ")}. חשמל/מים/ארנונה/גז/אינטרנט/סלולר → חשבונות. סטרימינג/תוכנה/חדר כושר → מנויים.`,
    "- kind=skip עם skipReason קצר כשהשורה אינה הוצאה או הכנסה אמיתית:",
    "  * העברה בין חשבונות של המשתמש עצמו, הפקדה לחיסכון או לפיקדון.",
    cardsToo
      ? "  * חיוב חודשי מרוכז של חברת אשראי בדף הבנק (ישראכרט, מקס, כאל, לאומי קארד, אמריקן אקספרס, דיינרס) — הפירוט שלו מיובא בנפרד, אחרת ייספר פעמיים."
      : "  * (חיובי חברות אשראי בדף הבנק נשארים הוצאה רגילה בקטגוריה אחר — המשתמש לא מייבא את הפירוט.)",
    "- זיכוי שמבטל חיוב (החזר מעסק) אינו skip: kind=in עם שם העסק.",
    knownMerchants.length ? `- שמות עסקים שכבר נקבעו — השתמש בהם כשזה אותו עסק: ${knownMerchants.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function importChunk({ text, pdf, context, cardsToo = true, knownMerchants = [], budgetMs }) {
  // a PDF page arrives alone; context is what page 1 said about the document, since later pages
  // of a statement often print dates without the year
  const parts = pdf
    ? [
        { inline_data: { mime_type: "application/pdf", data: pdf } },
        { text: (context ? `מידע מעמוד קודם של אותו מסמך: ${context}\n` : "") + "חלץ את כל התנועות בעמוד הזה." },
      ]
    : [{
        text: (context ? `שורות פתיחת הקובץ, להקשר בלבד — אל תחזיר מהן תנועות:\n${context}\n\n` : "") +
          `שורות לעיבוד:\n${text}`,
      }];

  const { out, meta } = await generate({
    system: importInstructions({ cardsToo, knownMerchants: knownMerchants.slice(0, 150) }),
    parts, schema: IMPORT_SCHEMA, tier: "heavy", budgetMs,
  });

  const rows = (out.rows || []).map(r => {
    const bad = !ISO.test(r.date || "") || !Number.isFinite(r.amount) || r.amount === 0;
    return {
      line: Number.isInteger(r.line) ? r.line : null,
      date: ISO.test(r.date || "") ? r.date : "",
      merchant: String(r.merchant || r.raw || "").trim().slice(0, 80),
      raw: String(r.raw || "").trim().slice(0, 160),
      amount: Math.abs(Math.round(Number(r.amount) || 0)),
      kind: bad ? "skip" : r.kind,
      category: CATS.includes(r.category) ? r.category : "אחר",
      skipReason: bad ? "תאריך או סכום לא מזוהים" : r.kind === "skip" ? String(r.skipReason || "") : "",
    };
  });
  return { rows, docInfo: String(out.docInfo || "").slice(0, 300), meta };
}
