"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { ils, dm, mname, lastDay, shiftMonth, catNames, CATS } from "@/lib/format";
import { api, report } from "@/lib/api";
import Import from "@/components/Import";

const KINDS = { expense: "הוצאה", income: "הכנסה", task: "משימה", journal: "יומן" };
const TITLES = { today: "היום", money: "כסף", journal: "יומן", memory: "זיכרון" };
const SUBTITLES = { money: "איך מתנהל התקציב החודש", journal: "מה שכתבת לעצמך", memory: "מה שאני זוכר עליך" };
const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// category badge: two letters on a coloured disc
const BADGE = {
  "אוכל בחוץ": ["אב", "#F5BE3E", "#16332A"],
  "סופר": ["סו", "#2E7D57", "#F6EFDF"],
  "תחבורה": ["תח", "#E1703A", "#FFF5E8"],
  "דיור": ["די", "#6B5B95", "#F4F0FF"],
  "בריאות": ["בר", "#4F8FBF", "#F3F9FF"],
  "ביגוד": ["בג", "#D98BA6", "#2A1620"],
  "בידור": ["בד", "#9BC53D", "#16332A"],
  "חשבונות": ["חש", "#3E8E9C", "#F1FAFB"],
  "מנויים": ["מנ", "#B06FC7", "#FBF3FF"],
  "ביטוח": ["בט", "#5C7A99", "#F2F6FA"],
  "עמלות": ["עמ", "#A7503A", "#FFF3EE"],
  "אחר": ["אח", "#BFAE8C", "#2A2418"],
};
const badgeOf = (t) => (t.k === "in" ? ["₪", "#7FD3A3", "#16332A"] : BADGE[t.c] || BADGE["אחר"]);

const card = "bg-card border-[1.5px] border-line rounded-[28px]";

const MAX_REC_S = 60;
// base64 inflates by 4/3, so 3MB of audio stays under Vercel's 4.5MB request body cap
const MAX_AUDIO_BYTES = 3_000_000;

/* ---------- small pieces ---------- */

function Badge({ t, size = 40 }) {
  const [txt, bg, fg] = badgeOf(t);
  return (
    <span
      className="flex-none rounded-full grid place-items-center font-display text-[13px]"
      style={{ width: size, height: size, background: bg, color: fg }}
    >
      {txt}
    </span>
  );
}

function Row({ t, time }) {
  return (
    <li className="flex items-center gap-3 py-[11px] border-t-[1.5px] border-line">
      <Badge t={t} size={time ? 40 : 36} />
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <b className="font-normal text-[15px] truncate">{t.m}</b>
        <span className="text-xs text-muted">
          {t.c || (t.k === "in" ? "הכנסה" : "")}
          {time ? null : <> · <bdi>{dm(t.d)}</bdi></>}
        </span>
        {t.note ? <span className="text-xs text-muted truncate">{t.note}</span> : null}
        {t.r ? <span className="self-start rounded-full bg-note text-pitch text-[10px] px-2 py-0.5">קבוע</span> : null}
      </span>
      <b className={"font-display font-normal text-base " + (t.k === "in" ? "text-grass" : "text-ink")}>
        <bdi>{(t.k === "in" ? "+" : "") + ils(t.a)}</bdi>
      </b>
    </li>
  );
}

function Stat({ k, v, color }) {
  return (
    <div className="flex flex-col items-center gap-1 py-2.5 px-1.5 rounded-[18px] bg-white/6 min-w-0">
      <b className="font-display font-normal text-[21px] leading-tight text-center" style={{ color }}>
        <bdi>{v}</bdi>
      </b>
      <span className="text-[11px] text-sage">{k}</span>
    </div>
  );
}

