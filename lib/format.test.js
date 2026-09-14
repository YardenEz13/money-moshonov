// node --test lib/format.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { shiftMonth, lastDay, ils, catNames, isSensitive } from "./format.js";

test("date helpers cross year boundaries", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-09", -13), "2025-08");
  assert.equal(lastDay("2026-02"), 28);
});

test("agorot show only when present", () => {
  assert.equal(ils(3200), "₪32");
  assert.equal(ils(24080), "₪240.80");
  assert.equal(ils(920000), "₪9,200");
});

test("category ranking", () => {
  const B = { "סופר": 150000, "דיור": 420000 };
  assert.equal(catNames({ "סופר": 500 }, B)[0], "סופר");       // spend outranks untouched budget
  assert.equal(catNames({ "ביגוד": 100 }, B)[0], "ביגוד");     // unbudgeted still ranks by spend
  assert.ok(catNames({ "ביגוד": 100 }, B).includes("דיור"));   // untouched budgets stay listed
  assert.ok(catNames({}, B).every(c => B[c]));                 // nothing spent → only budgeted
});

test("sensitive facts never reach memory", () => {
  assert.ok(isSensitive("מספר כרטיס 4580-1234-5678-9012"));  // digits split by dashes still count
  assert.ok(isSensitive("ת״ז 012345678"));
  assert.ok(isSensitive("הסיסמה שלו היא dragon"));
  assert.ok(!isSensitive("גר בחיפה, נוסע ברכבת"));
  assert.ok(!isSensitive("משכורת בערך 9200 בחודש"));          // 4 digits is an amount, not an id
});

test("iPhone recordings get a type Gemini accepts", async () => {
  const { geminiMime } = await import("./gemini.js");
  assert.equal(geminiMime("audio/mp4"), "audio/m4a");            // Safari MediaRecorder
  assert.equal(geminiMime("audio/x-m4a"), "audio/m4a");          // Shortcuts Record Audio
  assert.equal(geminiMime("audio/webm;codecs=opus"), "audio/webm"); // Chrome, codecs suffix stripped
});

test("model pools rotate, skip benched models, and overflow to the other pool", async () => {
  const { candidates, bench, HEAVY_POOL, LITE_POOL } = await import("./gemini.js");
  const firsts = [0, 1, 2].map(() => candidates("heavy")[0]);
  assert.equal(new Set(firsts).size, 3);                               // load spread across heavy models
  const order = candidates("heavy");
  assert.deepEqual(order.slice(-LITE_POOL.length), LITE_POOL);          // lite only after every heavy model
  assert.ok(!candidates("escalate").some((m) => LITE_POOL.includes(m))); // escalation never drops to lite

  HEAVY_POOL.forEach((m, i) => bench(m, 60_000 + i * 1000));           // whole heavy pool out of quota
  assert.ok(candidates("heavy").every((m) => LITE_POOL.includes(m)));
  assert.deepEqual(candidates("escalate"), [HEAVY_POOL[0]]);            // nothing free: soonest back is still tried
});

test("model attempts stay one left-to-right run inside Hebrew toasts", async () => {
  const { triesText } = await import("./format.js");
  const s = triesText([{ model: "gemini-3.8-flash", status: 429 }, { model: "gemini-3.6-flash", status: 200 }]);
  assert.equal(s, "\u20663.8-flash:429 → 3.6-flash:200\u2069");
});
