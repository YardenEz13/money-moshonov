import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { auth } from "@clerk/nextjs/server";
import { CATS, isSensitive } from "./format.js";

// Service role bypasses RLS, so it must never reach the browser. Every query below is
// scoped by user id — that scoping is the access control, which is why all DB access
// funnels through this one module instead of being sprinkled across routes.
function admin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: retryingFetch },
  });
}

// Supabase's gateway 504s on the first requests after the free-tier project idles, and a
// personal ledger idles most of the day — the cold path is the common path.
// Retrying every method is safe only because writes are idempotent: inserts carry ids we
// generate (saveEntries), everything else is an upsert, update or delete.
// Each try is capped at 8s: an unanswered request used to hang until Vercel killed the
// whole function at 60s, before any catch or log could run.
// ponytail: 3 tries with fixed backoff; revisit if a paid tier removes cold starts.
async function retryingFetch(url, init = {}) {
  for (let i = 0; ; i++) {
    try {
      const signal = AbortSignal.any([init.signal, AbortSignal.timeout(8000)].filter(Boolean));
      const res = await fetch(url, { ...init, signal });
      if (![502, 503, 504].includes(res.status) || i === 2) return res;
    } catch (e) {
      if (i === 2) throw e;
    }
    await new Promise(r => setTimeout(r, 500 * (i + 1)));
  }
}

// Callers either pass a user id they already authenticated (the Shortcut token route)
// or get the Clerk session user. Never a client-supplied id.
async function me(userId) {
  if (userId) return userId;
  const { userId: id } = await auth();
  if (!id) throw new Error("unauthenticated");
  return id;
}

const must = r => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

export async function loadAll() {
  const userId = await me();
  const sb = admin();
  const [tx, tasks, jots, mems, budgets] = (await Promise.all([
    sb.from("transactions").select("*").eq("user_id", userId).order("d", { ascending: false }),
    sb.from("tasks").select("*").eq("user_id", userId).order("d", { ascending: false }),
    sb.from("jots").select("*").eq("user_id", userId).order("d", { ascending: false }),
    sb.from("memories").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    sb.from("budgets").select("*").eq("user_id", userId),
  ])).map(must);

  return {
    tx: tx.map(r => ({
      id: r.id, d: r.d, m: r.merchant, note: r.note, a: r.amount, k: r.kind, c: r.category,
      src: r.source, r: r.recurring,
    })),
    tasks: tasks.map(r => ({ id: r.id, t: r.title, d: r.d, done: r.done })),
    jots: jots.map(r => ({ id: r.id, d: r.d, b: r.body })),
    mems: mems.map(r => ({ id: r.id, c: r.content, s: r.source, k: r.kind })),
    budget: Object.fromEntries(budgets.map(r => [r.category, r.amount])),
  };
}

// items come from the confirm sheet (or straight from the model, for the Shortcut).
// user_id is stamped here, never accepted from the client.
export async function saveEntries(items, facts = [], source = "הקלטה", uid) {
  const userId = await me(uid);
  const sb = admin();
  const rows = { transactions: [], tasks: [], jots: [] };

  for (const it of items) {
    // id generated here, not by Postgres, so a retried insert after a gateway timeout
    // lands on the same row instead of writing the expense twice
    const id = randomUUID();
    if (it.type === "task") {
      if (it.title?.trim()) rows.tasks.push({ id, user_id: userId, title: it.title.trim(), d: it.date });
    } else if (it.type === "journal") {
      if (it.body?.trim()) rows.jots.push({ id, user_id: userId, body: it.body.trim(), d: it.date });
    } else {
      rows.transactions.push({
        id, user_id: userId, d: it.date, merchant: it.merchant?.trim() || "—", note: it.note?.trim() || null,
        amount: Math.max(0, Math.round(Number(it.amount) || 0)),
        kind: it.type === "income" ? "in" : "out",
        category: CATS.includes(it.category) ? it.category : "אחר",
      });
    }
  }

  const saved = [];
  for (const [table, data] of Object.entries(rows)) {
    if (!data.length) continue;
    must(await sb.from(table).upsert(data, { onConflict: "id", ignoreDuplicates: true }));
    saved.push(...data.map(r => ({ table, id: r.id })));
  }

  // inferred facts wait for approval: kind=pending is withheld from the model
  const mems = [...new Set(facts.map(f => String(f).trim()).filter(f => f && f.length <= 200 && !isSensitive(f)))]
    .map(content => ({ user_id: userId, content, source, kind: "pending" }));
  if (mems.length) {
    must(await sb.from("memories").upsert(mems, { onConflict: "user_id,content", ignoreDuplicates: true }));
  }
  return saved;
}

// undo: only ever deletes rows belonging to the calling user
export async function deleteEntries(refs) {
  const userId = await me();
  const sb = admin();
  for (const { table, id } of refs) {
    if (!["transactions", "tasks", "jots"].includes(table)) continue;
    must(await sb.from(table).delete().eq("user_id", userId).eq("id", id));
  }
}

