import { auth } from "@clerk/nextjs/server";
import { importChunk } from "@/lib/gemini";
import { logEvent, undoImport } from "@/lib/db";

// one chunk per request: a year of statements is split in the browser so each call fits in 60s
export const maxDuration = 60;

export async function POST(req) {
  const t0 = Date.now();
  const { userId } = await auth();
  let detail = {};
  try {
    const { text, context, pdf, cardsToo, knownMerchants } = await req.json();
    detail = pdf ? { input: "pdf", bytes: Math.round((pdf.length * 3) / 4) } : { input: "text", chars: String(text || "").length };
    const { rows, meta } = await importChunk({
      text: String(text || "").slice(0, 60_000),
      context: context ? String(context).slice(0, 2000) : "",
      pdf: pdf || null,
      cardsToo: cardsToo !== false,
      knownMerchants: Array.isArray(knownMerchants) ? knownMerchants.map(String) : [],
    });
    await logEvent({ userId, source: "import", status: 200, ms: Date.now() - t0, message: `${rows.length} rows`, detail: { ...detail, gemini: meta } });
    return Response.json({ rows, model: meta.model });
  } catch (e) {
    console.error("[import]", e);
    await logEvent({
      userId, source: "import", status: 400, ms: Date.now() - t0, message: String(e?.message || e),
      detail: { ...detail, gemini: e?.tries ? { tries: e.tries } : undefined },
    });
    // tooBig tells the browser to split this chunk and retry the halves
    return Response.json({ error: String(e?.message || e), tooBig: !!e?.tooBig }, { status: 400 });
  }
}

// undo a whole import run
export async function DELETE(req) {
  try {
    const { batchId } = await req.json();
    await undoImport(batchId);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 400 });
  }
}
