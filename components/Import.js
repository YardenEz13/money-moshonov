"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { ils, dm, mname, CATS } from "@/lib/format";
import { decodeText, chunkLines, numbered, fingerprints, markRecurring, flagDuplicates, byMonth } from "@/lib/importing";

const card = "bg-card border-[1.5px] border-line rounded-[28px]";
// 80-line chunks timed out on every heavy model in production; smaller chunks also fail smaller
const CHUNK_LINES = 30;
const CONCURRENCY = 3;
// base64 grows by 4/3, so 3MB of PDF stays under Vercel's 4.5MB request body cap
const MAX_PDF_BYTES = 3_000_000;

const toBase64 = (file) =>
  new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(",")[1]);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });

// One page per model call: asked for a whole statement at once, the model skims and returns a few
// rows; asked for one page, it reads the table fully. pdf-lib loads only when a PDF is imported.
async function splitPdf(file) {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const pages = [];
  for (let i = 0; i < src.getPageCount(); i++) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page);
    pages.push(await doc.saveAsBase64());
  }
  return pages;
}

function Section({ title, aside, children }) {
  return (
    <section className={card + " px-4 py-3"}>
      <div className="flex items-center justify-between pb-2">
        <b className="font-display font-normal text-[17px]">{title}</b>
        {aside ? <span className="text-xs text-muted">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

/* A year of bank and card statements → reviewed, organized, deduplicated rows in the ledger.
   The heavy model reads the statements; everything that must hold across the whole year
   (recurring, duplicates, month totals) is computed here. */
export default function Import({ existing, onClose }) {
  const [files, setFiles] = useState([]);
  const [paste, setPaste] = useState("");
  const [cardsToo, setCardsToo] = useState(true);
  const [phase, setPhase] = useState("pick"); // pick | working | review | saving | saved
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [rows, setRows] = useState([]);
  const [failures, setFailures] = useState([]);
  const [models, setModels] = useState({});
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [openMonth, setOpenMonth] = useState(null);
  const run = useRef(null); // per-file lines and rows, shared by the first pass and retries

  async function runJobs(jobs) {
    const { perFile, known, used } = run.current;
    const failed = [];
    setProgress({ done: 0, total: jobs.length });

    const one = async (job, queue) => {
      const file = perFile[job.fi];
      try {
        const body = job.pdf
          ? { pdf: job.pdf, page: job.page, context: file.docInfo, cardsToo, knownMerchants: [...known] }
          : {
              text: numbered(file.lines, job.start, job.end),
              context: job.start > 0 ? numbered(file.lines, 0, Math.min(6, job.start)) : "",
              cardsToo,
              knownMerchants: [...known],
            };
        const j = await api("/api/import", "POST", body);
        if (j.docInfo && !file.docInfo) file.docInfo = j.docInfo;
        for (const r of j.rows) {
          file.rows.push(r);
          // later chunks reuse the names earlier ones settled on, so one merchant keeps one name
          if (r.merchant && r.kind !== "skip") known.add(r.merchant);
        }
        used[j.model] = (used[j.model] || 0) + 1;
      } catch (e) {
        // too much output, or too slow, for one call: halve the chunk and queue both halves
        if ((e.tooBig || e.tooSlow) && !job.pdf && job.end - job.start > 10) {
          const mid = job.start + Math.floor((job.end - job.start) / 2);
          // into the queue being drained right now, or the halves would never run
          queue.push({ fi: job.fi, start: job.start, end: mid }, { fi: job.fi, start: mid, end: job.end });
          setProgress((p) => ({ ...p, total: p.total + 1 }));
          return;
        }
        failed.push({ ...job, name: file.name, error: e.message });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    };

    const drain = async (queue) => {
      let next = 0;
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          while (next < queue.length) await one(queue[next++], queue);
        })
      );
    };
    // first pages go first: what they say about the document (period, year) is sent with every later page
    await drain(jobs.filter((j) => j.page === 1));
    await drain(jobs.filter((j) => j.page !== 1));
    return failed;
  }

  function organize(failed) {
    const { perFile, used } = run.current;
    let all = [];
    for (const f of perFile) {
      const fps = fingerprints(f.rows, f.lines);
      f.rows.forEach((r, i) => all.push({ ...r, fp: fps[i] }));
    }
    all = markRecurring(flagDuplicates(all, existing)).map((r) => ({ ...r, maybeDup: !!r.dup }));
    all.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    setRows(all);
    setFailures(failed);
    setModels({ ...used });
    setPhase("review");
  }

  async function start() {
    setErr(null);
    const sources = [...files];
    if (paste.trim()) sources.push({ name: "טקסט מודבק", pasted: paste });
    if (!sources.length) return setErr("בחר קובץ או הדבק את התנועות");

    const perFile = [];
    const jobs = [];
    for (const [fi, f] of sources.entries()) {
      if ("pasted" in f || !/\.pdf$/i.test(f.name)) {
        const text = "pasted" in f ? f.pasted : decodeText(new Uint8Array(await f.arrayBuffer()));
        const { lines, chunks } = chunkLines(text, CHUNK_LINES);
        perFile[fi] = { name: f.name, lines, rows: [] };
        chunks.forEach((c) => jobs.push({ fi, ...c }));
      } else {
        perFile[fi] = { name: f.name, lines: [], rows: [], docInfo: "" };
        let pages;
        try {
          pages = await splitPdf(f);
        } catch {
          // encrypted or unusual PDFs may not split; the model can still read them whole
          if (f.size > MAX_PDF_BYTES) return setErr(`${f.name} לא ניתן לפיצול ועולה על 3MB. ייצא אותו לפי חודשים.`);
          pages = [await toBase64(f)];
        }
        pages.forEach((pdf, i) => jobs.push({ fi, pdf, page: i + 1 }));
      }
    }
    if (!jobs.length) return setErr("לא נמצאו שורות בקבצים");

    run.current = { perFile, known: new Set(existing.map((t) => t.m).filter(Boolean)), used: {} };
    setPhase("working");
    organize(await runJobs(jobs));
  }

  async function retry() {
    setPhase("working");
    const jobs = failures.map(({ name, error, ...job }) => job);
    organize(await runJobs(jobs));
  }

  const setCategory = (merchant, category) =>
    setRows((rs) => rs.map((r) => (r.merchant === merchant && r.kind !== "skip" ? { ...r, category } : r)));
  const toggleDup = (i) => setRows((rs) => rs.map((r, n) => (n === i ? { ...r, dup: !r.dup } : r)));
  // the model will get some rows wrong; every total on this screen is derived from rows, so a fix here is a fix everywhere
  const setKind = (i, kind) =>
    setRows((rs) => rs.map((r, n) => (n === i ? { ...r, kind, skipReason: kind === "skip" ? r.skipReason || "סומן ידנית" : "" } : r)));
  const monthOf = (r) => (r.date || "").slice(0, 7) || "none";

  async function save() {
    setErr(null);
    setPhase("saving");
    const batchId = crypto.randomUUID();
    const kept = rows
      .filter((r) => r.kind !== "skip" && !r.dup)
      .map(({ date, merchant, raw, amount, kind, category, fp, recurring }) => ({ date, merchant, raw, amount, kind, category, fp, recurring }));
    let inserted = 0;
    let sent = 0;
    try {
      for (let i = 0; i < kept.length; i += 500) {
        const j = await api("/api/import/save", "POST", { batchId, rows: kept.slice(i, i + 500) });
        inserted += j.inserted;
        sent += j.sent;
      }
      setResult({ batchId, inserted, sent });
    } catch (e) {
      // part may already be saved — keep the batch id so it can still be undone
      setErr("השמירה נעצרה באמצע: " + e.message);
      setResult({ batchId, inserted, sent, partial: true });
    }
    setPhase("saved");
  }

  async function undo() {
    try {
      await api("/api/import", "DELETE", { batchId: result.batchId });
      onClose(true);
    } catch (e) {
      setErr(e.message);
    }
  }

  /* ---------- derived for review ---------- */

  const kept = rows.filter((r) => r.kind !== "skip" && !r.dup);
  const skipped = rows.filter((r) => r.kind === "skip");
  const months = byMonth(rows);
  const totalIn = kept.filter((r) => r.kind === "in").reduce((s, r) => s + r.amount, 0);
  const totalOut = kept.filter((r) => r.kind === "out").reduce((s, r) => s + r.amount, 0);

  const recurring = Object.values(
    kept.filter((r) => r.recurring).reduce((acc, r) => {
      const e = (acc[r.merchant] ||= { merchant: r.merchant, category: r.category, months: new Set(), total: 0 });
      e.months.add(r.date.slice(0, 7));
      e.total += r.amount;
      return acc;
    }, {})
  ).sort((a, b) => b.total - a.total);

  const merchants = Object.values(
    kept.filter((r) => r.kind === "out").reduce((acc, r) => {
      const e = (acc[r.merchant] ||= { merchant: r.merchant, total: 0, count: 0, cats: {} });
      e.total += r.amount;
      e.count++;
      e.cats[r.category] = (e.cats[r.category] || 0) + 1;
      return acc;
    }, {})
  )
    .sort((a, b) => b.total - a.total)
    .slice(0, 40)
    .map((e) => ({ ...e, category: Object.entries(e.cats).sort((a, b) => b[1] - a[1])[0][0] }));

  const liteUsed = Object.entries(models).some(([m]) => m.includes("lite"));

  /* ---------- render ---------- */

  return (
    <div className="fixed inset-0 z-40 bg-bg overflow-y-auto" role="dialog" aria-modal="true" aria-label="ייבוא דפי חשבון">
      <div className="max-w-[430px] mx-auto p-4 pb-16 flex flex-col gap-3.5">
        <div className="flex items-center justify-between pt-2">
          <h1 className="font-display text-[26px]">ייבוא דפי חשבון</h1>
          {phase !== "working" && phase !== "saving" ? (
            <button onClick={() => onClose(phase === "saved")} className="min-h-10 rounded-full border-[1.5px] border-line text-muted px-4 text-sm">
              סגור
            </button>
          ) : null}
        </div>

        {err ? <p className={card + " px-4 py-3 text-clay text-sm"}>{err}</p> : null}

        {phase === "pick" ? (
          <>
            <Section title="קבצים">
              <p className="text-[13px] text-muted mb-3">
                CSV או PDF מהבנק ומחברות האשראי. אפשר כמה קבצים ביחד, לשנה שלמה. קובץ Excel: שמור אותו קודם כ־CSV.
              </p>
              <input
                type="file"
                multiple
                accept=".csv,.txt,.pdf,text/csv,application/pdf"
                onChange={(e) => setFiles([...e.target.files])}
                className="block w-full text-sm"
              />
              {files.length ? (
                <ul className="mt-2 text-xs text-muted">
                  {files.map((f) => <li key={f.name}>{f.name}</li>)}
                </ul>
              ) : null}
            </Section>

            <Section title="או הדבקה">
              <textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                rows={5}
                placeholder="העתק את טבלת התנועות מאתר הבנק והדבק כאן"
                className="w-full bg-bg rounded-[18px] p-3 text-sm outline-none"
              />
            </Section>

            <label className={card + " px-4 py-3 flex items-start gap-3"}>
              <input type="checkbox" checked={cardsToo} onChange={(e) => setCardsToo(e.target.checked)} className="mt-1" />
              <span className="text-sm">
                אני מייבא גם את פירוט כרטיסי האשראי
                <span className="block text-xs text-muted">
                  אז החיוב החודשי המרוכז של הכרטיס בדף הבנק לא ייספר, כדי שכל קנייה תיספר פעם אחת.
                </span>
              </span>
            </label>

            <button onClick={start} className="rounded-full bg-grass text-cream text-[15px] px-5">
              קרא וארגן
            </button>
          </>
        ) : null}

        {phase === "working" ? (
          <Section title="קורא את התנועות" aside={`${progress.done}/${progress.total}`}>
            <span className="block w-full h-3 rounded-full bg-bg relative overflow-hidden">
              <i
                className="absolute inset-y-0 start-0 rounded-full bg-grass transition-all"
                style={{ inlineSize: (progress.total ? (progress.done / progress.total) * 100 : 0) + "%" }}
              />
            </span>
            <p className="text-xs text-muted mt-2">שנה שלמה לוקחת כמה דקות. אל תסגור את המסך.</p>
          </Section>
        ) : null}

        {phase === "review" || phase === "saving" ? (
          <>
            <section className="bg-pitch rounded-[28px] p-[18px] text-cream grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-sage">יצא</span>
                <b className="font-display font-normal text-[24px] text-[#F09A63]"><bdi>{ils(totalOut)}</bdi></b>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-sage">נכנס</span>
                <b className="font-display font-normal text-[24px] text-[#7FD3A3]"><bdi>{ils(totalIn)}</bdi></b>
              </div>
              <p className="col-span-full text-[13px] text-[#CBDBCF]">
                <bdi>{kept.length}</bdi> תנועות
                {kept.length ? <> · <bdi>{dm(kept[0].date)}.{kept[0].date.slice(0, 4)}</bdi>–<bdi>{dm(kept.at(-1).date)}.{kept.at(-1).date.slice(0, 4)}</bdi></> : null}
                {skipped.length ? <> · <bdi>{skipped.length}</bdi> לא נספרו</> : null}
              </p>
            </section>

            {liteUsed ? (
              <p className={card + " px-4 py-3 text-xs text-muted"}>
                חלק מהקריאה נעשתה במודל הקל, כי המודל הכבד לא היה זמין (מכסה או עומס). כדאי לעבור על הקטגוריות למטה.
                {" "}
                {Object.entries(models).map(([m, n]) => `${m}: ${n}`).join(" · ")}
              </p>
            ) : null}

            {failures.length ? (
              <Section title="חלקים שלא נקראו" aside={<button onClick={retry} className="min-h-8 rounded-full bg-grass text-cream px-3 text-xs">נסה שוב</button>}>
                <ul className="text-xs text-clay">
                  {failures.map((f, i) => (
                    <li key={i}>
                      {f.name}{f.pdf ? ` · עמוד ${f.page}` : ` · שורות ${f.start + 1}–${f.end}`}: {f.error}
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            <Section title="לפי חודש">
              {months.map((m) => (
                <div key={m.month} className="flex items-baseline gap-2 py-2 border-t-[1.5px] border-line first:border-t-0">
                  <b className="font-normal text-[15px] w-24">{mname(m.month)}</b>
                  <span className="flex-1 text-xs text-muted truncate">
                    {Object.entries(m.cats).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c).join(" · ")}
                  </span>
                  <span className="text-xs text-grass"><bdi>+{ils(m.in)}</bdi></span>
                  <b className="font-display font-normal"><bdi>{ils(m.out)}</bdi></b>
                </div>
              ))}
            </Section>

            {recurring.length ? (
              <Section title="חיובים קבועים" aside="3 חודשים ומעלה">
                {recurring.map((r) => (
                  <div key={r.merchant} className="flex items-baseline gap-2 py-2 border-t-[1.5px] border-line first:border-t-0">
                    <b className="font-normal text-[15px] flex-1 truncate">{r.merchant}</b>
                    <span className="text-xs text-muted">{r.category}</span>
                    <b className="font-display font-normal"><bdi>{ils(Math.round(r.total / r.months.size))}</bdi></b>
                    <span className="text-xs text-muted">לחודש</span>
                  </div>
                ))}
              </Section>
            ) : null}

            {rows.some((r) => r.maybeDup) ? (
              <Section title="אולי כבר רשמת" aside="מסומן = ייכנס">
                <p className="text-xs text-muted mb-1">אותו סכום ביום סמוך כבר נמצא בפנקס. כברירת מחדל לא נכנסים.</p>
                {rows.map((r, i) =>
                  r.maybeDup ? (
                    <label key={i} className="flex items-center gap-2 py-2 border-t-[1.5px] border-line text-sm">
                      <input type="checkbox" checked={!r.dup} onChange={() => toggleDup(i)} />
                      <bdi className="text-xs text-muted">{dm(r.date)}</bdi>
                      <span className="flex-1 truncate">{r.merchant}</span>
                      <bdi>{ils(r.amount)}</bdi>
                    </label>
                  ) : null
                )}
              </Section>
            ) : null}

            <Section title="עסקים וקטגוריות" aside="שינוי חל על כל התנועות של העסק">
              {merchants.map((m) => (
                <div key={m.merchant} className="flex items-center gap-2 py-2 border-t-[1.5px] border-line first:border-t-0">
                  <span className="flex-1 min-w-0">
                    <b className="block font-normal text-[15px] truncate">{m.merchant}</b>
                    <span className="text-xs text-muted"><bdi>{m.count}</bdi> תנועות · <bdi>{ils(m.total)}</bdi></span>
                  </span>
                  <select
                    value={m.category}
                    onChange={(e) => setCategory(m.merchant, e.target.value)}
                    aria-label={"קטגוריה ל" + m.merchant}
                    className="rounded-full border-[1.5px] border-line bg-bg px-3 py-1.5 text-sm"
                  >
                    {CATS.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              ))}
            </Section>

            <Section title="כל התנועות" aside="פתח חודש ובדוק מול התיאור מהבנק">
              {[...new Set(rows.map(monthOf))].map((m) => {
                const inMonth = rows.filter((r) => monthOf(r) === m).length;
                return (
                  <div key={m} className="border-t-[1.5px] border-line first:border-t-0">
                    <button
                      onClick={() => setOpenMonth(openMonth === m ? null : m)}
                      aria-expanded={openMonth === m}
                      className="w-full text-right py-2 flex items-center justify-between min-h-10"
                    >
                      <span className="text-[15px]">{m === "none" ? "בלי תאריך" : mname(m)}</span>
                      <span className="text-xs text-muted"><bdi>{inMonth}</bdi> שורות {openMonth === m ? "▴" : "▾"}</span>
                    </button>
                    {openMonth === m
                      ? rows.map((r, i) =>
                          monthOf(r) !== m ? null : (
                            <div key={i} className={"flex items-center gap-2 py-1.5 text-sm " + (r.kind === "skip" || r.dup ? "opacity-50" : "")}>
                              <bdi className="text-xs text-muted w-9 shrink-0">{r.date ? dm(r.date) : "?"}</bdi>
                              <span className="flex-1 min-w-0">
                                <span className="block truncate">{r.merchant}</span>
                                {r.raw && r.raw !== r.merchant ? (
                                  <span dir="auto" className="block truncate text-[11px] text-muted">{r.raw}</span>
                                ) : null}
                              </span>
                              <bdi className={"shrink-0 " + (r.kind === "in" ? "text-grass" : "")}>
                                {(r.kind === "in" ? "+" : "") + ils(r.amount)}
                              </bdi>
                              <select
                                value={r.kind}
                                onChange={(e) => setKind(i, e.target.value)}
                                aria-label={"סוג התנועה " + r.merchant}
                                className="shrink-0 rounded-full border-[1.5px] border-line bg-bg px-2 py-1 text-xs"
                              >
                                <option value="out">הוצאה</option>
                                <option value="in">הכנסה</option>
                                <option value="skip">לא לספור</option>
                              </select>
                            </div>
                          )
                        )
                      : null}
                  </div>
                );
              })}
            </Section>

            {skipped.length ? (
              <Section
                title="לא נספרו"
                aside={<button onClick={() => setShowSkipped((v) => !v)} className="min-h-8 rounded-full border-[1.5px] border-line text-muted px-3 text-xs">{showSkipped ? "הסתר" : "הצג"}</button>}
              >
                <p className="text-xs text-muted">העברות בין חשבונות, חיובי כרטיס מרוכזים ושורות שלא זוהו.</p>
                {showSkipped
                  ? skipped.map((r, i) => (
                      <div key={i} className="py-2 border-t-[1.5px] border-line text-xs">
                        <span className="flex gap-2">
                          <bdi className="text-muted">{r.date ? dm(r.date) : "?"}</bdi>
                          <span className="flex-1 truncate">{r.raw || r.merchant}</span>
                          <bdi>{ils(r.amount)}</bdi>
                        </span>
                        <span className="text-muted">{r.skipReason}</span>
                      </div>
                    ))
                  : null}
              </Section>
            ) : null}

            <button
              onClick={save}
              disabled={phase === "saving" || !kept.length}
              className="rounded-full bg-grass text-cream text-[15px] px-5 disabled:opacity-50"
            >
              {phase === "saving" ? "שומר…" : `שמור ${kept.length} תנועות`}
            </button>
          </>
        ) : null}

        {phase === "saved" && result ? (
          <Section title={result.partial ? "נשמר חלקית" : "נשמר"}>
            <p className="text-sm">
              <bdi>{result.inserted}</bdi> תנועות חדשות נכנסו לפנקס
              {result.sent - result.inserted > 0 ? <>, <bdi>{result.sent - result.inserted}</bdi> כבר היו מייבוא קודם</> : null}.
            </p>
            <div className="flex gap-2 mt-3">
              <button onClick={() => onClose(true)} className="flex-1 rounded-full bg-grass text-cream text-sm px-4">
                לפנקס
              </button>
              <button onClick={undo} className="rounded-full border-[1.5px] border-line text-muted text-sm px-4">
                בטל את הייבוא
              </button>
            </div>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
