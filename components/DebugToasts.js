"use client";
import { useEffect, useState } from "react";

// Top of the screen so it never covers the composer or nav, and above the import overlay.
const LIFE = { info: 7000, warn: 12000, error: 20000 };
const TONE = { info: "bg-pitch text-cream", warn: "bg-gold text-pitch", error: "bg-clay text-[#FFF5E8]" };

export default function DebugToasts() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let id = 0;
    const onToast = (e) => {
      const t = { id: ++id, text: e.detail.text, level: e.detail.level in LIFE ? e.detail.level : "info" };
      setItems((xs) => [...xs.slice(-4), t]); // five at a time is readable during an import
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), LIFE[t.level]);
    };
    window.addEventListener("debug-toast", onToast);
    return () => window.removeEventListener("debug-toast", onToast);
  }, []);

  if (!items.length) return null;
  return (
    <div className="fixed top-3 inset-x-0 mx-auto w-full max-w-[430px] px-3 z-[60] flex flex-col gap-2 pointer-events-none" aria-live="polite">
      {items.map((t) => (
        <button
          key={t.id}
          onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}
          className={"pointer-events-auto text-right min-h-0 rounded-[18px] px-3.5 py-2.5 text-xs leading-relaxed shadow-lg " + TONE[t.level]}
        >
          {/* per-line direction: model lines are LTR ("3.8-flash:429 → …") inside an RTL app, and a
              single paragraph direction scrambled them */}
          {t.text.split("\n").map((line, i) => (
            <span key={i} dir="auto" className="block">{line}</span>
          ))}
        </button>
      ))}
    </div>
  );
}
