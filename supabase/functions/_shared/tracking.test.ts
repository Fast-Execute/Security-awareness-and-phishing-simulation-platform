import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boundedUserAgent, parseTrackingRequest, reportAction, trackingPixelHtml,
} from "./tracking.ts";

const TOKEN = "a".repeat(48);
function stored(method: string, event: string | null) {
  const result = parseTrackingRequest(method, TOKEN, event);
  return result.ok ? result.storedEvent : null;
}

test("tracking accepts only 48-character lowercase hex recipient tokens", () => {
  assert.deepEqual(parseTrackingRequest("GET", TOKEN, "click"), {
    ok: true, token: TOKEN, event: "click", storedEvent: "clicked",
  });
  assert.equal(parseTrackingRequest("GET", "bad-token", "click").ok, false);
  assert.equal(parseTrackingRequest("GET", "A".repeat(48), "click").ok, false);
});

test("tracking defaults an omitted event to click", () => {
  assert.equal(stored("GET", null), "clicked");
});

test("tracking maps only open, click and report to stored event names", () => {
  assert.equal(stored("GET", "open"), "opened");
  assert.equal(stored("GET", "click"), "clicked");
  assert.equal(stored("POST", "report"), "reported");
  assert.equal(parseTrackingRequest("GET", TOKEN, "submitted").ok, false);
});

test("report is POST-only and open/click are GET-only", () => {
  assert.equal(parseTrackingRequest("GET", TOKEN, "report").ok, false);
  assert.equal(parseTrackingRequest("POST", TOKEN, "open").ok, false);
  assert.equal(parseTrackingRequest("POST", TOKEN, "click").ok, false);
  assert.equal(parseTrackingRequest("POST", TOKEN, "report").ok, true);
});

test("unknown event is rejected", () => {
  assert.deepEqual(parseTrackingRequest("GET", TOKEN, "credential"), {
    ok: false, status: 400, message: "Unsupported tracking event.",
  });
});

test("user-agent is bounded and absent values remain null", () => {
  assert.equal(boundedUserAgent(null), null);
  assert.equal(boundedUserAgent(""), null);
  assert.equal(boundedUserAgent("x".repeat(700))?.length, 500);
});

test("tracking pixel escapes its URL attribute", () => {
  const html = trackingPixelHtml('https://example.test/track?a="b"');
  assert.match(html, /&quot;/);
  assert.match(html, /width="1" height="1"/);
});

test("report action is relative and validates its token", () => {
  assert.equal(reportAction(TOKEN), `?t=${TOKEN}&amp;event=report`);
  assert.throws(() => reportAction("bad"), /invalid tracking token/);
});
