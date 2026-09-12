import { createClient } from "@supabase/supabase-js";
import { auth } from "@clerk/nextjs/server";

// Service role bypasses RLS, so it must never reach the browser. Every query below is
// scoped by the Clerk user id — that scoping is the access control, which is why all DB
// access funnels through this one module instead of being sprinkled across routes.
function admin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function me() {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthenticated");
  return userId;
}

export async function loadAll() {
  const userId = await me();
  const sb = admin();
  const [tx, tasks, jots, mems, budgets] = await Promise.all([
    sb.from("transactions").select("*").eq("user_id", userId).order("d", { ascending: false }),
    sb.from("tasks").select("*").eq("user_id", userId).order("d", { ascending: false }),
    sb.from("jots").select("*").eq("user_id", userId).order("d", { ascending: false }),
    sb.from("memories").select("*").eq("user_id", userId),
    sb.from("budgets").select("*").eq("user_id", userId),
  ]);
  const err = [tx, tasks, jots, mems, budgets].find(r => r.error);
  if (err) throw new Error(err.error.message);

  return {
    tx: tx.data.map(r => ({ id: r.id, d: r.d, m: r.merchant, note: r.note, a: r.amount, k: r.kind, c: r.category })),
    tasks: tasks.data.map(r => ({ id: r.id, t: r.title, d: r.d, done: r.done })),
    jots: jots.data.map(r => ({ id: r.id, d: r.d, b: r.body })),
    mems: mems.data.map(r => ({ id: r.id, c: r.content, s: r.source, k: r.kind })),
    budget: Object.fromEntries(budgets.data.map(r => [r.category, r.amount])),
  };
}

// items come from the confirm sheet — already reviewed by the user, so they are trusted
// shape-wise, but the user_id is stamped here rather than accepted from the client.
export async function saveEntries(items) {
  const userId = await me();
  const sb = admin();
  const rows = { transactions: [], tasks: [], jots: [] };

  for (const it of items) {
    if (it.type === "task") rows.tasks.push({ user_id: userId, title: it.title, d: it.date });
    else if (it.type === "journal") rows.jots.push({ user_id: userId, body: it.body, d: it.date });
    else rows.transactions.push({
      user_id: userId, d: it.date, merchant: it.merchant || "—", note: it.note || null,
      amount: Math.max(0, Math.round(it.amount)), kind: it.type === "income" ? "in" : "out",
      category: it.category || "אחר",
    });
  }

  const saved = [];
  for (const [table, data] of Object.entries(rows)) {
    if (!data.length) continue;
    const { data: out, error } = await sb.from(table).insert(data).select("id");
    if (error) throw new Error(`${table}: ${error.message}`);
    saved.push(...out.map(r => ({ table, id: r.id })));
  }
  return saved;
}

// undo: only ever deletes rows belonging to the calling user
export async function deleteEntries(refs) {
  const userId = await me();
  const sb = admin();
  for (const { table, id } of refs) {
    if (!["transactions", "tasks", "jots"].includes(table)) continue;
    await sb.from(table).delete().eq("user_id", userId).eq("id", id);
  }
}

export async function deleteMemory(id) {
  const userId = await me();
  await admin().from("memories").delete().eq("user_id", userId).eq("id", id);
}

export async function setBudget(category, amount) {
  const userId = await me();
  await admin().from("budgets").upsert({ user_id: userId, category, amount });
}

// Facts the model inferred are withheld until the user approves them.
export async function memoriesForPrompt() {
  const userId = await me();
  const { data } = await admin().from("memories").select("content,kind").eq("user_id", userId);
  return (data || []).filter(m => m.kind !== "pending").map(m => m.content);
}
