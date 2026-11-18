// Run with: node --test lib/csv/parseTargets.test.ts   (Node 22.18+ runs .ts files directly)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTargetsCsv, MAX_ROWS } from "./parseTargets.ts";

test("parses a basic comma-separated file", () => {
  const r = parseTargetsCsv("email,name,department\nann@acme.co.za,Ann Smith,Finance\nbob@acme.co.za,Bob,\n");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows, [
    { email: "ann@acme.co.za", full_name: "Ann Smith", department: "Finance", line: 2 },
    { email: "bob@acme.co.za", full_name: "Bob", line: 3 },
  ]);
});

test("detects the semicolon delimiter Excel uses in many locales", () => {
  const r = parseTargetsCsv("Email;Full Name;Dept\r\nann@acme.co.za;Ann;HR\r\n");
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].department, "HR");
});

test("handles quotes, embedded commas, escaped quotes and a BOM", () => {
  const r = parseTargetsCsv('﻿email,name\nann@acme.co.za,"Smith, Ann ""AJ"""\n');
  assert.equal(r.rows[0].full_name, 'Smith, Ann "AJ"');
});

test("keeps correct line numbers across multi-line quoted fields and blank lines", () => {
  const r = parseTargetsCsv('email,name\n\nann@acme.co.za,"Ann\nSmith"\nbob@acme.co.za,Bob\n');
  assert.deepEqual(r.rows.map((x) => x.line), [3, 5]);
});

test("accepts header aliases in any case", () => {
  const r = parseTargetsCsv("Work Email,Employee Name,Team\nann@acme.co.za,Ann,Ops\n");
  assert.deepEqual(r.rows[0], { email: "ann@acme.co.za", full_name: "Ann", department: "Ops", line: 2 });
});

test("reports a missing email column", () => {
  const r = parseTargetsCsv("name,department\nAnn,Ops\n");
  assert.equal(r.rows.length, 0);
  assert.match(r.errors[0].reason, /no "email" column/);
});

test("reports an empty file", () => {
  assert.match(parseTargetsCsv("").errors[0].reason, /empty/);
});

test("rejects files over the row limit", () => {
  const body = Array.from({ length: MAX_ROWS + 1 }, (_, i) => `u${i}@acme.co.za`).join("\n");
  const r = parseTargetsCsv(`email\n${body}`);
  assert.equal(r.rows.length, 0);
  assert.match(r.errors[0].reason, /too many rows/);
});
