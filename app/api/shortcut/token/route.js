import { rotateShortcutToken, hasShortcutToken, recentShortcutCalls } from "@/lib/db";

// Clerk-session routes: see whether a token exists, or mint a new one (old one dies)
export async function GET() {
  try {
    // recent calls let the user see what the phone actually sent — or that nothing arrived
    const [createdAt, recent] = await Promise.all([hasShortcutToken(), recentShortcutCalls()]);
    return Response.json({ createdAt, recent });
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
