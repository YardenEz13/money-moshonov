// Browser-side fetch helpers shared by the ledger and the import screen.

// Fire-and-forget error report to /api/log, so failures on the user's phone reach us.
// keepalive lets it finish even if the page is closing.
export function report(message, detail = {}) {
  try {
    fetch("/api/log", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        detail: { ...detail, path: location.pathname, ua: navigator.userAgent.slice(0, 160), online: navigator.onLine },
      }),
    }).catch(() => {});
  } catch {
    // reporting must never become its own failure
  }
}

// One error story for every call: the route's JSON error if it sent one, the HTTP status if it
// didn't (a 413 from the platform is an HTML page, not JSON). Extra fields the route returned
// (e.g. tooBig) ride along on the thrown error.
export async function api(url, method, body) {
  let r;
  try {
    r = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    report("network: " + url, { method, error: String(e?.message || e) });
    throw new Error("אין חיבור לשרת");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.error || (r.status === 413 ? "הקובץ או ההקלטה גדולים מדי" : "HTTP " + r.status);
    report("api " + r.status + ": " + url, { method, error: msg });
    throw Object.assign(new Error(msg), j, { status: r.status });
  }
  return j;
}
