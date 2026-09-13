import { auth } from "@clerk/nextjs/server";
import { parseText, parseAudio, geminiMime } from "@/lib/gemini";
import { memoriesForPrompt, logEvent } from "@/lib/db";
import { todayIso } from "@/lib/format";

// retries + model fallback can outlast the default function timeout
export const maxDuration = 60;

export async function POST(req) {
  const t0 = Date.now();
  const { userId } = await auth();
  let detail = {};
  try {
    const body = await req.json();
    const today = todayIso();
    const memories = await memoriesForPrompt();

    detail = body.audio
      ? { input: "audio", mime: body.mimeType, sentAs: geminiMime(body.mimeType || "audio/webm"), bytes: Math.round((body.audio.length * 3) / 4) }
      : { input: "text", chars: String(body.text || "").length };
    detail.userAgent = (req.headers.get("user-agent") || "").slice(0, 120);

    const out = body.audio
      ? await parseAudio(body.audio, body.mimeType || "audio/webm", today, memories)
      : await parseText(String(body.text || "").slice(0, 2000), today, memories);

    await logEvent({
      userId, source: "parse", status: 200, ms: Date.now() - t0,
      message: out.items.length ? `${out.items.length} items` : "no items",
      detail: { ...detail, gemini: out.meta, heard: (out.transcript || "").slice(0, 200) },
    });
    const { meta, ...pub } = out;
    return Response.json(out.items.length ? pub : { items: [], transcript: out.transcript });
  } catch (e) {
    console.error("[parse]", e);
    await logEvent({
      userId, source: "parse", status: 400, ms: Date.now() - t0, message: String(e?.message || e),
      detail: { ...detail, gemini: e?.tries ? { tries: e.tries } : undefined },
    });
    // surface the reason: a missing key and a bad recording need different fixes
    return Response.json({ error: String(e?.message || e) }, { status: 400 });
  }
}
