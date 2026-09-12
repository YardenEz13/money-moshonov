import { deleteMemory } from "@/lib/db";

export async function DELETE(req) {
  try {
    const { id } = await req.json();
    await deleteMemory(id);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 400 });
  }
}
