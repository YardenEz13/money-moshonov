"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { ils, dm, mname, lastDay, shiftMonth, catNames, CATS } from "@/lib/format";

const KINDS = { expense: "הוצאה", income: "הכנסה", task: "משימה", journal: "יומן" };
const TABS = [["today", "היום"], ["money", "כסף"], ["journal", "יומן"], ["memory", "זיכרון"]];

const MAX_REC_S = 60;
// base64 inflates by 4/3, so 3MB of audio stays under Vercel's 4.5MB request body cap
const MAX_AUDIO_BYTES = 3_000_000;

// One error story for every call: the route's JSON error if it sent one, the HTTP status
// if it didn't (a 413 from the platform is an HTML page, not JSON).
async function api(url, method, body) {
  const r = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || (r.status === 413 ? "ההקלטה ארוכה מדי" : "HTTP " + r.status));
  return j;
}

/* ---------- small pieces ---------- */

function Row({ t }) {
  return (
    <li className="py-2.5 border-b border-rule last:border-b-0">
      <span className="flex items-baseline gap-2">
        <span className="text-[11px] text-ink/60 w-10 shrink-0"><bdi>{dm(t.d)}</bdi></span>
        {t.c ? <span className="border border-ink px-1 text-[10px] font-bold shrink-0">{t.c}</span> : null}
        <span className="flex-1 min-w-0 truncate font-medium">{t.m}</span>
        <span className={t.k === "in" ? "font-display text-[15px] font-bold text-pine" : "font-display text-[15px] font-bold text-ink"}>
          <bdi>{ils(t.a)}</bdi>
        </span>
      </span>
      {t.note ? <span className="block text-[12px] text-ink/60 ps-12">{t.note}</span> : null}
    </li>
  );
}

function Cat({ c, spent, budget, onPick }) {
  const over = budget && spent > budget;
  return (
    <button onClick={() => onPick(c)} className="w-full text-right py-3 border-b border-rule last:border-b-0 block">
      <span className="flex items-baseline gap-2">
        <b className="font-semibold">{c}</b>
        {over ? <span className="bg-redcard text-stock text-[10px] font-bold px-1.5">חריגה</span> : null}
        <span className="flex-1" />
        <span className="font-display text-[15px] font-bold"><bdi>{ils(spent)}</bdi></span>
        <span className="text-ink/40 text-sm">‹</span>
      </span>
      {budget ? (
        <>
          <span className="block h-1.5 bg-rule mt-2 relative overflow-hidden">
            <i
              className={over ? "absolute inset-y-0 start-0 bg-redcard" : "absolute inset-y-0 start-0 bg-ink"}
              style={{ inlineSize: Math.min(100, (spent / budget) * 100) + "%" }}
            />
          </span>
          <span className="block text-[11px] text-ink/60 mt-1.5">
            מתוך <bdi>{ils(budget)}</bdi> · {over ? "חריגה של" : "נשאר"} <bdi>{ils(Math.abs(budget - spent))}</bdi>
          </span>
        </>
      ) : (
        <span className="block text-[11px] text-ink/50 mt-1.5">בלי תקציב</span>
      )}
    </button>
  );
}

/* a field the model was unsure about gets a red dashed underline and a dot —
   the user needs to see what to check before saving */
function Field({ label, value, onChange, conf, big, select, type, max }) {
  const low = conf !== undefined && conf < 0.8;
  const cls = [
    "w-full bg-transparent outline-none py-1",
    low ? "border-b border-dashed border-redcard" : "",
    big ? "font-display text-2xl font-black text-redcard" : "",
  ].join(" ");
  return (
    <label className="grid grid-cols-[5.5rem_1fr] gap-2 items-center py-2 border-b border-rule last:border-b-0">
      <span className="text-[13px] text-ink/60">
        {low ? <span className="text-redcard">• </span> : null}{label}
      </span>
      {select ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={cls}>
          <option value="">—</option>
          {CATS.map((c) => <option key={c}>{c}</option>)}
        </select>
      ) : (
        <input
          value={value}
          type={type || "text"}
          max={max}
          inputMode={big ? "decimal" : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        />
      )}
    </label>
  );
}

