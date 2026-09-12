import { saveEntries, deleteEntries } from "@/lib/db";

export async function POST(req) {
  try {
    const { items } = await req.json();
    if (!Array.isArray(items) || !items.length) {
      return Response.json({ error: "no items" }, { status: 400 });
    }
    return Response.json({ saved: await saveEntries(items) });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 400 });
  }
}

// undo
export async function DELETE(req) {
  try {
    const { refs } = await req.json();
    await deleteEntries(Array.isArray(refs) ? refs : []);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 400 });
  }
}
