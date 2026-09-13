import { saveImport } from "@/lib/db";

export async function POST(req) {
  try {
    const { batchId, rows } = await req.json();
    if (!Array.isArray(rows)) return Response.json({ error: "no rows" }, { status: 400 });
    return Response.json(await saveImport(rows, batchId));
  } catch (e) {
    console.error("[import/save]", e);
    return Response.json({ error: String(e?.message || e) }, { status: 400 });
  }
}
