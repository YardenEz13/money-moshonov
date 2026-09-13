import { setBudget } from "@/lib/db";

// amount in agorot; 0 clears the budget
export async function POST(req) {
  try {
    const { category, amount } = await req.json();
    await setBudget(category, amount);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 400 });
  }
}
