// node --test lib/format.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { shiftMonth, lastDay, ils, catNames } from "./format.js";

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