function Cat({ c, spent, budget, onPick }) {
  const ratio = budget ? spent / budget : 0;
  const over = budget && spent > budget;
  const near = !over && ratio > 0.8;
  const [txt, bg, fg] = BADGE[c] || BADGE["אחר"];
  return (
    <button onClick={() => onPick(c)} className="w-full text-right py-3 border-t-[1.5px] border-line flex flex-col gap-2">
      <span className="flex items-center gap-2.5 w-full">
        <span className="w-[34px] h-[34px] flex-none rounded-full grid place-items-center font-display text-[13px]" style={{ background: bg, color: fg }}>
          {txt}
        </span>
        <b className="flex-1 font-normal text-[15px]">{c}</b>
        {budget ? (
          <span
            className={
              "rounded-full text-[11px] px-[9px] py-1 " +
              (over ? "bg-clay text-[#FFF5E8]" : near ? "bg-gold text-pitch" : "bg-[#DCEDE3] text-pitch")
            }
          >
            {over ? "חריגה" : near ? "קרוב" : "בקצב"}
          </span>
        ) : null}
        <b className="font-display font-normal text-base"><bdi>{ils(spent)}</bdi></b>
      </span>
      {budget ? (
        <>
          <span className="block w-full h-3 rounded-full bg-bg relative overflow-hidden">
            <i
              className={"absolute inset-y-0 start-0 rounded-full " + (over ? "bg-clay" : near ? "bg-[#E1703A]" : "bg-grass")}
              style={{ inlineSize: Math.min(100, ratio * 100) + "%" }}
            />
          </span>
          <span className="text-xs text-muted">
            {over ? "חריגה של " : "נשאר "}<bdi>{ils(Math.abs(budget - spent))}</bdi> מתוך <bdi>{ils(budget)}</bdi>
          </span>
        </>
      ) : (
        <span className="text-xs text-muted">בלי תקציב</span>
      )}
    </button>
  );
}

/* a field the model was unsure about gets a gold "ניחוש" chip —
   the user needs to see what to check before saving */
function Field({ label, value, onChange, conf, big, select, type, max }) {
  const low = conf !== undefined && conf < 0.8;
  const cls =
    "flex-1 min-w-0 bg-transparent border-0 outline-none p-0 " +
    (big ? "font-display text-[30px] text-clay" : "text-base text-inherit");
  return (
    <label className="flex items-center gap-3 py-3.5 border-t-[1.5px] border-line first:border-t-0">
      <span className="w-[76px] flex-none text-[13px] text-muted">{label}</span>
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
      {low ? <span className="rounded-full bg-gold text-pitch text-[11px] px-[9px] py-1">ניחוש</span> : null}
    </label>
  );
}

function Pill({ on, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={
        "flex-none rounded-full border-[1.5px] text-sm px-4 py-2 min-h-10 " +
        (on ? "bg-pitch border-pitch text-cream" : "bg-transparent border-line text-muted")
      }
    >
      {children}
    </button>
  );
}

