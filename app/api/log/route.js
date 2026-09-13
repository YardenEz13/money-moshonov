import { logClient } from "@/lib/db";

// Errors the browser hits (mic, recorder, failed calls). Signed-in only, via proxy.js.
export async function POST(req) {
  try {
    const { message, detail } = await req.json();
    // cap the size without cutting JSON in half: oversized detail is kept as a truncated string
    const str = detail && typeof detail === "object" ? JSON.stringify(detail) : "{}";
    const safe = str.length <= 2000 ? JSON.parse(str) : { truncated: str.slice(0, 2000) };
    await logClient(String(message || "").slice(0, 500), safe);
  } catch {
    // a malformed report is not worth a failure the client would then try to report
  }
  return new Response(null, { status: 204 });
}