export async function setTaskDone(id, done) {
  const userId = await me();
  must(await admin().from("tasks").update({ done: !!done }).eq("user_id", userId).eq("id", id));
}

export async function deleteMemory(id) {
  const userId = await me();
  must(await admin().from("memories").delete().eq("user_id", userId).eq("id", id));
}

// the only allowed transition: a pending inference becomes an approved one
export async function approveMemory(id) {
  const userId = await me();
  must(await admin().from("memories").update({ kind: "inferred" })
    .eq("user_id", userId).eq("id", id).eq("kind", "pending"));
}

// 0 or empty clears the budget: "no budget" is a missing row, not a ₪0 cap
export async function setBudget(category, amount) {
  const userId = await me();
  if (!CATS.includes(category)) throw new Error("unknown category");
  const sb = admin();
  const a = Math.round(Number(amount) || 0);
  if (a <= 0) must(await sb.from("budgets").delete().eq("user_id", userId).eq("category", category));
  else must(await sb.from("budgets").upsert({ user_id: userId, category, amount: a }));
}

// Facts the model inferred are withheld until the user approves them.
export async function memoriesForPrompt(uid) {
  const userId = await me(uid);
  const data = must(await admin().from("memories").select("content,kind").eq("user_id", userId));
  return data.filter(m => m.kind !== "pending").map(m => m.content);
}

/* ---- iPhone Shortcut tokens ---- */

const sha256 = s => createHash("sha256").update(s).digest("hex");

// returns the raw token once; only its hash is kept, so it cannot be shown again
export async function rotateShortcutToken() {
  const userId = await me();
  const raw = randomBytes(32).toString("base64url");
  // one statement keyed on user_id: replaces the old token atomically and is safe to retry
  must(await admin().from("shortcut_tokens").upsert(
    { token_hash: sha256(raw), user_id: userId, created_at: new Date().toISOString() },
    { onConflict: "user_id" }
  ));
  return raw;
}

export async function hasShortcutToken() {
  const userId = await me();
  const data = must(await admin().from("shortcut_tokens").select("created_at").eq("user_id", userId));
  return data[0]?.created_at || null;
}

export async function userIdForToken(raw) {
  if (!raw || raw.length < 20) return null;
  const data = must(await admin().from("shortcut_tokens").select("user_id").eq("token_hash", sha256(raw)));
  return data[0]?.user_id || null;
}

/* ---- diagnostics ---- */

// Logging must never break the request it describes, so this swallows its own failures.
// ponytail: no retention yet; add a scheduled delete of old rows if the table grows.
export async function logEvent({ userId = null, source, status = null, ms = null, message = null, detail = {} }) {
  try {
    await admin().from("logs").insert({
      user_id: userId, source, status, ms,
      message: message ? String(message).slice(0, 500) : null,
      detail,
    });
  } catch (e) {
    console.error("[logEvent]", e);
  }
}

// client-side errors, tied to the signed-in user
export async function logClient(message, detail) {
  const userId = await me();
  await logEvent({ userId, source: "client", message, detail });
}

export async function recentShortcutCalls(limit = 5) {
  const userId = await me();
  return must(await admin().from("logs").select("at,status,ms,message,detail")
    .eq("user_id", userId).eq("source", "shortcut").order("at", { ascending: false }).limit(limit));
}

/* ---- statement import ---- */

// rows arrive reviewed from the import screen. ext_ref is the sha256 of the statement line's
// fingerprint, so importing an overlapping statement again adds nothing (unique user_id+ext_ref).
export async function saveImport(rows, batchId) {
  const userId = await me();
  if (!/^[0-9a-f-]{36}$/i.test(String(batchId))) throw new Error("bad batch id");
  const data = rows
    .filter(r => (r.kind === "in" || r.kind === "out") && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.amount > 0 && r.fp)
    .map(r => ({
      id: randomUUID(),
      user_id: userId,
      d: r.date,
      merchant: String(r.merchant || "—").slice(0, 80),
      note: r.raw ? String(r.raw).slice(0, 160) : null,
      amount: Math.round(r.amount),
      kind: r.kind,
      category: CATS.includes(r.category) ? r.category : "אחר",
      source: "import",
      batch_id: batchId,
      ext_ref: sha256(String(r.fp)),
      recurring: !!r.recurring,
    }));
  if (!data.length) return { inserted: 0, sent: 0 };
  const out = must(await admin().from("transactions")
    .upsert(data, { onConflict: "user_id,ext_ref", ignoreDuplicates: true }).select("id"));
  // ponytail: a retry after a committed-but-timed-out write reports those rows as already present
  return { inserted: out.length, sent: data.length };
}

export async function undoImport(batchId) {
  const userId = await me();
  must(await admin().from("transactions").delete().eq("user_id", userId).eq("batch_id", batchId));
}
