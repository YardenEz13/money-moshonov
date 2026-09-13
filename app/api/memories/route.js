import { deleteMemory, approveMemory } from "@/lib/db";

const fail = e => Response.json({ error: String(e?.message || e) }, { status: 400 });

export async function DELETE(req) {
  try {
    const { id } = await req.json();
    await deleteMemory(id);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

// approve a pending inference so it starts reaching the model
export async function PATCH(req) {
  try {
    const { id } = await req.json();
    await approveMemory(id);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
