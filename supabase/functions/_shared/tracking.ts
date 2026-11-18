import { isValidToken, escapeHtml } from "./render.ts";

export type TrackingEvent = "open" | "click" | "report";
export type StoredEvent = "opened" | "clicked" | "reported";

export type TrackingRequestResult =
  | { ok: true; token: string; event: TrackingEvent; storedEvent: StoredEvent }
  | { ok: false; status: 400 | 405; message: string };

export function parseTrackingRequest(method: string, token: unknown, eventValue: string | null): TrackingRequestResult {
  if (!isValidToken(token)) {
    return { ok: false, status: 400, message: "Invalid simulation link." };
  }

  const event = eventValue ?? "click";
  if (event !== "open" && event !== "click" && event !== "report") {
    return { ok: false, status: 400, message: "Unsupported tracking event." };
  }

  const expectedMethod = event === "report" ? "POST" : "GET";
  if (method !== expectedMethod) {
    return { ok: false, status: 405, message: `Method not allowed for this event. Use ${expectedMethod}.` };
  }

  const storedEvent: StoredEvent = event === "open" ? "opened" : event === "click" ? "clicked" : "reported";
  return { ok: true, token, event, storedEvent };
}

/** Keep only a bounded user-agent. IP addresses and request bodies are deliberately not retained. */
export function boundedUserAgent(value: string | null): string | null {
  return value ? value.slice(0, 500) : null;
}

/** A transparent tracking image; counts are approximate, not proof a human read the message. */
export function trackingPixelHtml(openUrl: string): string {
  return `<img src="${escapeHtml(openUrl)}" width="1" height="1" alt="" aria-hidden="true" style="display:block;width:1px;height:1px;border:0" />`;
}

/** Relative action avoids trusting a request Host header to construct the report destination. */
export function reportAction(token: string): string {
  if (!isValidToken(token)) throw new Error("invalid tracking token");
  return `?t=${encodeURIComponent(token)}&amp;event=report`;
}
