// Pure helpers shared by the edge functions (no Deno or Node APIs, so they can be unit-tested in Node).

const TOKEN_RE = /^[0-9a-f]{48}$/;

export function isValidToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** First word of the name, or a neutral fallback. */
export function firstName(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  return first || "there";
}

/**
 * Replaces {{placeholders}}. Unknown placeholders throw, so a typo in a template fails loudly
 * instead of sending "{{frist_name}}" to staff.
 * mode "html" escapes values; mode "text" strips line breaks (safe for subjects/headers).
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
  mode: "html" | "text" = "html",
): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, key: string) => {
    if (!(key in vars)) throw new Error(`unknown placeholder {{${key}}}`);
    const v = vars[key];
    return mode === "html" ? escapeHtml(v) : v.replace(/[\r\n]+/g, " ").trim();
  });
}

/** Tracking link for a recipient. The base must be https (http only for localhost). */
export function trackingUrl(baseUrl: string, token: string): string {
  if (!isValidToken(token)) throw new Error("invalid tracking token");
  const base = baseUrl.replace(/\/+$/, "");
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    throw new Error("APP_BASE_URL is not a valid URL");
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) {
    throw new Error("APP_BASE_URL must use https");
  }
  return `${base}/t/${token}`;
}

/** From header with the display name stripped of anything that could break out of it. */
export function buildFrom(senderName: string, local: string, domain: string): string {
  if (!/^[a-z0-9._-]{1,64}$/.test(local)) throw new Error("invalid sender local part");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new Error("invalid sender domain");
  const name = senderName.replace(/[\r\n"<>\\]/g, "").trim() || "Notifications";
  return `"${name}" <${local}@${domain}>`;
}

/** Crude plain-text alternative: links become "text (url)". */
export function htmlToText(html: string): string {
  return html
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis, "$2 ($1)")
    .replace(/<\/(p|div|h\d|li)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Constant-time string comparison for secrets. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