/* iPhone Shortcut: mint a bearer token (shown once) and show the exact setup */
function Shortcut() {
  const [created, setCreated] = useState(undefined); // undefined = still loading
  const [token, setToken] = useState(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState(null);
  const [url, setUrl] = useState("/api/shortcut");

  useEffect(() => {
    setUrl(window.location.origin + "/api/shortcut");
    api("/api/shortcut/token", "GET").then((j) => setCreated(j.createdAt)).catch((e) => setErr(e.message));
  }, []);

  async function mint() {
    if (created && !window.confirm("טוקן חדש מבטל את הקיים — הקיצור באייפון יפסיק לעבוד עד שתעדכן אותו. להמשיך?")) return;
    try {
      const j = await api("/api/shortcut/token", "POST");
      setToken(j.token);
      setCopied(false);
      setCreated(new Date().toISOString());
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <section className="mt-8 border-2 border-ink bg-stock p-3">
      <h2 className="font-display text-lg font-bold">קיצור דרך לאייפון</h2>
      <p className="text-[13px] text-ink/70 mt-1">אומרים משפט, והוא נרשם בלי לפתוח את האפליקציה.</p>

      {token ? (
        <>
          <p className="text-[12px] text-redcard font-bold mt-3">הטוקן מוצג פעם אחת בלבד. העתק אותו עכשיו.</p>
          <code dir="ltr" className="block break-all bg-paper border border-ink p-2 mt-1 text-[12px]">{token}</code>
          <button
            onClick={() => navigator.clipboard.writeText(token).then(() => setCopied(true))}
            className="min-h-0 border border-ink px-3 py-1 mt-2 text-[13px]"
          >
            {copied ? "הועתק ✓" : "העתק"}
          </button>
        </>
      ) : (
        <p className="text-[12px] text-ink/60 mt-3">
          {created === undefined ? "…" : created ? <>טוקן פעיל מ־<bdi>{dm(created.slice(0, 10))}</bdi></> : "אין טוקן עדיין"}
        </p>
      )}

      {err ? <p className="text-[12px] text-redcard mt-2">{err}</p> : null}

      <button onClick={mint} className="press bg-pine text-stock border-2 border-ink px-4 mt-3 font-bold block">
        {created ? "צור טוקן חדש" : "צור טוקן"}
      </button>

      <ol className="list-decimal ps-5 mt-4 text-[13px] space-y-1.5">
        <li>באפליקציית קיצורים: <b dir="ltr">Dictate Text</b> (שפה: עברית)</li>
        <li><b dir="ltr">Get Contents of URL</b> לכתובת <code dir="ltr" className="break-all">{url}</code></li>
        <li>Method <b dir="ltr">POST</b> · Header <code dir="ltr">Authorization</code> = <code dir="ltr">Bearer</code> + רווח + הטוקן</li>
        <li>Request Body <b dir="ltr">JSON</b> · מפתח <code dir="ltr">text</code> = <i>Dictated Text</i></li>
        <li><b dir="ltr">Show Result</b> — מציג מה נרשם</li>
      </ol>
    </section>
  );
}

/* ---------- main ---------- */

export default function Ledger({ initial, today }) {
  const router = useRouter();
  const { tx, tasks, jots, mems, budget } = initial;

  const [tab, setTab] = useState("today");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [catsOpen, setCatsOpen] = useState(false);
  const [catFilter, setCatFilter] = useState(null);
  const [editBudgets, setEditBudgets] = useState(false);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState(null);
  const [err, setErr] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recLeft, setRecLeft] = useState(MAX_REC_S);
  const rec = useRef(null);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 10000);
    return () => clearTimeout(t);
  }, [toast]);

  // small mutations: fire, then re-read server data
  const act = (url, method, body) =>
    api(url, method, body).then(() => router.refresh()).catch((e) => setErr(e.message));

  async function send(payload, raw) {
    setBusy(true);
    setErr(null);
    try {
      const j = await api("/api/parse", "POST", payload);
      if (!j.items.length) {
        setErr("לא הצלחתי לחלץ מזה רישום. נסה שוב?");
        return;
      }
      setSheet({ raw: j.transcript || raw, items: j.items, facts: j.facts || [] });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function submitText(e) {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    setText("");
    send({ text: v }, v);
  }

  async function toggleMic() {
    if (recording) {
      rec.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      let left = MAX_REC_S;
      setRecLeft(left);
      // hard stop: a forgotten recording would blow the body limit and fail with no explanation
      const tick = setInterval(() => {
        left -= 1;
        setRecLeft(left);
        if (left <= 0 && mr.state === "recording") mr.stop();
      }, 1000);
      mr.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      mr.onstop = async () => {
        clearInterval(tick);
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: mr.mimeType });
        if (!blob.size) return setErr("ההקלטה ריקה");
        if (blob.size > MAX_AUDIO_BYTES) return setErr("ההקלטה ארוכה מדי. נסה משפט קצר יותר.");
        const b64 = await new Promise((res) => {
          const fr = new FileReader();
          fr.onloadend = () => res(String(fr.result).split(",")[1]);
          fr.readAsDataURL(blob);
        });
        // mimeType carries a codecs= suffix the API rejects; strip it
        return send({ audio: b64, mimeType: mr.mimeType.split(";")[0] }, "הקלטה");
      };
      rec.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      setErr("אין גישה למיקרופון");
    }
  }

  async function save() {
    // a kind switched in the sheet can leave a row with nothing to save
    const bad = sheet.items.find((it) =>
      it.type === "task" ? !it.title?.trim() : it.type === "journal" ? !it.body?.trim() : !(it.amount > 0)
    );
    if (bad) {
      setErr("יש רישום חסר — סכום או טקסט");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const j = await api("/api/entries", "POST", { items: sheet.items, facts: sheet.facts });
      setSheet(null);
      router.refresh();
      setToast({
        msg: "נשמר",
        undo: async () => {
          await api("/api/entries", "DELETE", { refs: j.saved }).catch((e) => setErr(e.message));
          setToast(null);
          router.refresh();
        },
      });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function patch(i, k, v) {
    const upd = typeof k === "object" ? k : { [k]: v };
    setSheet((s) => ({ ...s, items: s.items.map((it, n) => (n === i ? { ...it, ...upd } : it)) }));
  }

  const cur = month === today.slice(0, 7);
  const last = cur ? +today.slice(8) : lastDay(month);
  const rows = tx.filter((t) => t.d.startsWith(month));
  const outs = rows.filter((t) => t.k === "out");
  const out = outs.reduce((s, t) => s + t.a, 0);
  const inc = rows.filter((t) => t.k === "in").reduce((s, t) => s + t.a, 0);
  // a part-month compares only against the same stretch of the month before
  const prev = tx
    .filter((t) => t.d.startsWith(shiftMonth(month, -1)) && t.k === "out" && +t.d.slice(8) <= last)
    .reduce((s, t) => s + t.a, 0);
  const per = {};
  outs.forEach((t) => {
    per[t.c] = (per[t.c] || 0) + t.a;
  });
  const names = catNames(per, budget);
  const shown = catFilter ? rows.filter((t) => t.c === catFilter) : rows;
  const pickCat = (c) => {
    setCatFilter(c);
    setCatsOpen(false);
  };

  const monthPicker = (
    <div className="flex items-center justify-between px-4 py-3 border-b-2 border-ink bg-stock">
      <button
        onClick={() => setMonth(shiftMonth(month, -1))}
        aria-label="חודש קודם"
        className="w-8 h-8 min-h-0 border border-ink grid place-items-center"
      >
        ›
      </button>
      <div className="flex flex-col items-center">
        <span className="font-display text-lg font-bold">{mname(month)}</span>
        <span className="w-24 dotted-rule mt-0.5" />
      </div>
      <button
        onClick={() => setMonth(shiftMonth(month, 1))}
        disabled={cur}
        aria-label="חודש הבא"
        className="w-8 h-8 min-h-0 border border-ink grid place-items-center disabled:opacity-30"
      >
        ‹
      </button>
    </div>
  );

  const summary = (
    <>
      <div className="grid grid-cols-2 border-2 border-ink bg-stock">
        <div className="p-3 border-e-2 border-ink text-center">
          <span className="block text-[11px] font-bold text-ink/60">יצא</span>
          <b className="font-display text-2xl font-black text-redcard"><bdi>{ils(out)}</bdi></b>
        </div>
        <div className="p-3 text-center">
          <span className="block text-[11px] font-bold text-ink/60">נכנס</span>
          <b className="font-display text-2xl font-black text-pine"><bdi>{ils(inc)}</bdi></b>
        </div>
      </div>
      <p className="text-[11px] text-ink/60 text-center mt-2">
        <bdi>1–{last}</bdi> ב{mname(month).split(" ")[0]} · <bdi>{rows.length}</bdi> תנועות
        {prev ? (
          <>
            {" · "}
            {out > prev ? "יותר" : "פחות"} מ{cur ? "אותם ימים " : ""}בחודש שעבר ב־
            <bdi>{ils(Math.abs(out - prev))}</bdi>
          </>
        ) : null}
      </p>
    </>
  );

  let view;
  if (tab === "today") {
    const mine = tx.filter((t) => t.d === today);
    const todayJots = jots.filter((j) => j.d === today);
    const todayOut = mine.filter((t) => t.k === "out").reduce((s, t) => s + t.a, 0);
    const empty = !mine.length && !tasks.length && !todayJots.length;
    view = (
      <div className="p-4">
        {todayOut > 0 ? (
          <p className="font-display text-2xl font-black text-redcard mb-3"><bdi>{ils(todayOut)}</bdi></p>
        ) : null}
        {empty ? (
          <p className="text-center text-ink/50 py-16">עוד לא רשמת כלום היום. מה קרה?</p>
        ) : (
          <>
            {mine.length ? (
              <ul className="bg-stock border-2 border-ink px-3">
                {mine.map((t) => <Row key={t.id} t={t} />)}
              </ul>
            ) : null}
            {tasks.map((t) => (
              <button
                key={t.id}
                onClick={() => act("/api/tasks", "PATCH", { id: t.id, done: !t.done })}
                aria-pressed={t.done}
                className="w-full text-right flex items-center gap-3 py-2 border-b border-rule"
              >
                {/* design system: selected state is a heavy ink X stamp, not a rounded check */}
                <span
                  className={
                    t.done
                      ? "w-5 h-5 shrink-0 border-2 border-ink bg-ink text-stock grid place-items-center text-[11px] font-black"
                      : "w-5 h-5 shrink-0 border-2 border-ink"
                  }
                >
                  {t.done ? "✕" : null}
                </span>
                <span className={t.done ? "line-through text-ink/40" : ""}>{t.t}</span>
              </button>
            ))}
            {todayJots.map((j) => (
              <div key={j.id} className="font-display text-[17px] leading-relaxed py-3 border-b border-rule">
                {j.b}
              </div>
            ))}
          </>
        )}
      </div>
    );
  } else if (tab === "money") {
    view = (
      <>
        {monthPicker}
        <div className="p-4">
          {summary}
          <h2 className="font-display text-xl font-bold mt-6 mb-1">קטגוריות</h2>

          {editBudgets ? (
            <div className="bg-stock border-2 border-ink px-3">
              {CATS.map((c) => (
                <label key={c} className="flex items-center gap-3 py-2 border-b border-rule last:border-b-0">
                  <span className="flex-1 font-semibold">{c}</span>
                  <bdi className="text-ink/60">₪</bdi>
                  <input
                    key={c + ":" + (budget[c] || 0)}
                    defaultValue={budget[c] ? budget[c] / 100 : ""}
                    inputMode="decimal"
                    placeholder="בלי"
                    aria-label={"תקציב " + c}
                    onBlur={(e) => {
                      const s = e.target.value.trim().replace(",", ".");
                      const v = parseFloat(s);
                      if (s && !Number.isFinite(v)) {
                        setErr("סכום לא תקין");
                        return;
                      }
                      const a = s ? Math.round(v * 100) : 0;
                      if (a !== (budget[c] || 0)) act("/api/budgets", "POST", { category: c, amount: a });
                    }}
                    className="w-24 min-h-0 bg-paper border border-ink px-2 py-1 font-display text-left"
                  />
                </label>
              ))}
            </div>
          ) : names.length ? (
            <div className="bg-stock border-2 border-ink px-3">
              {(catsOpen ? names : names.slice(0, 3)).map((c) => (
                <Cat key={c} c={c} spent={per[c] || 0} budget={budget[c]} onPick={pickCat} />
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-ink/50 py-3">עוד אין הוצאות או תקציבים בחודש הזה.</p>
          )}

          <div className="flex items-center justify-between gap-2">
            {!catsOpen && !editBudgets && names.length > 3 ? (
              <button onClick={() => setCatsOpen(true)} className="text-sm underline py-2">
                כל הקטגוריות ←
              </button>
            ) : (
              <span />
            )}
            <button
              onClick={() => setEditBudgets((v) => !v)}
              className="text-sm border-2 border-ink px-3 py-1 min-h-0 my-2"
            >
              {editBudgets ? "סיום" : "[ עריכת תקציבים ]"}
            </button>
          </div>

          {!catsOpen && !editBudgets ? (
            <>
              <h2 className="font-display text-xl font-bold mt-6 mb-1">תנועות</h2>
              {catFilter ? (
                <button
                  onClick={() => setCatFilter(null)}
                  className="border border-ink px-2.5 py-1 min-h-0 text-[13px] mb-2"
                >
                  {catFilter} <span>×</span>
                </button>
              ) : null}
              {shown.length ? (
                <ul className="bg-stock border-2 border-ink px-3">
                  {shown.map((t) => <Row key={t.id} t={t} />)}
                </ul>
              ) : (
                <p className="text-[13px] text-ink/50 py-3">אין תנועות.</p>
              )}
            </>
          ) : null}
        </div>
      </>
    );
  } else if (tab === "journal") {
    view = (
      <div className="p-4">
        {!jots.length ? (
          <p className="text-center text-ink/50 py-16">עוד לא כתבת כלום. מה קרה?</p>
        ) : (
          jots.map((j) => (
            <div key={j.id} className="mb-4">
              <div className="text-[11px] text-ink/60"><bdi>{dm(j.d)}</bdi></div>
              <div className="font-display text-[17px] leading-relaxed">{j.b}</div>
            </div>
          ))
        )}
      </div>
    );
  } else {
    view = (
      <div className="p-4">
        <p className="text-[11px] text-ink/60 mb-3">נשלח לכל בקשה למודל</p>
        {!mems.length ? (
          <p className="text-[13px] text-ink/50 py-3">
            עוד אין עובדות. כשמשהו יציב עולה ממה שתרשום, הוא יופיע כאן לאישור.
          </p>
        ) : null}
        {mems.map((m) => (
          <div key={m.id} className="flex gap-2 items-start py-3 border-b border-rule">
            <p className="flex-1">
              {m.c}
              <span className="block text-[11px] text-ink/50">{m.s}</span>
            </p>
            {m.k === "pending" ? (
              <button
                onClick={() => act("/api/memories", "PATCH", { id: m.id })}
                className="min-h-0 text-[11px] border border-redcard text-redcard px-2 py-0.5"
              >
                ממתין · אשר
              </button>
            ) : (
              <span className="text-[10px] border px-1.5 border-rule text-ink/60">
                {m.k === "inferred" ? "הוסק" : "נאמר"}
              </span>
            )}
            <button
              aria-label="מחק עובדה"
              className="min-h-0 text-ink/50 px-1"
              onClick={() => act("/api/memories", "DELETE", { id: m.id })}
            >
              ×
            </button>
          </div>
        ))}
        <p className="text-[11px] text-ink/60 mt-5">
          עובדות שהוסקו נשלחות למודל רק אחרי אישור. מספרי כרטיס, סיסמאות ות״ז לא נשמרים אף פעם.
        </p>
        <Shortcut />
      </div>
    );
  }

  const heading =
    tab === "today" ? "היום" : tab === "money" ? "כסף" : tab === "journal" ? "מה כתבתי" : "מה Gemini יודע עליי";

  return (
    <div className="w-full max-w-[430px] mx-auto min-h-dvh flex flex-col bg-paper border-x border-ink">
      <header className="sticky top-0 z-20 bg-paper border-b-2 border-ink">
        <div className="flex items-center justify-between px-4 py-2 border-b border-ink/30 text-[11px]">
          <span className="font-display font-bold">פנקס הוצאות // עונת 88/89</span>
          <UserButton />
        </div>
        <h1 className="font-display text-2xl font-black px-4 py-2">{heading}</h1>
      </header>

      <main className="flex-1 overflow-y-auto pb-4">{view}</main>

      {err ? (
        <p className="mx-4 mb-2 border-2 border-redcard bg-stock text-redcard text-[13px] p-2 flex gap-2">
          <span className="flex-1">{err}</span>
          <button onClick={() => setErr(null)} aria-label="סגור" className="min-h-0 px-1">×</button>
        </p>
      ) : null}

      <div className="sticky bottom-0 z-20 bg-paper border-t-2 border-ink">
        <form onSubmit={submitText} className="flex items-stretch border-2 border-ink bg-stock m-2">
          <span className="bg-studio text-ink px-3 py-2 font-display font-bold text-sm border-e-2 border-ink grid place-items-center select-none whitespace-nowrap">
            מוני, תרשום:
          </span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            placeholder={busy ? "רגע…" : "מה קרה?"}
            aria-label="מה קרה?"
            className="flex-1 min-w-0 px-3 bg-transparent outline-none text-[16px]"
          />
          <button
            type="button"
            onClick={toggleMic}
            aria-label={recording ? "עצור הקלטה" : "הקלטה"}
            disabled={busy}
            className={
              recording
                ? "w-12 border-s-2 border-ink grid place-items-center bg-redcard text-stock font-display font-bold"
                : "w-12 border-s-2 border-ink grid place-items-center"
            }
          >
            {recording ? <bdi>{recLeft}</bdi> : "●"}
          </button>
          <button
            type="submit"
            aria-label="שלח"
            disabled={busy}
            className="w-12 bg-pine text-stock grid place-items-center"
          >
            →
          </button>
        </form>

        <nav className="flex border-t border-ink">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => {
                setTab(k);
                setCatsOpen(false);
                setCatFilter(null);
                setEditBudgets(false);
              }}
              aria-current={tab === k ? "page" : undefined}
              className={tab === k ? "flex-1 py-3 text-sm bg-pine text-stock font-bold" : "flex-1 py-3 text-sm text-ink/70"}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {sheet ? (
        <>
          <div className="fixed inset-0 bg-ink/25 z-30" onClick={() => setSheet(null)} />
          <section
            role="dialog"
            aria-modal="true"
            aria-label="אישור רישום"
            className="fixed bottom-0 inset-x-0 mx-auto max-w-[430px] z-40 bg-stock border-2 border-ink max-h-[88dvh] overflow-y-auto p-4"
          >
            <h3 className="font-display text-xl font-bold">
              {sheet.items.length > 1 ? sheet.items.length + " רישומים" : "רישום חדש"}
            </h3>
            <p className="text-[13px] text-ink/60 mb-3">״{sheet.raw}״</p>

            {sheet.items.map((it, i) => (
              <div key={i} className="border-2 border-ink p-3 mb-3 bg-paper">
                <div className="flex gap-1.5 flex-wrap mb-2">
                  {Object.entries(KINDS).map(([k, v]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => patch(i, "type", k)}
                      aria-pressed={it.type === k}
                      className={
                        it.type === k
                          ? "min-h-0 px-2.5 py-1 text-[13px] border border-ink bg-ink text-stock"
                          : "min-h-0 px-2.5 py-1 text-[13px] border border-ink"
                      }
                    >
                      {v}
                    </button>
                  ))}
                </div>

                {it.type === "task" || it.type === "journal" ? (
                  <Field
                    label={it.type === "task" ? "מה" : "טקסט"}
                    value={(it.type === "task" ? it.title : it.body) || ""}
                    onChange={(v) => patch(i, it.type === "task" ? "title" : "body", v)}
                  />
                ) : (
                  <>
                    <Field
                      label="סכום"
                      big
                      conf={it.conf?.amount}
                      // keep the typed text: reformatting on every keystroke made the field untypeable
                      value={it.amountText ?? (it.amount == null ? "" : (it.amount / 100).toFixed(2))}
                      onChange={(v) => {
                        const f = parseFloat(v.replace(",", "."));
                        patch(i, { amountText: v, amount: Number.isFinite(f) ? Math.round(f * 100) : null });
                      }}
                    />
                    <Field
                      label="קטגוריה"
                      conf={it.conf?.category}
                      select
                      value={it.category || ""}
                      onChange={(v) => patch(i, "category", v)}
                    />
                    <Field
                      label="עסק"
                      conf={it.conf?.merchant}
                      value={it.merchant || ""}
                      onChange={(v) => patch(i, "merchant", v)}
                    />
                    <Field label="הערה" value={it.note || ""} onChange={(v) => patch(i, "note", v)} />
                    <Field
                      label="תאריך"
                      type="date"
                      value={it.date}
                      max={today}
                      onChange={(v) => patch(i, "date", v)}
                    />
                  </>
                )}
              </div>
            ))}

            {sheet.facts.length ? (
              <p className="text-[12px] text-ink/60 mb-3">
                יוצע לזיכרון, ממתין לאישור: {sheet.facts.join(" · ")}
              </p>
            ) : null}

            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={busy}
                className="flex-1 bg-pine text-stock font-bold border-2 border-ink press"
              >
                {busy ? "שומר…" : sheet.items.length > 1 ? "שמור הכל" : "שמור " + KINDS[sheet.items[0].type]}
              </button>
              <button onClick={() => setSheet(null)} className="px-5 text-ink/60">
                בטל
              </button>
            </div>
          </section>
        </>
      ) : null}

      {toast ? (
        <div className="fixed bottom-32 inset-x-0 mx-auto w-max max-w-[90%] z-50 bg-ink text-stock px-4 py-2.5 flex items-center gap-4 text-sm">
          <span>{toast.msg}</span>
          <button onClick={toast.undo} className="min-h-0 underline font-bold">
            בטל
          </button>
        </div>
      ) : null}
    </div>
  );
}
