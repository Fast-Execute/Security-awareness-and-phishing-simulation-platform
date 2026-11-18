// Run with: node --test supabase/functions/_shared/render.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFrom, escapeHtml, firstName, htmlToText, isValidToken, renderTemplate, safeEqual, trackingUrl,
} from "./render.ts";

const TOKEN = "a".repeat(48);

test("renderTemplate escapes HTML in values so names cannot inject markup", () => {
  const out = renderTemplate("<p>Hi {{first_name}}</p>", { first_name: '<img src=x onerror=alert(1)>' });
  assert.equal(out, "<p>Hi &lt;img src=x onerror=alert(1)&gt;</p>");
});

test("renderTemplate text mode strips line breaks (header injection)", () => {
  const out = renderTemplate("Hello {{first_name}}", { first_name: "Ann\r\nBcc: evil@x.com" }, "text");
  assert.equal(out.includes("\n"), false);
  assert.equal(out.includes("\r"), false);
});

test("renderTemplate throws on unknown placeholders", () => {
  assert.throws(() => renderTemplate("{{frist_name}}", { first_name: "Ann" }), /unknown placeholder/);
});

test("renderTemplate allows spaces inside braces", () => {
  assert.equal(renderTemplate("{{ first_name }}", { first_name: "Ann" }), "Ann");
});

test("firstName falls back to 'there'", () => {
  assert.equal(firstName("Ann Smith"), "Ann");
  assert.equal(firstName("  "), "there");
  assert.equal(firstName(null), "there");
});

test("trackingUrl requires https and a well-formed token", () => {
  assert.equal(trackingUrl("https://app.example.com/", TOKEN), `https://app.example.com/t/${TOKEN}`);
  assert.equal(trackingUrl("http://localhost:3000", TOKEN), `http://localhost:3000/t/${TOKEN}`);
  assert.throws(() => trackingUrl("http://app.example.com", TOKEN), /https/);
  assert.throws(() => trackingUrl("https://app.example.com", "short"), /token/);
  assert.throws(() => trackingUrl("not a url", TOKEN), /valid URL/);
});

test("isValidToken accepts only 48 lowercase hex characters", () => {
  assert.equal(isValidToken(TOKEN), true);
  assert.equal(isValidToken("A".repeat(48)), false);
  assert.equal(isValidToken(`${TOKEN}0`), false);
  assert.equal(isValidToken(undefined), false);
});

test("buildFrom strips characters that could break the header", () => {
  assert.equal(buildFrom('IT "Desk"\r\nBcc: x', "it-support", "acme.co.za"), '"IT DeskBcc: x" <it-support@acme.co.za>');
  assert.throws(() => buildFrom("A", "bad local", "acme.co.za"), /local part/);
  assert.throws(() => buildFrom("A", "ok", "acme"), /domain/);
});

test("htmlToText keeps link targets", () => {
  const t = htmlToText('<p>Hi</p><p><a href="https://x.test/t/1">Reschedule</a></p>');
  assert.match(t, /Reschedule \(https:\/\/x\.test\/t\/1\)/);
});

test("safeEqual", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "ab"), false);
});

test("escapeHtml covers quotes", () => {
  assert.equal(escapeHtml(`"'&<>`), "&quot;&#39;&amp;&lt;&gt;");
});
