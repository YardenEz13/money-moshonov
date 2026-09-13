import { rotateShortcutToken, hasShortcutToken } from "@/lib/db";

// Clerk-session routes: see whether a token exists, or mint a new one (old one dies)
export async function GET() {
  try {
    return Response.json({ createdAt: await hasShortcutToken() });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 401 });
  }
}

export async function POST() {
  try {
    return Response.json({ token: await rotateShortcutToken() });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 401 });
  }
}
