import { parseText, parseAudio } from "@/lib/gemini";
import { memoriesForPrompt } from "@/lib/db";
import { todayIso } from "@/lib/format";

// retries + model fallback can outlast the default function timeout
export const maxDuration = 60;

export async function POST(req) {
  try {
    const body = await req.json();
    const today = todayIso();
    const memories = await memoriesForPrompt();

    const out = body.audio
      ? await parseAudio(body.audio, body.mimeType || "audio/webm", today, memories)
      : await parseText(String(body.text || "").slice(0, 2000), today, memories);

    if (!out.items.length) return Response.json({ items: [], transcript: out.transcript });
    return Response.json(out);
  } catch (e) {
    // surface the reason: a missing key and a bad recording need different fixes
    return Response.json({ error: String(e.message || e) }, { status: 400 });
  }
}
