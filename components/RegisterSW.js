"use client";
import { useEffect } from "react";

// needs https (or localhost) — silently absent elsewhere
export default function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
