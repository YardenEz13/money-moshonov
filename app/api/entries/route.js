import { saveEntries, deleteEntries } from "@/lib/db";

const fail = (e, status = 400) => Response.json({ error: String(e?.message || e) }, { status });

export async function POST(req) {
  try {
    const { items, facts } = await req.json();
    if (!Array.isArray(items) || !items.length) return fail("no items");
    return Response.json({ saved: await saveEntries(items, Array.isArray(facts) ? facts : []) });
  } catch (e) {
    return fail(e);
  }
}

// undo
export async function DELETE(req) {
  try {
    const { refs } = await req.json();
    await deleteEntries(Array.isArray(refs) ? refs : []);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
