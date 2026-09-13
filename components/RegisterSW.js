"use client";
import { useEffect } from "react";

// needs https (or localhost) — silently absent elsewhere.
// Production only: dev chunk names don't change between edits, so a caching worker serves stale code.
export default function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