/* iPhone Shortcut: mint a bearer token (shown once) and show the exact setup */
function Shortcut() {
  const [created, setCreated] = useState(undefined); // undefined = still loading
  const [token, setToken] = useState(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState(null);
  const [url, setUrl] = useState("/api/shortcut");
  const [recent, setRecent] = useState(undefined);

  const load = () =>
    api("/api/shortcut/token", "GET")
      .then((j) => {
        setCreated(j.createdAt);
        setRecent(j.recent || []);
      })
      .catch((e) => setErr(e.message));

  useEffect(() => {
    setUrl(window.location.origin + "/api/shortcut");
    load();
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
    <section className={card + " p-4"}>
      <b className="font-display font-normal text-[17px]">קיצור דרך לאייפון</b>
      <p className="text-[13px] text-muted mt-1">אומרים משפט, והוא נרשם בלי לפתוח את האפליקציה.</p>

      {token ? (
        <>
          <p className="text-xs text-clay mt-3">הטוקן מוצג פעם אחת בלבד. העתק אותו עכשיו.</p>
          <code dir="ltr" className="block break-all bg-bg rounded-[18px] p-3 mt-1 text-xs">{token}</code>
          <button
            onClick={() => navigator.clipboard.writeText(token).then(() => setCopied(true))}
            className="min-h-10 rounded-full border-[1.5px] border-line text-muted px-4 mt-2 text-[13px]"
          >
            {copied ? "הועתק ✓" : "העתק"}
          </button>
        </>
      ) : (
        <p className="text-xs text-muted mt-3">
          {created === undefined ? "…" : created ? <>טוקן פעיל מ־<bdi>{dm(created.slice(0, 10))}</bdi></> : "אין טוקן עדיין"}
        </p>
      )}

      {err ? <p className="text-xs text-clay mt-2">{err}</p> : null}

      <button onClick={mint} className="rounded-full bg-grass text-cream text-[13px] px-5 mt-3 block">
        {created ? "צור טוקן חדש" : "צור טוקן"}
      </button>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <b className="text-[13px] font-normal">קריאות אחרונות מהקיצור</b>
          <button onClick={load} className="min-h-8 rounded-full border-[1.5px] border-line text-muted px-3 text-xs">
            רענן
          </button>
        </div>
        {recent === undefined ? null : recent.length ? (
          <ul className="mt-1 text-xs">
            {recent.map((r, i) => (
              <li key={i} className="py-2 border-t-[1.5px] border-line first:border-t-0">
                <span className="flex gap-2 items-center">
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[11px] " +
                      (r.status === 200 ? "bg-[#DCEDE3] text-pitch" : "bg-clay text-[#FFF5E8]")
                    }
                  >
                    <bdi>{r.status}</bdi>
                  </span>
                  <bdi className="text-muted">
                    {dm(r.at.slice(0, 10))}{" "}
                    {new Date(r.at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" })}
                  </bdi>
                  <span className="text-muted">{r.detail?.input === "audio" ? "הקלטה" : "טקסט"}</span>
                </span>
                <span className="block mt-1 whitespace-pre-line">{r.message}</span>
                {r.detail?.heard ? <span className="block text-muted">שמעתי: {r.detail.heard}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted mt-1">
            לא הגיעה אף קריאה מהקיצור. אם הרצת אותו, הוא נעצר באייפון לפני השליחה, בדרך כלל בשלב Dictate Text.
            נסה את גרסת ההקלטה למטה.
          </p>
        )}
      </div>

      <b className="block text-[13px] font-normal mt-5">גרסה 1: הכתבה</b>
      <ol className="list-decimal ps-5 mt-1 text-[13px] space-y-1.5">
        <li><b dir="ltr">Dictate Text</b> (שפה: עברית)</li>
        <li><b dir="ltr">Get Contents of URL</b> לכתובת <code dir="ltr" className="break-all">{url}</code></li>
        <li>Method <b dir="ltr">POST</b> · Header <code dir="ltr">Authorization</code> = <code dir="ltr">Bearer</code> + רווח + הטוקן</li>
        <li>Request Body <b dir="ltr">JSON</b> · מפתח <code dir="ltr">text</code> = <i>Dictated Text</i></li>
        <li><b dir="ltr">Show Result</b></li>
      </ol>
      <p className="text-xs text-muted mt-1">
        אם ההכתבה לא נפתחת: הגדרות › כללי › מקלדת › הפעל הכתבה, והוסף מקלדת עברית.
      </p>

      <b className="block text-[13px] font-normal mt-4">גרסה 2: הקלטה, עוקפת את ההכתבה של iOS</b>
      <ol className="list-decimal ps-5 mt-1 text-[13px] space-y-1.5">
        <li><b dir="ltr">Record Audio</b> · Finish Recording: <b dir="ltr">On Tap</b></li>
        <li><b dir="ltr">Get Contents of URL</b> לאותה כתובת, <b dir="ltr">POST</b>, אותה כותרת Authorization</li>
        <li>Request Body <b dir="ltr">File</b> = <i>Recorded Audio</i></li>
        <li><b dir="ltr">Show Result</b></li>
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
  const [importOpen, setImportOpen] = useState(false);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState(null);
  const [err, setErr] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recLeft, setRecLeft] = useState(MAX_REC_S);
  const rec = useRef(null);

  useEffect(() => {
    const onError = (e) => report("uncaught: " + (e.message || "error"), { source: e.filename, line: e.lineno });
    const onReject = (e) => report("unhandled rejection", { error: String(e.reason?.message || e.reason) });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onReject);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onReject);
    };
  }, []);

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
        if (!blob.size) {
          report("recorder: empty blob", { mimeType: mr.mimeType, chunks: chunks.length });
          return setErr("ההקלטה ריקה");
        }
        if (blob.size > MAX_AUDIO_BYTES) {
          report("recorder: too large", { mimeType: mr.mimeType, bytes: blob.size });
          return setErr("ההקלטה ארוכה מדי. נסה משפט קצר יותר.");
        }
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
    } catch (e) {
      // NotAllowedError = permission denied, NotFoundError = no mic, TypeError = no MediaRecorder
      report("mic: " + (e?.name || "error"), {
        error: String(e?.message || e),
        secure: window.isSecureContext,
        hasMediaDevices: !!navigator.mediaDevices,
        hasRecorder: typeof MediaRecorder !== "undefined",
      });
      setErr(e?.name === "NotAllowedError" ? "אין הרשאה למיקרופון. אשר בהגדרות הדפדפן." : "ההקלטה לא הצליחה להתחיל");
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

  let view;
  if (tab === "today") {
    const mine = tx.filter((t) => t.d === today);
    const todayOut = mine.filter((t) => t.k === "out").reduce((s, t) => s + t.a, 0);
    const doneCount = tasks.filter((t) => t.done).length;
    const lastJot = jots[0];
    view = (
      <div className="flex flex-col gap-3.5">
        <section className="bg-pitch rounded-[28px] p-[18px] pb-4 text-cream">
          <div className="flex items-center justify-between text-xs text-sage mb-3">
            <span>לוח הניקוד · היום</span>
            <span className="flex items-center gap-1.5">
              <i className="w-2 h-2 rounded-full bg-gold inline-block" />
              חי
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <Stat k="יצא היום" v={ils(todayOut)} color="#F09A63" />
            <Stat k="משימות" v={tasks.length ? doneCount + "/" + tasks.length : "0"} color="#7FD3A3" />
            <Stat k="מהלכים" v={mine.length} color="#F5BE3E" />
          </div>
        </section>

        <section className={card + " px-4 py-1.5"}>
          <div className="flex items-center justify-between pt-3 pb-2">
            <b className="font-display font-normal text-[17px]">מה קרה היום</b>
            <span className="text-xs text-muted"><bdi>{mine.length}</bdi> מהלכים</span>
          </div>
          {mine.length ? (
            <ul>{mine.map((t) => <Row key={t.id} t={t} time />)}</ul>
          ) : (
            <p className="border-t-[1.5px] border-line py-6 text-center text-muted text-sm">עוד לא רשמת כלום היום. מה קרה?</p>
          )}
        </section>

        {tasks.length ? (
          <section className={card + " px-4 py-1.5"}>
            <div className="pt-3 pb-2"><b className="font-display font-normal text-[17px]">על הדשא</b></div>
            {tasks.map((t) => (
              <button
                key={t.id}
                onClick={() => act("/api/tasks", "PATCH", { id: t.id, done: !t.done })}
                aria-pressed={t.done}
                className="w-full text-right flex items-center gap-3 py-3 border-t-[1.5px] border-line"
              >
                <span
                  className={
                    "w-[26px] h-[26px] flex-none rounded-full border-2 grid place-items-center text-[13px] text-white " +
                    (t.done ? "border-grass bg-grass" : "border-line")
                  }
                >
                  {t.done ? "✓" : ""}
                </span>
                <span className={"flex-1 text-[15px] " + (t.done ? "text-muted line-through" : "")}>{t.t}</span>
                <span className="text-xs text-muted"><bdi>{dm(t.d)}</bdi></span>
              </button>
            ))}
          </section>
        ) : null}

        {lastJot ? (
          <section className="bg-note rounded-[28px] p-[18px] -rotate-[.5deg]">
            <span className="text-xs text-[#4F6B52]">מהיומן · <bdi>{dm(lastJot.d)}</bdi></span>
            <p className="mt-2 text-[17px] leading-[1.8] text-[#213A2B] text-pretty">{lastJot.b}</p>
          </section>
        ) : null}
      </div>
    );
  } else if (tab === "money") {
    view = (
      <div className="flex flex-col gap-3.5">
        <div className={card + " rounded-full! flex items-center gap-2 p-1.5"}>
          <button
            onClick={() => setMonth(shiftMonth(month, -1))}
            aria-label="חודש קודם"
            className="w-[38px] h-[38px] min-h-0 rounded-full text-muted text-lg"
          >
            ›
          </button>
          <b className="flex-1 text-center font-display font-normal text-[17px]">{mname(month)}</b>
          <button
            onClick={() => setMonth(shiftMonth(month, 1))}
            disabled={cur}
            aria-label="חודש הבא"
            className="w-[38px] h-[38px] min-h-0 rounded-full text-muted text-lg disabled:opacity-30"
          >
            ‹
          </button>
        </div>

        <section className="bg-pitch rounded-[28px] p-[18px] text-cream grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1 pe-3 border-e-2 border-dotted border-white/20">
            <span className="text-xs text-sage">יצא</span>
            <b className="font-display font-normal text-[27px] text-[#F09A63]"><bdi>{ils(out)}</bdi></b>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-sage">נכנס</span>
            <b className="font-display font-normal text-[27px] text-[#7FD3A3]"><bdi>{ils(inc)}</bdi></b>
          </div>
          <p className="col-span-full text-[13px] text-[#CBDBCF] leading-normal">
            <bdi>1–{last}</bdi> ב{mname(month).split(" ")[0]} · <bdi>{rows.length}</bdi> תנועות
            {prev ? (
              <>
                {" · "}
                {out > prev ? "יותר" : "פחות"} מ{cur ? "אותם ימים " : ""}בחודש שעבר ב־
                <bdi>{ils(Math.abs(out - prev))}</bdi>
              </>
            ) : null}
          </p>
        </section>

        <button
          onClick={() => setImportOpen(true)}
          className={card + " w-full text-right px-4 py-3 flex items-center gap-3"}
        >
          <span className="flex-1">
            <b className="block font-display font-normal text-[17px]">ייבוא דפי חשבון</b>
            <span className="text-xs text-muted">שנה של בנק ואשראי, מסודרת לפי חודשים וקטגוריות</span>
          </span>
          <span className="text-muted text-lg">‹</span>
        </button>

        <section className={card + " px-4 py-1.5"}>
          <div className="flex items-center justify-between pt-3 pb-1">
            <b className="font-display font-normal text-[17px]">קטגוריות</b>
            <button
              onClick={() => setEditBudgets((v) => !v)}
              className={
                "min-h-0 rounded-full text-[13px] px-3 py-1 border-[1.5px] " +
                (editBudgets ? "bg-pitch border-pitch text-cream" : "border-line text-muted")
              }
            >
              {editBudgets ? "סיום" : "עריכת תקציבים"}
            </button>
          </div>
          {editBudgets ? (
            CATS.map((c) => (
              <label key={c} className="flex items-center gap-3 py-2.5 border-t-[1.5px] border-line">
                <span className="flex-1 text-[15px]">{c}</span>
                <bdi className="text-muted">₪</bdi>
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
                  className="w-24 bg-bg rounded-full px-3 py-1.5 font-display text-left outline-none"
                />
              </label>
            ))
          ) : names.length ? (
            (catsOpen ? names : names.slice(0, 3)).map((c) => (
              <Cat key={c} c={c} spent={per[c] || 0} budget={budget[c]} onPick={pickCat} />
            ))
          ) : (
            <p className="border-t-[1.5px] border-line py-6 text-center text-muted text-sm">עוד אין הוצאות או תקציבים בחודש הזה.</p>
          )}
          {!catsOpen && !editBudgets && names.length > 3 ? (
            <button onClick={() => setCatsOpen(true)} className="w-full text-sm text-grass border-t-[1.5px] border-line py-2">
              כל הקטגוריות ←
            </button>
          ) : null}
        </section>

        {!catsOpen && !editBudgets ? (
          <section className={card + " px-4 py-1.5"}>
            <div className="flex items-center justify-between pt-3 pb-2">
              <b className="font-display font-normal text-[17px]">תנועות</b>
              {catFilter ? (
                <button
                  onClick={() => setCatFilter(null)}
                  className="rounded-full bg-pitch text-cream text-[13px] px-3 py-1 min-h-0"
                >
                  {catFilter} ×
                </button>
              ) : null}
            </div>
            {shown.length ? (
              <ul>{shown.map((t) => <Row key={t.id} t={t} />)}</ul>
            ) : (
              <p className="border-t-[1.5px] border-line py-6 text-center text-muted text-sm">אין תנועות</p>
            )}
          </section>
        ) : null}
      </div>
    );
  } else if (tab === "journal") {
    view = (
      <div className="flex flex-col gap-3.5">
        {!jots.length ? (
          <p className="text-center text-muted py-16">עוד לא כתבת כלום. מה קרה?</p>
        ) : (
          jots.map((j, i) => {
            const green = i % 2 === 1;
            return (
              <section
                key={j.id}
                className={"rounded-[28px] p-[18px] " + (green ? "bg-[#CFE3D2] rotate-[.6deg]" : "bg-note -rotate-[.7deg]")}
              >
                <span
                  className={
                    "w-[42px] h-[42px] rounded-full grid place-items-center font-display text-[13px] " +
                    (green ? "bg-grass text-cream" : "bg-gold text-pitch")
                  }
                >
                  <bdi>{dm(j.d)}</bdi>
                </span>
                <p className={"mt-3 text-[17px] leading-[1.8] text-pretty " + (green ? "text-[#14311F]" : "text-[#213A2B]")}>
                  {j.b}
                </p>
              </section>
            );
          })
        )}
      </div>
    );
  } else {
    view = (
      <div className="flex flex-col gap-3.5">
        <section className={card + " px-4 py-1.5"}>
          <p className="text-[13px] text-muted mt-3.5 mb-2.5 leading-relaxed">
            אני שומר רק מה שעוזר לי להבין אותך. עובדות שהוסקו נשלחות למודל רק אחרי אישור.
          </p>
          {!mems.length ? (
            <p className="border-t-[1.5px] border-line py-6 text-center text-muted text-sm">
              עוד אין עובדות. כשמשהו יציב עולה ממה שתרשום, הוא יופיע כאן לאישור.
            </p>
          ) : null}
          {mems.map((m) => (
            <div key={m.id} className="py-[13px] border-t-[1.5px] border-line flex flex-col gap-[9px]">
              <div className="flex items-start gap-2.5">
                <span className="flex-1 flex flex-col gap-[3px]">
                  <b className="font-normal text-[15px] leading-[1.45]">{m.c}</b>
                  <span className="text-xs text-muted">{m.s}</span>
                </span>
                <span
                  className={
                    "rounded-full text-[11px] px-2.5 py-[5px] whitespace-nowrap " +
                    (m.k === "pending" ? "bg-gold text-pitch" : m.k === "inferred" ? "bg-[#DCEDE3] text-pitch" : "bg-bg text-muted")
                  }
                >
                  {m.k === "pending" ? "ממתין" : m.k === "inferred" ? "הוסק" : "נאמר"}
                </span>
                {m.k === "pending" ? null : (
                  <button
                    aria-label="לשכוח"
                    onClick={() => act("/api/memories", "DELETE", { id: m.id })}
                    className="w-7 h-7 min-h-0 rounded-full border-[1.5px] border-line text-muted text-sm leading-none"
                  >
                    ×
                  </button>
                )}
              </div>
              {m.k === "pending" ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => act("/api/memories", "PATCH", { id: m.id })}
                    className="min-h-10 rounded-full bg-grass text-cream text-[13px] px-[18px]"
                  >
                    לזכור
                  </button>
                  <button
                    onClick={() => act("/api/memories", "DELETE", { id: m.id })}
                    className="min-h-10 rounded-full border-[1.5px] border-line text-muted text-[13px] px-[18px]"
                  >
                    לשכוח
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </section>
        <p className="text-xs text-muted leading-relaxed px-2">
          מספרי כרטיס, סיסמאות ותעודת זהות לא נשמרים אף פעם. אתה יכול למחוק כל זיכרון, תמיד.
        </p>
        <Shortcut />
      </div>
    );
  }

  const d = new Date(today + "T12:00:00");
  const subtitle = SUBTITLES[tab] || `${DAYS[d.getDay()]}, ${+today.slice(8)} ב${mname(today).split(" ")[0]}`;
  const tabBtn = ([k, label]) => (
    <button
      key={k}
      onClick={() => {
        setTab(k);
        setCatsOpen(false);
        setCatFilter(null);
        setEditBudgets(false);
      }}
      aria-current={tab === k ? "page" : undefined}
      className={"flex-1 rounded-full text-[13px] py-3 " + (tab === k ? "bg-cream text-pitch" : "text-sage")}
    >
      {label}
    </button>
  );
  const tabs = Object.entries(TITLES);

  return (
    <div className="w-full max-w-[430px] mx-auto min-h-dvh flex flex-col bg-card">
      <header className="sticky top-0 z-20 bg-card flex items-center justify-between gap-3 px-[22px] pt-[26px] pb-3.5">
        <div className="flex flex-col gap-[3px]">
          <span className="flex items-center gap-2">
            <h1 className="font-display text-[26px]">{TITLES[tab]}</h1>
            <span className="rounded-full bg-gold text-pitch text-[11px] px-[9px] py-1">
              עונה <bdi>26/27</bdi>
            </span>
          </span>
          <span className="text-[13px] text-muted">{subtitle}</span>
        </div>
        <UserButton />
      </header>

      <main className="flex-1 px-4 pb-4">{view}</main>

      <div className="sticky bottom-0 z-20 px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-2 bg-linear-to-t from-card from-70% to-transparent flex flex-col gap-2">
        {err ? (
          <p className="rounded-[20px] bg-clay text-[#FFF5E8] text-[13px] ps-4 pe-1.5 py-1.5 flex items-center gap-2">
            <span className="flex-1">{err}</span>
            <button onClick={() => setErr(null)} aria-label="סגור" className="min-h-8 w-8 rounded-full">×</button>
          </p>
        ) : null}

        <form onSubmit={submitText} className="flex items-center gap-2 rounded-full bg-bg border-[1.5px] border-line ps-4 p-1">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            placeholder={busy ? "רגע…" : "מוני, תרשום: מה קרה?"}
            aria-label="מה קרה?"
            className="flex-1 min-w-0 bg-transparent outline-none text-base"
          />
          <button
            type="submit"
            aria-label="שלח"
            disabled={busy}
            className="w-10 h-10 min-h-0 rounded-full bg-grass text-cream grid place-items-center"
          >
            ←
          </button>
        </form>

        <nav className="relative flex items-center gap-0.5 bg-pitch rounded-full p-2 shadow-[0_14px_30px_rgba(22,51,42,.32)]">
          {tabs.slice(0, 2).map(tabBtn)}
          <button
            onClick={toggleMic}
            aria-label={recording ? "עצור הקלטה" : "הקלטה"}
            disabled={busy}
            className={
              "flex-none w-[62px] h-[62px] -mt-4 mx-0.5 border-4 border-pitch rounded-full grid place-items-center relative shadow-[0_6px_16px_rgba(0,0,0,.28)] " +
              (recording ? "bg-clay" : "bg-gold")
            }
          >
            {recording ? (
              <bdi className="font-display text-lg text-cream">{recLeft}</bdi>
            ) : (
              <>
                <span className="absolute -inset-1 rounded-full bg-gold pulse" />
                <span className="relative w-3.5 h-[22px] rounded-full bg-pitch shadow-[0_14px_0_-5px_#16332A]" />
              </>
            )}
          </button>
          {tabs.slice(2).map(tabBtn)}
        </nav>
      </div>

      {importOpen ? (
        <Import
          existing={tx}
          onClose={(changed) => {
            setImportOpen(false);
            if (changed) router.refresh();
          }}
        />
      ) : null}

      {sheet ? (
        <>
          <div className="fixed inset-0 bg-pitch/45 z-30" onClick={() => setSheet(null)} />
          <section
            role="dialog"
            aria-modal="true"
            aria-label="אישור מהלך"
            className="fixed bottom-0 inset-x-0 mx-auto max-w-[430px] z-40 bg-card rounded-t-[34px] max-h-[92dvh] overflow-y-auto px-5 pt-2.5 pb-6 shadow-[0_-12px_40px_rgba(22,51,42,.22)]"
          >
            <div className="w-[46px] h-[5px] rounded-full bg-line mx-auto mb-3.5" />
            <div className="flex items-center gap-3 mb-3.5">
              <span className="w-[46px] h-[46px] flex-none rounded-full bg-gold text-pitch grid place-items-center font-display text-base">
                מ
              </span>
              <span className="flex flex-col gap-[3px] min-w-0">
                <b className="font-display font-normal text-lg">
                  {sheet.items.length > 1 ? sheet.items.length + " מהלכים, בוא נאשר" : "שמעתי, בוא נאשר"}
                </b>
                <span className="text-[13px] text-muted">״{sheet.raw}״</span>
              </span>
            </div>

            {sheet.items.map((it, i) => (
              <div key={i} className="mb-4">
                <div className="flex gap-1.5 mb-3 overflow-x-auto pb-0.5">
                  {Object.entries(KINDS).map(([k, v]) => (
                    <Pill key={k} on={it.type === k} onClick={() => patch(i, "type", k)}>
                      {v}
                    </Pill>
                  ))}
                </div>

                <div className="bg-bg rounded-[26px] px-4 py-1.5">
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
              </div>
            ))}

            {sheet.facts.length ? (
              <p className="text-xs text-muted mb-3">יוצע לזיכרון, ממתין לאישור: {sheet.facts.join(" · ")}</p>
            ) : null}

            <div className="flex gap-2.5 items-center">
              <button
                onClick={save}
                disabled={busy}
                className="flex-1 rounded-full bg-grass text-cream font-display text-[17px] p-4 shadow-[0_6px_0_#1F5A3D] active:translate-y-1 active:shadow-[0_2px_0_#1F5A3D] disabled:opacity-60"
              >
                {busy ? "שומר…" : sheet.items.length > 1 ? "שומר את כל המהלכים" : "שומר את המהלך"}
              </button>
              <button onClick={() => setSheet(null)} className="px-4 text-[15px] text-muted">
                בטל
              </button>
            </div>
          </section>
        </>
      ) : null}

      {toast ? (
        <div className="fixed bottom-44 inset-x-0 mx-auto w-max max-w-[90%] z-50 rounded-full bg-pitch text-cream ps-5 pe-2 py-1.5 flex items-center gap-4 text-sm shadow-lg">
          <span>{toast.msg}</span>
          <button onClick={toast.undo} className="min-h-9 rounded-full bg-gold text-pitch px-4">
            בטל
          </button>
        </div>
      ) : null}
    </div>
  );
}
