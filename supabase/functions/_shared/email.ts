// Thin email provider adapter (Resend). Swap this file to change provider.
// NOTE: the request shape follows Resend's documented POST /emails API; confirm against their docs
// before the first real send. The From domain must also be verified with the provider (SPF/DKIM).

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  idempotencyKey: string;
}

export type SendResult =
  | { ok: true }
  | { ok: false; transient: boolean; reason: string };

export async function sendEmail(apiKey: string, msg: OutgoingEmail): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": msg.idempotencyKey, // a retried send of the same recipient is not delivered twice
      },
      body: JSON.stringify({
        from: msg.from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        headers: msg.headers,
      }),
    });
  } catch (e) {
    return { ok: false, transient: true, reason: `network error: ${(e as Error).message}` };
  }
  if (res.ok) return { ok: true };
  const transient = res.status === 429 || res.status >= 500;
  return { ok: false, transient, reason: `provider returned ${res.status}` };
}
