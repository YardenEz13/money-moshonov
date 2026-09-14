import { auth } from "@clerk/nextjs/server";
import { importChunk } from "@/lib/gemini";
import { logEvent, undoImport } from "@/lib/db";
import { triesText, secs } from "@/lib/format";

// one chunk per request: a year of statements is split in the browser so each call fits in 60s
export const maxDuration = 60;

export async function POST(req) {
  const t0 = Date.now();
  const { userId } = await auth();
  let detail = {};
  try {
    const { text, context, pdf, page, cardsToo, knownMerchants } = await req.json();
    detail = pdf
      ? { input: "pdf", page, bytes: Math.round((pdf.length * 3) / 4) }
      : { input: "text", chars: String(text || "").length };
    const { rows, docInfo, meta } = await importChunk({
      text: String(text || "").slice(0, 60_000),
      context: context ? String(context).slice(0, 2000) : "",
      pdf: pdf || null,
      cardsToo: cardsToo !== false,
      knownMerchants: Array.isArray(knownMerchants) ? knownMerchants.map(String) : [],
    });
    // shape of what came back, not the rows themselves: enough to tell "short statement" from "model missed most of it"
    const kinds = rows.reduce((a, r) => ((a[r.kind] = (a[r.kind] || 0) + 1), a), {});
    const dates = rows.map((r) => r.date).filter(Boolean).sort();
    const skipReasons = [...new Set(rows.filter((r) => r.kind === "skip").map((r) => r.skipReason))].slice(0, 5);
    await logEvent({
      userId, source: "import", status: 200, ms: Date.now() - t0, message: `${rows.length} rows`,
      detail: { ...detail, kinds, from: dates[0], to: dates.at(-1), skipReasons, docInfo, gemini: meta },
    });
    const label = detail.input === "pdf" ? `עמוד ${detail.page ?? "?"}` : `${detail.chars} תווים`;
    const debug = [
      `ייבוא · ${label} · ${rows.length} שורות · ${secs(Date.now() - t0)}`,
      `הוצאות ${kinds.out || 0} · הכנסות ${kinds.in || 0} · דולגו ${kinds.skip || 0}${dates.length ? ` · ⁦${dates[0]} → ${dates.at(-1)}⁩` : ""}`,
      triesText(meta.tries),
      docInfo && detail.page === 1 ? `מסמך: ${docInfo}` : null,
      skipReasons.length ? `סיבות דילוג: ${skipReasons.join(" | ")}` : null,
    ].filter(Boolean).join("\n");
    // zero rows from a page is the "model missed the table" signal worth noticing
    return Response.json({ rows, docInfo, model: meta.model, debug, level: rows.length ? "info" : "warn" });
  } catch (e) {
    console.error("[import]", e);
    await logEvent({
      userId, source: "import", status: 400, ms: Date.now() - t0, message: String(e?.message || e),
      detail: { ...detail, gemini: e?.tries ? { tries: e.tries } : undefined },
    });
    // tooBig tells the browser to split this chunk and retry the halves
    const label = detail.input === "pdf" ? `עמוד ${detail.page ?? "?"}` : `${detail.chars ?? "?"} תווים`;
    const debug = [
      `ייבוא · ${label} נכשל · ${secs(Date.now() - t0)}`,
      String(e?.message || e) + (e?.tooBig || e?.tooSlow ? " — יפוצל ויישלח שוב" : ""),
      e?.tries ? triesText(e.tries) : null,
    ].filter(Boolean).join("\n");
    return Response.json(
      { error: String(e?.message || e), tooBig: !!e?.tooBig, tooSlow: !!e?.tooSlow, debug, level: e?.tooBig || e?.tooSlow ? "warn" : "error" },
      { status: 400 }
    );
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
