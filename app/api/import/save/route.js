import { saveImport } from "@/lib/db";

export async function POST(req) {
  try {
    const { batchId, rows } = await req.json();
    if (!Array.isArray(rows)) return Response.json({ error: "no rows" }, { status: 400 });
    const r = await saveImport(rows, batchId);
    const dupes = r.sent - r.inserted;
    return Response.json({ ...r, debug: `שמירת ייבוא · ${r.inserted} חדשות${dupes ? ` · ${dupes} כבר היו` : ""}` });
  } catch (e) {
    console.error("[import/save]", e);
    return Response.json({ error: String(e?.message || e) }, { status: 400 });
  }
}
