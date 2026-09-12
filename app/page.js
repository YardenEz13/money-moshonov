import { loadAll } from "@/lib/db";
import { todayIso } from "@/lib/format";
import Ledger from "@/components/Ledger";

// auth is enforced in proxy.js; this just reads the signed-in user's rows
export default async function Page() {
  const data = await loadAll();
  return <Ledger initial={data} today={todayIso()} />;
}
