import { setTaskDone } from "@/lib/db";

export async function PATCH(req) {
  try {
    const { id, done } = await req.json();
    await setTaskDone(id, done);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 400 });
  }
}
