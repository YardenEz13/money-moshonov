import { userIdForToken, saveEntries, memoriesForPrompt, logEvent } from "@/lib/db";
import { parseText, parseAudio } from "@/lib/gemini";
import { ils, todayIso } from "@/lib/format";

// retries + model fallback can outlast the default function timeout
export const maxDuration = 60;

// iPhone Shortcut. Two ways in:
//   Dictate Text → Get Contents of URL, body JSON {text} or plain text
//   Record Audio → Get Contents of URL, body File (raw) or Form with a file field —
//     this one skips iOS dictation entirely and lets Gemini transcribe
// No confirm sheet, so the reply says exactly what was written and flags anything shaky.
// Auth is the bearer token, not a Clerk session — this path is public in proxy.js.
// Every call is logged with its request shape, so "nothing happened" is diagnosable.

const MAX_AUDIO_BYTES = 3_000_000;

function summary(items) {
  return items.map(it => {
    if (it.type === "task") return `משימה: ${it.title}`;
    if (it.type === "journal") return "ביומן";
    const sign = it.type === "income" ? "+" : "";
    return `${it.merchant || "—"} ${sign}${ils(it.amount || 0)}${it.category ? ` (${it.category})` : ""}`;
  }).join(" · ");
}

// Pull text or audio out of whatever body shape the Shortcut was configured to send.
async function readInput(req, ct) {
  if (ct.startsWith("multipart/form-data")) {
    const fd = await req.formData();
    const file = [...fd.values()].find(v => typeof v === "object" && v && "arrayBuffer" in v);
    if (file) return { audio: Buffer.from(await file.arrayBuffer()), mime: file.type || "audio/m4a" };
    return { text: String(fd.get("text") || "") };
  }
  if (ct.startsWith("audio/") || ct.startsWith("video/") || ct === "application/octet-stream") {
    // Shortcuts may label an .m4a as octet-stream; m4a is what Record Audio produces
    const mime = ct.startsWith("audio/") ? ct : "audio/m4a";
    return { audio: Buffer.from(await req.arrayBuffer()), mime };
  }
  const raw = await req.text();
  try { return { text: String(JSON.parse(raw).text ?? "") }; }
  catch { return { text: raw }; }
}

export async function POST(req) {
  const t0 = Date.now();
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  // request shape only — never the token itself
  const detail = {
    contentType: ct || null,
    auth: !authHeader ? "missing" : /^Bearer\s+\S/i.test(authHeader) ? "bearer" : "malformed",
    tokenLength: token.length,
    userAgent: (req.headers.get("user-agent") || "").slice(0, 120),
  };
  let userId = null;
  let stage = "token";

  const reply = async (text, status, extra = {}) => {
    await logEvent({ userId, source: "shortcut", status, ms: Date.now() - t0, message: text, detail: { ...detail, stage, ...extra } });
    return new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
  };

  try {
    userId = await userIdForToken(token);
  } catch (e) {
    console.error("[shortcut] token lookup", e);
    return reply("שגיאת שרת", 500, { error: String(e?.message || e) });
  }
  if (!userId) {
    return reply(
      detail.auth === "missing"
        ? "חסרה כותרת Authorization בקיצור. הוסף: Bearer ואחריו הטוקן."
        : "טוקן לא תקין. צור חדש באפליקציה, בלשונית זיכרון.",
      401
    );
  }

  let input = {};
  try {
    stage = "read";
    input = await readInput(req, ct);
    const today = todayIso();
    const memories = await memoriesForPrompt(userId);

    stage = "parse";
    let out;
    if (input.audio) {
      if (!input.audio.length) return reply("ההקלטה ריקה", 400, { input: "audio", bytes: 0 });
      if (input.audio.length > MAX_AUDIO_BYTES) {
        return reply("ההקלטה ארוכה מדי. נסה משפט קצר יותר.", 413, { input: "audio", bytes: input.audio.length });
      }
      out = await parseAudio(input.audio.toString("base64"), input.mime, today, memories);
    } else {
      const text = (input.text || "").trim().slice(0, 2000);
      if (!text) {
        return reply("לא שמעתי כלום — הגוף ריק. בדוק שהמפתח text מחובר ל־Dictated Text.", 400, { input: "text", chars: 0 });
      }
      input.text = text;
      out = await parseText(text, today, memories);
    }

    const heard = input.audio ? out.transcript : input.text;
    const logged = {
      input: input.audio ? "audio" : "text",
      bytes: input.audio?.length,
      mime: input.mime,
      heard: (heard || "").slice(0, 200),
      gemini: out.meta,
    };

    const items = out.items.filter(it => it.type === "task" ? it.title : it.type === "journal" ? it.body : it.amount > 0);
    if (!items.length) return reply(`לא הבנתי מה לרשום מ: ״${heard || "?"}״`, 400, logged);

    stage = "save";
    await saveEntries(items, out.facts, "קיצור דרך", userId);

    const shaky = items.some(it => it.type !== "task" && it.type !== "journal" &&
      (it.conf.amount < 0.8 || it.conf.category < 0.8 || !it.category));
    return reply(`נרשם: ${summary(items)}${shaky ? "\nכדאי לבדוק באפליקציה" : ""}`, 200, { ...logged, items: items.length });
  } catch (e) {
    console.error("[shortcut]", stage, e);
    return reply(`לא נרשם: ${String(e?.message || e).slice(0, 200)}`, 500, {
      input: input.audio ? "audio" : "text",
      bytes: input.audio?.length,
      mime: input.mime,
      error: String(e?.message || e).slice(0, 300),
      gemini: e?.tries ? { tries: e.tries } : undefined,
    });
  }
}
