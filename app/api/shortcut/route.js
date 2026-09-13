import { userIdForToken, saveEntries, memoriesForPrompt } from "@/lib/db";
import { parseText } from "@/lib/gemini";
import { ils, todayIso } from "@/lib/format";

// retries + model fallback can outlast the default function timeout
export const maxDuration = 60;

// iPhone Shortcut: Dictate Text → Get Contents of URL (POST, Bearer token) → Show Result.
// No confirm sheet, so the reply says exactly what was written and flags anything shaky.
// Auth is the token, not a Clerk session — this path is public in proxy.js.

const say = (text, status = 200) =>
  new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

function summary(items) {
  return items.map(it => {
    if (it.type === "task") return `משימה: ${it.title}`;
    if (it.type === "journal") return "ביומן";
    const sign = it.type === "income" ? "+" : "";
    return `${it.merchant || "—"} ${sign}${ils(it.amount || 0)}${it.category ? ` (${it.category})` : ""}`;
  }).join(" · ");
}

export async function POST(req) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  let userId;
  try {
    userId = await userIdForToken(token);
  } catch {
    return say("שגיאת שרת", 500);
  }
  if (!userId) return say("טוקן לא תקין. צור חדש באפליקציה, בלשונית זיכרון.", 401);

  // Shortcuts can send either a JSON body or plain text; accept both
  const raw = await req.text();
  let text = raw;
  try { text = JSON.parse(raw).text ?? raw; } catch { /* plain text */ }
  text = String(text || "").trim().slice(0, 2000);
  if (!text) return say("לא שמעתי כלום", 400);

  try {
    const today = todayIso();
    const out = await parseText(text, today, await memoriesForPrompt(userId));
    const items = out.items.filter(it => it.type === "task" ? it.title : it.type === "journal" ? it.body : it.amount > 0);
    if (!items.length) return say(`לא הבנתי מה לרשום מ: ״${text}״`, 400);

    await saveEntries(items, out.facts, "קיצור דרך", userId);

    const shaky = items.some(it => it.type !== "task" && it.type !== "journal" &&
      (it.conf.amount < 0.8 || it.conf.category < 0.8 || !it.category));
    return say(`נרשם: ${summary(items)}${shaky ? "\nכדאי לבדוק באפליקציה" : ""}`);
  } catch (e) {
    return say(`לא נרשם: ${String(e?.message || e).slice(0, 200)}`, 500);
  }
}
